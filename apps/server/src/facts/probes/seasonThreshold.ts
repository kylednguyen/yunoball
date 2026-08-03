/** Season-grain threshold probes over the rollup table.
 *
 * "The first 1,800-yard rushing season since 2012."
 *
 * Season facts have no week, so the miner stores week = NULL and the phrasing
 * drops the "Week N of" clause.
 */

import { Params, statDef } from "../../engine/executors/shared.js";
import { ordinal, sinceClause, subjectPhrase } from "../claim.js";
import type { FactProbe, ProbeVariant } from "../types.js";

const VARIANTS: ProbeVariant[] = [
  { key: "pass5000", stat: "passing_yards", threshold: 5000 },
  { key: "passtd45", stat: "passing_tds", threshold: 45 },
  { key: "rush1800", stat: "rushing_yards", threshold: 1800 },
  { key: "rush2000", stat: "rushing_yards", threshold: 2000 },
  { key: "rec1700", stat: "receiving_yards", threshold: 1700 },
  { key: "rectd15", stat: "receiving_tds", threshold: 15 },
  { key: "sacks20", stat: "def_sacks", threshold: 20 },
  { key: "int9", stat: "def_interceptions", threshold: 9 },
  { key: "fg40", stat: "field_goals_made", threshold: 40 },
  { key: "gwfg6", stat: "game_winning_field_goals", threshold: 6 },
];

export const seasonThresholdProbe: FactProbe = {
  id: "season_threshold",
  family: "threshold",
  title: "A full-season total that only a handful of players have reached",
  sources: ["player_season_stats"],
  variants: VARIANTS,
  maxPopulation: 30,

  sql(variant, p: Params) {
    const def = statDef(variant);
    return (
      "SELECT s.player_id AS subject_id, pl.full_name AS subject_name, " +
      `s.season, NULL::smallint AS week, ${def.expr} AS value, s.season_type, ` +
      "s.team_id AS team " +
      "FROM player_season_stats s " +
      "JOIN players pl ON pl.player_id = s.player_id " +
      `WHERE s.season_type = ${p.add("REG")} AND ${def.expr} >= ${p.add(variant.threshold)} ` +
      "ORDER BY s.season DESC, value DESC " +
      `LIMIT ${p.add(this.maxPopulation + 1)}`
    );
  },

  headline(subject, claim, variant) {
    const def = statDef(variant);
    const who = subjectPhrase(subject, claim);
    const rank =
      claim.population === 1
        ? `the only ${variant.threshold}-${def.label} season`
        : `just the ${ordinal(claim.population)} ${variant.threshold}-${def.label} season`;
    return (
      `${who} finished ${subject.season} with ${subject.value} ${def.label} — ` +
      `${rank} ${sinceClause(claim)}.`
    );
  },

  question(subject, variant) {
    return `most ${statDef(variant).label} in ${subject.season}`;
  },
};
