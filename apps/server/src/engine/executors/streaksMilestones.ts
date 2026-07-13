/** Streak and milestone executors.
 *
 *   PLAYER_STREAK — per-game rows with a qualifying flag; the narration
 *                   scans for the longest/current consecutive run.
 *   TEAM_STREAK   — completed games newest-first; narration scans runs.
 *   MILESTONE     — fewest games to reach a cumulative career total.
 */

import type { MilestoneSpec, PlayerStreakSpec, TeamStreakSpec } from "../spec.js";
import { gamePreds, Params, ratioRowExpr, RESULT_COL, ROUND_NAME_SQL, statDef } from "./shared.js";

export function playerStreakSql(spec: PlayerStreakSpec, p: Params): string {
  const def = statDef(spec);
  // Ratio streaks qualify on the per-game ratio, not the raw numerator.
  const valueExpr = def.ratio ? ratioRowExpr(def) : def.expr;
  const op = spec.threshold ? { ">": ">", ">=": ">=", "<": "<" }[spec.threshold.op] : ">";
  const bar = p.add(spec.threshold?.value ?? 0);
  const where = [`s.player_id = ${p.add(spec.playerId)}`, ...gamePreds(spec, p)];
  // Oldest-first so the narration can scan runs chronologically.
  return (
    `SELECT g.season, g.week, ${valueExpr} AS value, ` +
    `(${valueExpr} ${op} ${bar}) AS qualifies ` +
    "FROM player_game_stats s " +
    "JOIN games g ON g.game_id = s.game_id " +
    `WHERE ${where.join(" AND ")} ` +
    "ORDER BY g.season, g.week LIMIT 500"
  );
}

export function teamStreakSql(spec: TeamStreakSpec, p: Params): string {
  const tid = p.add(spec.teamId);
  const inner =
    "SELECT g.season, g.week, g.game_date, " +
    `${ROUND_NAME_SQL} AS round, ` +
    `CASE WHEN g.home_team = ${tid} THEN g.away_team ELSE g.home_team END AS opponent, ` +
    `CASE WHEN g.home_team = ${tid} THEN g.home_score ELSE g.away_score END AS team_score, ` +
    `CASE WHEN g.home_team = ${tid} THEN g.away_score ELSE g.home_score END AS opp_score ` +
    "FROM games g " +
    `WHERE g.home_score IS NOT NULL AND (g.home_team = ${tid} OR g.away_team = ${tid})`;
  return (
    `SELECT ts.*, ${RESULT_COL} FROM (${inner}) ts ` +
    "ORDER BY ts.season DESC, ts.week DESC LIMIT 400"
  );
}

export function milestoneSql(spec: MilestoneSpec, p: Params): string {
  const def = statDef(spec);
  const stype = p.add(spec.seasonType);
  // Cumulative career totals per player in game order; first game index at or
  // past the target is the race result. Restricted to players whose first
  // game is inside the warehouse so partial careers can't fake a fast start.
  return (
    "WITH cum AS (" +
    `SELECT s.player_id, SUM(${def.expr}) OVER w AS running, ` +
    "ROW_NUMBER() OVER w AS game_num " +
    "FROM player_game_stats s JOIN games g ON g.game_id = s.game_id " +
    `WHERE g.season_type = ${stype} ` +
    "WINDOW w AS (PARTITION BY s.player_id ORDER BY g.season, g.week)" +
    "), hit AS (" +
    `SELECT player_id, MIN(game_num) AS games_to FROM cum WHERE running >= ${p.add(spec.target)} GROUP BY player_id` +
    ") " +
    "SELECT p.player_id, p.full_name, hit.games_to " +
    "FROM hit JOIN players p ON p.player_id = hit.player_id " +
    `ORDER BY hit.games_to ASC, p.full_name LIMIT ${p.add(spec.limit)}`
  );
}
