/** SINGLE_GAME executor: the top single-game marks, league-wide or scoped to
 * a named player ("Derrick Henry most rushing yards in a game"). */

import type { SingleGameSpec } from "../spec.js";
import { gamePreds, Params, perGameValueExpr, statDef } from "./shared.js";

export function singleGameSql(spec: SingleGameSpec, p: Params): string {
  const def = statDef(spec);
  const sgExpr = perGameValueExpr(def);
  // gamePreds carries season/seasonType plus every game window (opponent,
  // teammate, venue, month…) — single-game bests compose them all.
  const preds = [`${sgExpr} > 0`, ...gamePreds(spec, p)];
  if (spec.playerId) preds.push(`s.player_id = ${p.add(spec.playerId)}`);
  return (
    "SELECT p.player_id, p.full_name, g.season, g.week, " +
    "CASE WHEN s.team_id = g.home_team THEN g.away_team " +
    "ELSE g.home_team END AS opponent, " +
    `${sgExpr} AS value ` +
    "FROM player_game_stats s " +
    "JOIN players p ON p.player_id = s.player_id " +
    "JOIN games g ON g.game_id = s.game_id " +
    `WHERE ${preds.join(" AND ")} ` +
    `ORDER BY value DESC, g.season DESC, g.week, p.full_name LIMIT ${p.add(spec.limit)}`
  );
}
