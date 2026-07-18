/** Player headshots — served from the warehouse (nflverse id crosswalk).
 *
 * The players table carries headshot_url + espn_id, keyed on gsis id by the
 * player_ids ingest step (never name-matched). loadHeadshots() builds the
 * in-memory map once at boot; headshotUrl() stays a sync lookup so the
 * row-mapping hot paths (search, leaderboards, players, fantasy, games,
 * teams, engine pipeline) are unchanged. nflverse's headshot_url wins;
 * espn_id constructs the ESPN CDN URL as fallback.
 */

import { q } from "../db/pool.js";
import { logger } from "./logger.js";

const urls = new Map<string, string>();

export async function loadHeadshots(): Promise<void> {
  try {
    const rows = await q<{ player_id: string; espn_id: string | null; headshot_url: string | null }>(
      `SELECT player_id, espn_id, headshot_url FROM players
       WHERE headshot_url IS NOT NULL OR espn_id IS NOT NULL`,
    );
    urls.clear();
    for (const r of rows) {
      urls.set(
        r.player_id,
        r.headshot_url ?? `https://a.espncdn.com/i/headshots/nfl/players/full/${r.espn_id}.png`,
      );
    }
    logger.info({ players: urls.size }, "headshot map loaded from warehouse");
  } catch (err) {
    // Missing columns / unreachable DB degrade to initials avatars, not a crash.
    logger.warn({ err: String(err) }, "headshot map load failed — initials avatars until restart");
  }
}

export function headshotUrl(playerId: string): string | null {
  return urls.get(playerId) ?? null;
}
