/** COMPARE executor: two players' full stat lines aggregated over the same
 * scope (career, one season, or first-N games), leader first. */

import type { CompareSpec } from "../spec.js";
import { ALL_STAT_COLS, COMPARE_SUM_COLS, compareValueExpr, gamePreds, Params } from "./shared.js";

/** One player's aggregate over the scoped games (season type, optional
 * season, optional first-N career games). Sums COMPARE_SUM_COLS so the outer
 * query can compute any comparable stat (including ratios) from the totals. */
function compareSide(pidPh: string, spec: CompareSpec, p: Params): string {
  const where = [`s.player_id = ${pidPh}`, ...gamePreds(spec, p)];
  let inner =
    `SELECT ${COMPARE_SUM_COLS.map((c) => `s.${c}`).join(", ")} ` +
    "FROM player_game_stats s JOIN games g ON g.game_id = s.game_id " +
    `WHERE ${where.join(" AND ")} ` +
    "ORDER BY g.season, g.week";
  if (spec.firstN) inner += ` LIMIT ${p.add(spec.firstN)}`;
  const sums = COMPARE_SUM_COLS.map((c) => `COALESCE(SUM(${c}), 0) AS ${c}`).join(", ");
  return `SELECT ${pidPh} AS pid, COUNT(*) AS games, ${sums} FROM (${inner}) scoped`;
}

export function compareSql(spec: CompareSpec, p: Params): string {
  const p1 = p.add(spec.playerId);
  const p2 = p.add(spec.player2Id);
  const side1 = compareSide(p1, spec, p);
  const side2 = compareSide(p2, spec, p);
  // Display line is the box-score columns; cmp_value is the requested stat,
  // computed from the totals, that decides the leader and the narration.
  const statCols = ALL_STAT_COLS.map((c) => `agg.${c}`).join(", ");
  const valueExpr = compareValueExpr(spec);
  if (!valueExpr) {
    // The parser refuses non-comparable stats before reaching here; this guard
    // turns any gap into a clear error rather than invalid SQL.
    throw new Error(`compare: stat "${spec.stat}" is not comparable head-to-head`);
  }
  return (
    `SELECT p.player_id, p.full_name, agg.games, ${statCols}, ${valueExpr} AS cmp_value ` +
    `FROM (${side1} UNION ALL ${side2}) agg ` +
    "JOIN players p ON p.player_id = agg.pid " +
    "ORDER BY cmp_value DESC"
  );
}
