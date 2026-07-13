/** LEADERS executor: season boards, career/all-time boards, positional and
 * rookie filters, per-game rates, and game-log aggregation whenever the board
 * needs game-level filters or a game-sourced stat. */

import type { LeadersSpec } from "../spec.js";
import {
  aggExpr, gamePreds, Params, ratioFloor, ROOKIE_PRED, statDef,
} from "./shared.js";

export function leadersSql(spec: LeadersSpec, p: Params): string {
  const def = statDef(spec);
  // Week/venue/month-filtered leaders can't use season rollups — aggregate
  // the game log instead ("most touchdowns in week 22", "at home").
  if (
    def.source !== "game" &&
    (spec.venue || spec.weekMin != null || spec.weekMax != null ||
      spec.month != null || spec.primetime || spec.tempMax != null || spec.sbOnly)
  ) {
    const where = gamePreds(spec, p);
    if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
    return (
      `SELECT p.player_id, p.full_name, COUNT(*) AS games, SUM(${def.expr}) AS value ` +
      "FROM player_game_stats s " +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")}` +
      (spec.position ? ` AND p.position = ${p.add(spec.position)}` : "") +
      " GROUP BY p.player_id, p.full_name " +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"}, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }
  if (def.source === "game") {
    // Game-sourced leaders: aggregate the game log. Ratio stats (completion
    // %, yards per carry) get a volume qualifier so tiny samples can't top
    // the board; plain game-sourced sums (air yards) rank directly.
    const where = gamePreds(spec, p);
    if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
    const having = def.ratio
      ? `HAVING SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
      : def.formula === "passer_rating"
        ? `HAVING SUM(COALESCE(s.attempts, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
        : "";
    return (
      `SELECT p.player_id, p.full_name, ${aggExpr(spec)} AS value ` +
      "FROM player_game_stats s " +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")}` +
      (spec.position ? ` AND p.position = ${p.add(spec.position)}` : "") +
      " GROUP BY p.player_id, p.full_name " + having +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }
  if (spec.scope === "career") {
    const stype = p.add(spec.seasonType);
    // A season range ("receiving yards from 2021 to 2023") bounds the sum.
    const rangePred =
      spec.seasonMin != null && spec.seasonMax != null
        ? ` AND s.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`
        : "";
    // Per-game career board divides career total by career games, with a
    // volume floor so a one-game cameo can't top the list.
    const valueSel = spec.perGame
      ? `ROUND(SUM(${def.expr})::numeric / NULLIF(SUM(COALESCE(s.games_played, 0)), 0), 1)`
      : `SUM(${def.expr})`;
    const perGameFloor = spec.perGame
      ? `HAVING SUM(COALESCE(s.games_played, 0)) >= ${p.add(16)} `
      : "";
    return (
      `SELECT p.player_id, p.full_name, COUNT(*) AS seasons, ${valueSel} AS value ` +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE s.season_type = ${stype}${rangePred}` +
      (spec.teamId ? ` AND s.team_id = ${p.add(spec.teamId)}` : "") +
      (spec.position ? ` AND p.position = ${p.add(spec.position)}` : "") +
      " GROUP BY p.player_id, p.full_name " + perGameFloor +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"}, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }
  const where = [`s.season_type = ${p.add(spec.seasonType)}`];
  if (spec.season != null) where.push(`s.season = ${p.add(spec.season)}`);
  if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
  if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
  if (spec.rookie) where.push(ROOKIE_PRED);
  // Ascending boards need a floor, or benchwarmers sweep "fewest X".
  if (spec.dir === "asc") where.push("COALESCE(s.games_played, 0) >= 8");
  // A per-game board is a rate, with the same games floor.
  if (spec.perGame) where.push("COALESCE(s.games_played, 0) >= 8");
  const valueSel = spec.perGame
    ? `ROUND(${def.expr}::numeric / NULLIF(COALESCE(s.games_played, 0), 0), 1)`
    : `${def.expr}`;
  return (
    `SELECT p.player_id, p.full_name, s.season, ${valueSel} AS value ` +
    "FROM player_season_stats s " +
    "JOIN players p ON p.player_id = s.player_id " +
    `WHERE ${where.join(" AND ")} ` +
    `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"}, s.season DESC, p.full_name ` +
    `LIMIT ${p.add(spec.limit)}`
  );
}
