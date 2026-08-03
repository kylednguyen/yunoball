/** Team-grain threshold probes.
 *
 * Reads the box-score columns that the stats_team ingest fills — total_yards,
 * turnovers, first_downs and friends were declared on team_game_stats from the
 * start but sat NULL until that pipeline landed, so this probe family had no
 * data to stand on before it.
 *
 * Team stats live on their own columns rather than the engine's STATS
 * allowlist (which is player-grain), so the column names here are a small
 * local allowlist instead — still never free text.
 */

import { Params } from "../../engine/executors/shared.js";
import { ordinal, sinceClause, subjectPhrase, whenPhrase } from "../claim.js";
import type { FactProbe, ProbeVariant } from "../types.js";

/** Local allowlist: team stat key -> (column, label, direction). `low` marks
 * a stat where the FEWER the more notable (turnovers, penalties). */
const TEAM_STATS: Record<string, { col: string; label: string; low?: boolean }> = {
  team_total_yards: { col: "t.total_yards", label: "total yards" },
  team_points: { col: "t.points_for", label: "points" },
  team_first_downs: { col: "t.first_downs", label: "scrimmage first downs" },
  team_turnovers: { col: "t.turnovers", label: "turnovers" },
  team_penalties: { col: "t.penalties", label: "penalties" },
  team_def_sacks: { col: "t.def_sacks", label: "sacks" },
};

const VARIANTS: ProbeVariant[] = [
  { key: "yards550", stat: "team_total_yards", threshold: 550 },
  { key: "yards600", stat: "team_total_yards", threshold: 600 },
  { key: "points50", stat: "team_points", threshold: 50 },
  { key: "points60", stat: "team_points", threshold: 60 },
  { key: "firstdowns30", stat: "team_first_downs", threshold: 30 },
  { key: "sacks8", stat: "team_def_sacks", threshold: 8 },
];

export const teamGameProbe: FactProbe = {
  id: "team_game_threshold",
  family: "threshold",
  title: "A team box-score line almost no team puts up",
  sources: ["team_game_stats"],
  variants: VARIANTS,
  maxPopulation: 40,

  sql(variant, p: Params) {
    const def = TEAM_STATS[variant.stat]!;
    return (
      "SELECT t.team_id AS subject_id, tm.name AS subject_name, " +
      `g.season, g.week, ${def.col} AS value, g.season_type, ` +
      "CASE WHEN t.is_home THEN g.away_team ELSE g.home_team END AS opponent " +
      "FROM team_game_stats t " +
      "JOIN games g ON g.game_id = t.game_id " +
      "JOIN teams tm ON tm.team_id = t.team_id " +
      `WHERE g.season_type = ${p.add("REG")} ` +
      // NOT NULL matters here: the box-score columns are null for any season
      // whose stats_team release could not be fetched, and a null must not be
      // read as a zero.
      `AND ${def.col} IS NOT NULL AND ${def.col} >= ${p.add(variant.threshold)} ` +
      "ORDER BY g.season DESC, g.week DESC, value DESC " +
      `LIMIT ${p.add(this.maxPopulation + 1)}`
    );
  },

  headline(subject, claim, variant) {
    const def = TEAM_STATS[variant.stat]!;
    const who = subjectPhrase(subject, claim);
    const when = whenPhrase(subject.season, subject.week, String(subject.season_type ?? "REG"));
    const rank =
      claim.population === 1
        ? `the only team game with ${variant.threshold}+ ${def.label}`
        : `just the ${ordinal(claim.population)} team game with ${variant.threshold}+ ${def.label}`;
    return (
      `The ${who} put up ${subject.value} ${def.label} against ` +
      `${String(subject.opponent ?? "their opponent")} in ${when} — ` +
      `${rank} ${sinceClause(claim)}.`
    );
  },
};

export { TEAM_STATS };
