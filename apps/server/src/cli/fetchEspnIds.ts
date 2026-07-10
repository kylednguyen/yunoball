/** Regenerate data/espn_ids.json — GSIS player id -> ESPN player id.
 *
 * Pulls every NFL team roster from ESPN's public site API and name-matches
 * players active in the warehouse's two most recent seasons (retired players
 * aren't on ESPN rosters; the frontend shows an initials avatar for them).
 * Idempotent: rewrites the file in full each run.
 *
 *    pnpm --filter @yunoball/server fetch-espn-ids
 */

import { writeFileSync } from "node:fs";
import { closePools, q } from "../db/pool.js";
import { ESPN_IDS_PATH } from "../lib/espn.js";
import { logger } from "../lib/logger.js";

const TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";
const ROSTER_URL = (teamId: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** 'Michael Pittman Jr.' -> 'michael pittman'; 'D.J. Moore' -> 'dj moore'. */
function norm(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .split(/\s+/)
    .filter((w) => !SUFFIXES.has(w))
    .join(" ");
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main(): Promise<void> {
  const teams = (await getJson(TEAMS_URL)).sports[0].leagues[0].teams as any[];
  const espnByName = new Map<string, number>();
  for (const entry of teams) {
    const roster = await getJson(ROSTER_URL(entry.team.id));
    for (const group of roster.athletes ?? []) {
      for (const athlete of group.items ?? []) {
        const key = norm(athlete.fullName);
        if (!espnByName.has(key)) espnByName.set(key, Number(athlete.id));
      }
    }
  }

  const players = await q<{ player_id: string; full_name: string }>(
    `SELECT DISTINCT p.player_id, p.full_name
     FROM players p JOIN player_season_stats s USING (player_id)
     WHERE s.season >= (SELECT MAX(season) - 1 FROM player_season_stats)
     ORDER BY p.player_id`,
  );

  const mapping: Record<string, number> = {};
  const missing: string[] = [];
  for (const p of players) {
    const espnId = espnByName.get(norm(p.full_name));
    if (espnId === undefined) missing.push(p.full_name);
    else mapping[p.player_id] = espnId;
  }

  writeFileSync(ESPN_IDS_PATH, JSON.stringify(mapping, null, 0) + "\n");
  logger.info(
    { matched: Object.keys(mapping).length, of: players.length, out: ESPN_IDS_PATH },
    "espn id map regenerated",
  );
  if (missing.length) {
    logger.info({ count: missing.length }, "unmatched players keep the initials avatar");
  }
}

main()
  .catch((err) => {
    logger.error(err, "fetch-espn-ids failed");
    process.exitCode = 1;
  })
  .finally(() => closePools());
