/** TEAM_BIO executor: a team's identity card — division, conference, and the
 * stadium from its most recent home game. */

import type { TeamBioSpec } from "../spec.js";
import { Params } from "./shared.js";

export function teamBioSql(spec: TeamBioSpec, p: Params): string {
  return (
    "SELECT t.team_id, t.name, t.nickname, t.conference, t.division, " +
    "latest.stadium " +
    "FROM teams t " +
    "LEFT JOIN LATERAL (" +
    "SELECT g.stadium FROM games g " +
    "WHERE g.home_team = t.team_id AND g.stadium IS NOT NULL " +
    "ORDER BY g.game_date DESC NULLS LAST LIMIT 1) latest ON true " +
    `WHERE t.team_id = ${p.add(spec.teamId)}`
  );
}
