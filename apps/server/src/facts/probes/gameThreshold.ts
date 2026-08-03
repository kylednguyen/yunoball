/** Threshold probes over the player game log.
 *
 * "Only the fourth player with 200+ rushing yards in a game since 2019."
 *
 * The SQL returns every qualifying game in the warehouse, newest first; the
 * miner turns that list into the claim. Stat expressions come from the engine's
 * STATS allowlist via statDef(), so a probe can only reference a stat the query
 * engine already knows how to compute — a probe cannot invent a column.
 */

import { Params, statDef } from "../../engine/executors/shared.js";
import { ordinal, sinceClause, subjectPhrase, whenPhrase } from "../claim.js";
import type { FactProbe, ProbeVariant } from "../types.js";

/** The curated ladder. Round numbers only, and thresholds a broadcast would
 * actually use — never fitted to whatever makes the list short. */
const VARIANTS: ProbeVariant[] = [
  { key: "pass400", stat: "passing_yards", threshold: 400 },
  { key: "pass500", stat: "passing_yards", threshold: 500 },
  { key: "rush200", stat: "rushing_yards", threshold: 200 },
  { key: "rush250", stat: "rushing_yards", threshold: 250 },
  { key: "rec200", stat: "receiving_yards", threshold: 200 },
  { key: "rec250", stat: "receiving_yards", threshold: 250 },
  { key: "passtd6", stat: "passing_tds", threshold: 6 },
  { key: "rushtd4", stat: "rushing_tds", threshold: 4 },
  { key: "rectd4", stat: "receiving_tds", threshold: 4 },
  { key: "sacks4", stat: "def_sacks", threshold: 4 },
  { key: "int3", stat: "def_interceptions", threshold: 3 },
  { key: "fg50plus3", stat: "field_goals_50_plus", threshold: 3 },
  { key: "fg6", stat: "field_goals_made", threshold: 6 },
];

export const gameThresholdProbe: FactProbe = {
  id: "game_threshold",
  family: "threshold",
  title: "A single-game statistical threshold almost nobody clears",
  sources: ["player_game_stats"],
  variants: VARIANTS,
  maxPopulation: 40,

  sql(variant, p: Params) {
    const def = statDef(variant);
    return (
      "SELECT s.player_id AS subject_id, pl.full_name AS subject_name, " +
      `g.season, g.week, ${def.expr} AS value, g.season_type, ` +
      "CASE WHEN s.team_id = g.home_team THEN g.away_team ELSE g.home_team END AS opponent " +
      "FROM player_game_stats s " +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players pl ON pl.player_id = s.player_id " +
      `WHERE g.season_type = ${p.add("REG")} AND ${def.expr} >= ${p.add(variant.threshold)} ` +
      "ORDER BY g.season DESC, g.week DESC, value DESC " +
      // One more than the cap so the miner can tell "rare" from "capped out".
      `LIMIT ${p.add(this.maxPopulation + 1)}`
    );
  },

  // Phrased about GAMES, not players. The population counts qualifying games,
  // and one player can appear twice — "the 4th player to" would then be a
  // wrong number, while "the 4th game of" is exactly what was counted.
  headline(subject, claim, variant) {
    const def = statDef(variant);
    const who = subjectPhrase(subject, claim);
    const when = whenPhrase(subject.season, subject.week, String(subject.season_type ?? "REG"));
    const rank =
      claim.population === 1
        ? `the only game of ${variant.threshold}+ ${def.label}`
        : `just the ${ordinal(claim.population)} game of ${variant.threshold}+ ${def.label}`;
    return (
      `${who} put up ${subject.value} ${def.label} against ` +
      `${String(subject.opponent ?? "their opponent")} in ${when} — ` +
      `${rank} ${sinceClause(claim)}.`
    );
  },

  question(subject, variant) {
    const def = statDef(variant);
    return `most ${def.label} in a game`;
  },
};
