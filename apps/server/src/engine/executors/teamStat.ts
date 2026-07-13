/** TEAM_STAT executor: one team's aggregate over a season, range, or since
 * coverage began. Points come from team_game_stats; player-produced stats
 * (passing/rushing/receiving yards, touchdowns) aggregate the game log by
 * the team's players. */

import type { TeamStatSpec } from "../spec.js";
import { gamePreds, Params, statDef } from "./shared.js";

export function teamStatSql(spec: TeamStatSpec, p: Params): string {
  if (spec.metric) {
    // Points scored/allowed from the team-game fact table.
    const col = spec.metric === "points_for" ? "t.points_for" : "t.points_against";
    const preds = [
      `t.team_id = ${p.add(spec.teamId)}`,
      `g.season_type = ${p.add(spec.seasonType)}`,
    ];
    if (spec.seasonMin != null && spec.seasonMax != null) {
      preds.push(`g.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`);
    } else if (spec.season != null) {
      preds.push(`g.season = ${p.add(spec.season)}`);
    }
    const valueExpr = spec.perGame
      ? `ROUND(SUM(${col})::numeric / NULLIF(COUNT(*), 0), 1)`
      : `SUM(${col})`;
    return (
      `SELECT ${valueExpr} AS value, COUNT(*) AS games ` +
      "FROM team_game_stats t " +
      "JOIN games g ON g.game_id = t.game_id " +
      `WHERE ${preds.join(" AND ")}`
    );
  }
  // Player-produced team stat: sum the team's player game rows.
  const def = statDef(spec);
  const where = [`s.team_id = ${p.add(spec.teamId)}`, ...gamePreds(spec, p)];
  const valueExpr = spec.perGame
    ? `ROUND(SUM(${def.expr})::numeric / NULLIF(COUNT(DISTINCT s.game_id), 0), 1)`
    : `SUM(${def.expr})`;
  return (
    `SELECT ${valueExpr} AS value, COUNT(DISTINCT s.game_id) AS games ` +
    "FROM player_game_stats s " +
    "JOIN games g ON g.game_id = s.game_id " +
    `WHERE ${where.join(" AND ")}`
  );
}
