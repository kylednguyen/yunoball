/** TEAM_ROSTER executor: who played for a team in a season, ordered by
 * production so the stars lead the list. */

import type { TeamRosterSpec } from "../spec.js";
import { Params, positionPred } from "./shared.js";

export function teamRosterSql(spec: TeamRosterSpec, p: Params): string {
  const preds = [
    `s.team_id = ${p.add(spec.teamId)}`,
    "s.season_type = 'REG'",
  ];
  if (spec.season != null) preds.push(`s.season = ${p.add(spec.season)}`);
  if (spec.position) preds.push(positionPred(spec.position, p));
  return (
    "SELECT p.player_id, p.full_name, p.position, " +
    "COALESCE(s.games_played, 0) AS gp, " +
    "COUNT(*) OVER () AS roster_size " +
    "FROM player_season_stats s " +
    "JOIN players p ON p.player_id = s.player_id " +
    `WHERE ${preds.join(" AND ")} ` +
    "ORDER BY COALESCE(s.fantasy_points_ppr, 0) + COALESCE(s.tackles, 0) + 6 * COALESCE(s.def_sacks, 0) DESC, p.full_name " +
    `LIMIT ${p.add(spec.limit)}`
  );
}
