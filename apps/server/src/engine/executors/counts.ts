/** Threshold-count executors.
 *
 *   GAME_COUNT         — one player's qualifying games ("300-yard games")
 *   GAME_COUNT_LEADERS — most qualifying games per player, ranked by count
 *   QUALIFYING_COUNT   — how many players cleared a season/career threshold
 */

import type { GameCountLeadersSpec, GameCountSpec, QualifyingCountSpec } from "../spec.js";
import {
  beforeSeasonPred, gamePreds, minAgePred, Params, passerRatingExpr, perGameValueExpr, ratioFloor,
  ratioRowExpr, statDef, sumValueExpr,
} from "./shared.js";

export function gameCountSql(spec: GameCountSpec, p: Params): string {
  // Qualifying games: list them and window-count the full set.
  const def = statDef(spec);
  // Ratio thresholds must compare the per-game ratio (yards per carry), not the
  // raw numerator (rushing yards) — otherwise "games over 5 yards per carry"
  // counts every game with >5 rushing yards.
  const valueExpr = perGameValueExpr(def);
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

/** "Who has the most games with over 300 passing yards?" — GROUP BY player,
 * count the games clearing the bar, rank by count. Same qualifying predicate
 * as gameCountSql; the players join enables position, age ("after turning
 * 30") and experience ("before their fifth season") filters. */
export function gameCountLeadersSql(spec: GameCountLeadersSpec, p: Params): string {
  const def = statDef(spec);
  const valueExpr = perGameValueExpr(def);
  const opSql = { ">": ">", ">=": ">=", "<": "<" }[spec.threshold.op];
  const where = [
    ...gamePreds(spec, p),
    `${valueExpr} ${opSql} ${p.add(spec.threshold.value)}`,
  ];
  if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
  if (spec.minAgeYears != null) where.push(minAgePred(spec.minAgeYears, p));
  if (spec.beforeSeasonN != null) where.push(beforeSeasonPred(spec.beforeSeasonN, p));
  // A second same-game stat threshold, ANDed in: "games with both a rushing
  // and receiving touchdown" — the qualifying game must clear BOTH bars.
  if (spec.andStat && spec.andThreshold) {
    const def2 = statDef({ stat: spec.andStat });
    const valueExpr2 = perGameValueExpr(def2);
    const opSql2 = { ">": ">", ">=": ">=", "<": "<" }[spec.andThreshold.op];
    where.push(`${valueExpr2} ${opSql2} ${p.add(spec.andThreshold.value)}`);
  }
  return (
    "SELECT p.player_id, p.full_name, COUNT(*) AS value " +
    "FROM player_game_stats s " +
    "JOIN games g ON g.game_id = s.game_id " +
    "JOIN players p ON p.player_id = s.player_id " +
    `WHERE ${where.join(" AND ")} ` +
    "GROUP BY p.player_id, p.full_name " +
    `ORDER BY value DESC, p.full_name LIMIT ${p.add(spec.limit)}`
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
