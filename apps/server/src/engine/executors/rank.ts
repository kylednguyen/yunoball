/** PLAYER_RANK executor: one player's league rank on a stat over a scope
 * (career / season / range). */

import type { PlayerRankSpec } from "../spec.js";
import { Params, positionPred, ratioFloor, statDef, sumValueExpr } from "./shared.js";

export function rankSql(spec: PlayerRankSpec, p: Params): string {
  const def = statDef(spec);
  const valueExpr = sumValueExpr(def);
  // pbp-derived stats have no season rollup: rank over the game table.
  if (def.table === "advanced") {
    const preds = [`g.season_type = ${p.add(spec.seasonType)}`];
    if (spec.seasonMin != null && spec.seasonMax != null) {
      preds.push(`g.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`);
    } else if (spec.scope !== "career" && spec.season != null) {
      preds.push(`g.season = ${p.add(spec.season)}`);
    }
    const posPred = spec.position ? ` AND ${positionPred(spec.position, p)}` : "";
    // Volume floor: ratio stats gate on their denominator; plain EPA sums
    // gate on the matching plays column so the pool is that role's players.
    const playsCol = def.ratio ? null : def.expr.replace("_epa", "_plays");
    const having = def.ratio
      ? ` HAVING SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(ratioFloor(def, spec.scope))}`
      : ` HAVING SUM(COALESCE(${playsCol}, 0)) >= ${p.add(ratioFloor(def, spec.scope))}`;
    return (
      "WITH ranked AS (" +
      `SELECT p.player_id, p.full_name, ${valueExpr} AS value, ` +
      `RANK() OVER (ORDER BY ${valueExpr} DESC NULLS LAST) AS rk, ` +
      "COUNT(*) OVER () AS total_players " +
      "FROM player_game_advanced s " +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${preds.join(" AND ")}${posPred} ` +
      `GROUP BY p.player_id, p.full_name${having}) ` +
      `SELECT * FROM ranked WHERE player_id = ${p.add(spec.playerId)}`
    );
  }
  const preds = [`s.season_type = ${p.add(spec.seasonType)}`];
  if (spec.seasonMin != null && spec.seasonMax != null) {
    preds.push(`s.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`);
  } else if (spec.scope !== "career" && spec.season != null) {
    preds.push(`s.season = ${p.add(spec.season)}`);
  }
  const posPred = spec.position ? ` AND p.position = ${p.add(spec.position)}` : "";
  // Ratio ranks need a volume floor; counted denominators exclude non-producers
  // so "1st of N" reflects players who actually recorded the stat.
  const having = def.ratio
    ? ` HAVING SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(ratioFloor(def, spec.scope))}`
    : def.formula === "passer_rating"
      ? ` HAVING SUM(COALESCE(s.attempts, 0)) >= ${p.add(ratioFloor(def, spec.scope))}`
      : ` HAVING SUM(${def.expr}) > 0`;
  return (
    "WITH ranked AS (" +
    `SELECT p.player_id, p.full_name, ${valueExpr} AS value, ` +
    `RANK() OVER (ORDER BY ${valueExpr} DESC) AS rk, ` +
    "COUNT(*) OVER () AS total_players " +
    "FROM player_season_stats s JOIN players p ON p.player_id = s.player_id " +
    `WHERE ${preds.join(" AND ")}${posPred} ` +
    `GROUP BY p.player_id, p.full_name${having}) ` +
    `SELECT * FROM ranked WHERE player_id = ${p.add(spec.playerId)}`
  );
}
