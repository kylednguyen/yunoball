/** Threshold-count executors.
 *
 *   GAME_COUNT       — one player's qualifying games ("300-yard games")
 *   QUALIFYING_COUNT — how many players cleared a season/career threshold
 */

import type { GameCountSpec, QualifyingCountSpec } from "../spec.js";
import {
  gamePreds, Params, passerRatingExpr, ratioFloor, ratioRowExpr, statDef, sumValueExpr,
} from "./shared.js";

export function gameCountSql(spec: GameCountSpec, p: Params): string {
  // Qualifying games: list them and window-count the full set.
  const def = statDef(spec);
  // Ratio thresholds must compare the per-game ratio (yards per carry), not the
  // raw numerator (rushing yards) — otherwise "games over 5 yards per carry"
  // counts every game with >5 rushing yards.
  const valueExpr =
    def.formula === "passer_rating"
      ? passerRatingExpr(false)
      : def.ratio ? ratioRowExpr(def) : def.expr;
  const opSql = { ">": ">", ">=": ">=", "<": "<" }[spec.threshold.op];
  const where = [
    `s.player_id = ${p.add(spec.playerId)}`,
    ...gamePreds(spec, p),
    `${valueExpr} ${opSql} ${p.add(spec.threshold.value)}`,
  ];
  return (
    "SELECT p.player_id, p.full_name, g.season, g.week, " +
    "CASE WHEN s.team_id = g.home_team THEN g.away_team " +
    "ELSE g.home_team END AS opponent, " +
    `${valueExpr} AS value, COUNT(*) OVER () AS qualifying_games ` +
    "FROM player_game_stats s " +
    "JOIN games g ON g.game_id = s.game_id " +
    "JOIN players p ON p.player_id = s.player_id " +
    `WHERE ${where.join(" AND ")} ` +
    `ORDER BY value DESC, g.season DESC, g.week LIMIT ${p.add(spec.limit)}`
  );
}

export function qualifyingCountSql(spec: QualifyingCountSpec, p: Params): string {
  const def = statDef(spec);
  const op = { ">": ">", ">=": ">=", "<": "<" }[spec.threshold.op];
  const join = spec.position ? "JOIN players p ON p.player_id = s.player_id " : "";
  const posPred = spec.position ? ` AND p.position = ${p.add(spec.position)}` : "";
  if (spec.scope === "career") {
    // Ratio stats need a volume floor so tiny samples don't clear the bar.
    const having = def.ratio
      ? `HAVING ${sumValueExpr(def)} ${op} ${p.add(spec.threshold.value)} ` +
        `AND SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(ratioFloor(def, "career"))}`
      : `HAVING SUM(${def.expr}) ${op} ${p.add(spec.threshold.value)}`;
    return (
      "SELECT COUNT(*) AS qualifying_players FROM (" +
      "SELECT s.player_id FROM player_season_stats s " + join +
      `WHERE s.season_type = ${p.add(spec.seasonType)}${posPred} ` +
      `GROUP BY s.player_id ${having}) x`
    );
  }
  const preds = [`s.season_type = ${p.add(spec.seasonType)}`];
  if (spec.season != null) preds.push(`s.season = ${p.add(spec.season)}`);
  const valuePred =
    def.formula === "passer_rating"
      ? `${passerRatingExpr(false)} ${op} ${p.add(spec.threshold.value)} ` +
        `AND COALESCE(s.attempts, 0) >= ${p.add(ratioFloor(def, "season"))}`
      : def.ratio
        ? `${ratioRowExpr(def)} ${op} ${p.add(spec.threshold.value)} ` +
          `AND COALESCE(s.${def.ratio.den}, 0) >= ${p.add(ratioFloor(def, "season"))}`
        : `${def.expr} ${op} ${p.add(spec.threshold.value)}`;
  return (
    "SELECT COUNT(*) AS qualifying_players FROM player_season_stats s " + join +
    `WHERE ${preds.join(" AND ")}${posPred} AND ${valuePred}`
  );
}
