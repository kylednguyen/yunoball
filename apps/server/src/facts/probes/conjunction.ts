/** Conjunction probes: two thresholds cleared in the same game.
 *
 * "300 passing and 100 rushing yards in the same game" is the classic form —
 * individually unremarkable numbers whose intersection is rare, which is
 * exactly the shape of fact that reads as surprising.
 */

import { Params, statDef } from "../../engine/executors/shared.js";
import { ordinal, sinceClause, subjectPhrase, whenPhrase } from "../claim.js";
import type { FactProbe, ProbeVariant } from "../types.js";

const VARIANTS: ProbeVariant[] = [
  {
    key: "pass300rush100",
    stat: "passing_yards", threshold: 300,
    stat2: "rushing_yards", threshold2: 100,
  },
  {
    key: "pass400passtd4",
    stat: "passing_yards", threshold: 400,
    stat2: "passing_tds", threshold2: 4,
  },
  {
    key: "rush100rec100",
    stat: "rushing_yards", threshold: 100,
    stat2: "receiving_yards", threshold2: 100,
  },
  {
    key: "rush150rushtd3",
    stat: "rushing_yards", threshold: 150,
    stat2: "rushing_tds", threshold2: 3,
  },
  {
    key: "sacks2int1",
    stat: "def_sacks", threshold: 2,
    stat2: "def_interceptions", threshold2: 1,
  },
];

export const conjunctionProbe: FactProbe = {
  id: "game_conjunction",
  family: "conjunction",
  title: "Two thresholds cleared in the same game",
  sources: ["player_game_stats"],
  variants: VARIANTS,
  maxPopulation: 40,

  sql(variant, p: Params) {
    const def = statDef(variant);
    const def2 = statDef({ stat: variant.stat2! });
    return (
      "SELECT s.player_id AS subject_id, pl.full_name AS subject_name, " +
      `g.season, g.week, ${def.expr} AS value, ${def2.expr} AS value2, g.season_type, ` +
      "CASE WHEN s.team_id = g.home_team THEN g.away_team ELSE g.home_team END AS opponent " +
      "FROM player_game_stats s " +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players pl ON pl.player_id = s.player_id " +
      `WHERE g.season_type = ${p.add("REG")} ` +
      `AND ${def.expr} >= ${p.add(variant.threshold)} ` +
      `AND ${def2.expr} >= ${p.add(variant.threshold2!)} ` +
      "ORDER BY g.season DESC, g.week DESC, value DESC " +
      `LIMIT ${p.add(this.maxPopulation + 1)}`
    );
  },

  headline(subject, claim, variant) {
    const def = statDef(variant);
    const def2 = statDef({ stat: variant.stat2! });
    const who = subjectPhrase(subject, claim);
    const when = whenPhrase(subject.season, subject.week, String(subject.season_type ?? "REG"));
    const pair = `${variant.threshold}+ ${def.label} and ${variant.threshold2}+ ${def2.label}`;
    const rank =
      claim.population === 1
        ? `the only game with ${pair}`
        : `just the ${ordinal(claim.population)} game with ${pair}`;
    return (
      `${who} went for ${subject.value} ${def.label} and ${String(subject.value2)} ` +
      `${def2.label} against ${String(subject.opponent ?? "their opponent")} in ${when} — ` +
      `${rank} ${sinceClause(claim)}.`
    );
  },
};
