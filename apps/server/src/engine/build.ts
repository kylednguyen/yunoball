/** The execution dispatcher: one AST node in, safe parameterized SQL out.
 *
 * Each intent has exactly one executor (engine/executors/) typed on its own
 * node, and the switch below is exhaustiveness-checked — adding an Intent
 * without an executor is a compile error. Narration lives in narrate.ts;
 * this module re-exports it so the public engine surface stays one import.
 */

import type { QuerySpec } from "./spec.js";
import { bioSql } from "./executors/bio.js";
import { compareSql } from "./executors/compare.js";
import { gameCountSql, qualifyingCountSql } from "./executors/counts.js";
import { draftSql } from "./executors/draft.js";
import { gameLogSql } from "./executors/gameLog.js";
import { gameRowsSql } from "./executors/games.js";
import { leadersSql } from "./executors/leaders.js";
import { playerSeasonsSql } from "./executors/playerSeasons.js";
import { playerTotalSql } from "./executors/playerTotal.js";
import { rankSql } from "./executors/rank.js";
import { scoringSql } from "./executors/scoring.js";
import { Params } from "./executors/shared.js";
import { singleGameSql } from "./executors/singleGame.js";

export { narrate, roman, sbName } from "./narrate.js";

export function buildSql(spec: QuerySpec): { sql: string; params: unknown[] } {
  const p = new Params();
  const done = (sql: string) => ({ sql, params: p.values });

  switch (spec.intent) {
    case "player_bio": return done(bioSql(spec, p));
    case "qualifying_count": return done(qualifyingCountSql(spec, p));
    case "player_rank": return done(rankSql(spec, p));
    case "game_log": return done(gameLogSql(spec, p));
    case "player_seasons": return done(playerSeasonsSql(spec, p));
    case "team_game_log":
    case "game_result": return done(gameRowsSql(spec, p));
    case "draft_pick": return done(draftSql(spec, p));
    case "compare": return done(compareSql(spec, p));
    case "scoring": return done(scoringSql(spec, p));
    case "game_count": return done(gameCountSql(spec, p));
    case "leaders": return done(leadersSql(spec, p));
    case "player_total": return done(playerTotalSql(spec, p));
    case "single_game": return done(singleGameSql(spec, p));
    default: {
      // Exhaustiveness guard: a new Intent without an executor won't compile.
      const _never: never = spec;
      throw new Error(`No executor for intent: ${(_never as QuerySpec).intent}`);
    }
  }
}
