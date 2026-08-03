/** Consecutive-game streak probes.
 *
 * "Six straight games with 100+ receiving yards — the first such run since
 * 2019." Classic gaps-and-islands: number the player's games, number them
 * again partitioned by whether they qualified, and the difference is constant
 * within a run.
 *
 * This is the most expensive probe family (a window over the whole game log),
 * which is exactly why mining runs weekly on a schedule and never in the
 * request path.
 */

import { Params, statDef } from "../../engine/executors/shared.js";
import { ordinal, sinceClause, subjectPhrase } from "../claim.js";
import type { FactProbe, ProbeVariant } from "../types.js";

const VARIANTS: ProbeVariant[] = [
  { key: "rec100x6", stat: "receiving_yards", threshold: 100, runLength: 6 },
  { key: "rush100x8", stat: "rushing_yards", threshold: 100, runLength: 8 },
  { key: "pass300x5", stat: "passing_yards", threshold: 300, runLength: 5 },
  { key: "passtd3x6", stat: "passing_tds", threshold: 3, runLength: 6 },
  { key: "sack1x8", stat: "def_sacks", threshold: 1, runLength: 8 },
];

export const streakProbe: FactProbe = {
  id: "game_streak",
  family: "streak",
  title: "A long run of consecutive games clearing a threshold",
  sources: ["player_game_stats"],
  variants: VARIANTS,
  maxPopulation: 30,

  sql(variant, p: Params) {
    const def = statDef(variant);
    return (
      "WITH log AS (" +
      "SELECT s.player_id, g.season, g.week, " +
      `(COALESCE(${def.expr}, 0) >= ${p.add(variant.threshold)}) AS ok, ` +
      "ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY g.season, g.week) AS rn " +
      "FROM player_game_stats s " +
      "JOIN games g ON g.game_id = s.game_id " +
      `WHERE g.season_type = ${p.add("REG")}` +
      "), islands AS (" +
      "SELECT player_id, season, week, rn, ok, " +
      "rn - ROW_NUMBER() OVER (PARTITION BY player_id, ok ORDER BY rn) AS grp " +
      "FROM log" +
      "), runs AS (" +
      "SELECT player_id, COUNT(*) AS value, " +
      "(ARRAY_AGG(season ORDER BY rn DESC))[1] AS season, " +
      "(ARRAY_AGG(week ORDER BY rn DESC))[1] AS week " +
      "FROM islands WHERE ok GROUP BY player_id, grp " +
      `HAVING COUNT(*) >= ${p.add(variant.runLength!)}` +
      ") " +
      "SELECT r.player_id AS subject_id, pl.full_name AS subject_name, " +
      "r.season, r.week, r.value, 'REG' AS season_type " +
      "FROM runs r JOIN players pl ON pl.player_id = r.player_id " +
      "ORDER BY r.season DESC, r.week DESC, r.value DESC " +
      `LIMIT ${p.add(this.maxPopulation + 1)}`
    );
  },

  headline(subject, claim, variant) {
    const def = statDef(variant);
    const who = subjectPhrase(subject, claim);
    const rank =
      claim.population === 1
        ? `the only run that long`
        : `just the ${ordinal(claim.population)} such run`;
    return (
      `${who} has ${subject.value} straight games with ${variant.threshold}+ ` +
      `${def.label}, through Week ${subject.week} of ${subject.season} — ` +
      `${rank} ${sinceClause(claim)}.`
    );
  },

  question(subject, variant) {
    return `${subject.subject_name} ${statDef(variant).label} game log`;
  },
};
