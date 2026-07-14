/** ESPN media integration — headshots via ESPN's public CDN.
 *
 * The warehouse stays the system of record for every number; ESPN supplies
 * media only. The player-id -> ESPN-id mapping lives in data/espn_ids.json,
 * regenerated with `pnpm --filter @yunoball/server fetch-espn-ids`. Until the
 * mapping covers a player, the frontend renders an initials avatar.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ESPN_IDS_PATH = path.resolve(here, "../../data/espn_ids.json");

let ids: Record<string, number> = {};
try {
  ids = JSON.parse(readFileSync(ESPN_IDS_PATH, "utf-8"));
} catch {
  ids = {}; // generated file not present yet — headshots degrade gracefully
}

// Retired stars are outside the active-roster sync window but still appear in
// historical queries and comparisons. Keep the small verified legacy bridge
// here so those answer templates receive the same real headshots as active
// players without changing any stats source.
const LEGACY_ESPN_IDS: Record<string, number> = {
  "00-0010346": 1428, // Peyton Manning
  "00-0019596": 2330, // Tom Brady
};

export function headshotUrl(playerId: string): string | null {
  const espnId = ids[playerId] ?? LEGACY_ESPN_IDS[playerId];
  return espnId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : null;
}
