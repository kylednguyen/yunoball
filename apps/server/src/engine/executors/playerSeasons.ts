/** PLAYER_SEASONS executor: the season-by-season line for a bare player
 * mention, with a position-appropriate stat block. */

import type { PlayerSeasonsSpec } from "../spec.js";
import { Params, seasonStatCols } from "./shared.js";

export function playerSeasonsSql(spec: PlayerSeasonsSpec, p: Params): string {
  // No name column: the answer's player card already identifies him, and
  // narration reads the name from spec.player.
  return (
    "SELECT s.season, s.team_id AS team, " +
    `COALESCE(s.games_played, 0) AS gp, ${seasonStatCols(spec.position).join(", ")} ` +
    "FROM player_season_stats s " +
    `WHERE s.player_id = ${p.add(spec.playerId)} AND s.season_type = 'REG' ` +
    "ORDER BY s.season DESC"
  );
}
