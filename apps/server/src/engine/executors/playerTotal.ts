/** PLAYER_TOTAL executor: one player's season/career/range total (or per-game
 * rate), widened to per-game rows whenever a game-level filter applies. */

import type { PlayerTotalSpec } from "../spec.js";
import {
  gamePreds, needsGameLog, Params, playerGameRowsSql, ratioRowExpr, ROOKIE_PRED, statDef,
} from "./shared.js";

export function playerTotalSql(spec: PlayerTotalSpec, p: Params): string {
  const def = statDef(spec);
  const playerPred = spec.playerId
    ? `s.player_id = ${p.add(spec.playerId)}`
    : `lower(p.full_name) LIKE ${p.add(`%${(spec.player ?? "").toLowerCase()}%`)}`;

  if (spec.median && spec.playerId) {
    // Median of the per-game values over the scoped game log.
    const valueExpr = def.ratio ? ratioRowExpr(def) : def.expr;
    const where = [playerPred, ...gamePreds(spec, p)];
    return (
      `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${valueExpr}) AS total, ` +
      "COUNT(*) AS games " +
      "FROM player_game_stats s " +
      "JOIN games g ON g.game_id = s.game_id " +
      `WHERE ${where.join(" AND ")}`
    );
  }

  if (needsGameLog(spec) && spec.playerId) {
    // Per-game rows plus a window total: the answer narrates the total and
    // the table shows the games behind it.
    return playerGameRowsSql(spec, p, playerPred);
  }

  const stype = p.add(spec.seasonType);
  if (spec.rookie) {
    return (
      `SELECT p.player_id, p.full_name, s.season, ${def.expr} AS value ` +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${playerPred} AND s.season_type = ${stype} AND ${ROOKIE_PRED}`
    );
  }
  if (spec.scope === "career") {
    // A season range ("from 2021 to 2023") bounds the career sum.
    const rangePred =
      spec.seasonMin != null && spec.seasonMax != null
        ? ` AND s.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`
        : "";
    const totalExpr = spec.perGame
      ? `ROUND(SUM(${def.expr})::numeric / NULLIF(SUM(COALESCE(s.games_played, 0)), 0), 1)`
      : `SUM(${def.expr})`;
    return (
      `SELECT p.player_id, p.full_name, ${totalExpr} AS total ` +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${playerPred} AND s.season_type = ${stype}${rangePred} ` +
      "GROUP BY p.player_id, p.full_name"
    );
  }
  const where = [playerPred, `s.season_type = ${stype}`];
  if (spec.season != null) where.push(`s.season = ${p.add(spec.season)}`);
  const valueExpr = spec.perGame
    ? `ROUND(${def.expr}::numeric / NULLIF(COALESCE(s.games_played, 0), 0), 1) AS value`
    : `${def.expr} AS value`;
  return (
    `SELECT p.player_id, p.full_name, s.season, ${valueExpr} ` +
    "FROM player_season_stats s " +
    "JOIN players p ON p.player_id = s.player_id " +
    `WHERE ${where.join(" AND ")} ` +
    "ORDER BY s.season"
  );
}
