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

export function headshotUrl(playerId: string): string | null {
  const espnId = ids[playerId];
  return espnId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : null;
}
