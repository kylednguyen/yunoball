/** Season lists that drive the season pickers, newest first. */

import { q } from "../db/pool.js";

export async function loadedSeasons(): Promise<number[]> {
  const rows = await q<{ season: number }>("SELECT season FROM seasons ORDER BY season DESC");
  return rows.map((r) => r.season);
}

export async function gameSeasons(): Promise<number[]> {
  const rows = await q<{ season: number }>(
    "SELECT DISTINCT season FROM games ORDER BY season DESC",
  );
  return rows.map((r) => r.season);
}

export async function statSeasons(): Promise<number[]> {
  const rows = await q<{ season: number }>(
    "SELECT DISTINCT season FROM player_season_stats WHERE season_type = 'REG' ORDER BY season DESC",
  );
  return rows.map((r) => r.season);
}

export async function perGameSeasons(): Promise<number[]> {
  const rows = await q<{ season: number }>(
    "SELECT DISTINCT g.season FROM player_game_stats s JOIN games g ON g.game_id = s.game_id ORDER BY g.season DESC",
  );
  return rows.map((r) => r.season);
}
