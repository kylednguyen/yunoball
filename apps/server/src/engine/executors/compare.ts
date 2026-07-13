/** COMPARE executor: two players' full stat lines aggregated over the same
 * scope (career, one season, or first-N games), leader first. */

import type { CompareSpec } from "../spec.js";
import { ALL_STAT_COLS, compareOrderCol, gamePreds, Params } from "./shared.js";

/** One player's aggregate over the scoped games (season type, optional
 * season, optional first-N career games). */
function compareSide(pidPh: string, spec: CompareSpec, p: Params): string {
  const where = [`s.player_id = ${pidPh}`, ...gamePreds(spec, p)];
  let inner =
    `SELECT ${ALL_STAT_COLS.map((c) => `s.${c}`).join(", ")} ` +
    "FROM player_game_stats s JOIN games g ON g.game_id = s.game_id " +
    `WHERE ${where.join(" AND ")} ` +
    "ORDER BY g.season, g.week";
  if (spec.firstN) inner += ` LIMIT ${p.add(spec.firstN)}`;
  const sums = ALL_STAT_COLS.map((c) => `COALESCE(SUM(${c}), 0) AS ${c}`).join(", ");
  return `SELECT ${pidPh} AS pid, COUNT(*) AS games, ${sums} FROM (${inner}) scoped`;
}

export function compareSql(spec: CompareSpec, p: Params): string {
  const p1 = p.add(spec.playerId);
  const p2 = p.add(spec.player2Id);
  const side1 = compareSide(p1, spec, p);
  const side2 = compareSide(p2, spec, p);
  const statCols = ALL_STAT_COLS.map((c) => `agg.${c}`).join(", ");
  const orderCol = compareOrderCol(spec);
  return (
    `SELECT p.player_id, p.full_name, agg.games, ${statCols} ` +
    `FROM (${side1} UNION ALL ${side2}) agg ` +
    "JOIN players p ON p.player_id = agg.pid " +
    `ORDER BY agg.${orderCol} DESC`
  );
}
