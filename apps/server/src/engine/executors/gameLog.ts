/** GAME_LOG executor: a player's per-game rows with a position-appropriate
 * stat line, windowed and filtered by the shared game predicates. */

import type { GameLogSpec } from "../spec.js";
import { Params, playerGameRowsSql } from "./shared.js";

export function gameLogSql(spec: GameLogSpec, p: Params): string {
  const pred = `s.player_id = ${p.add(spec.playerId)}`;
  return playerGameRowsSql(spec, p, pred);
}
