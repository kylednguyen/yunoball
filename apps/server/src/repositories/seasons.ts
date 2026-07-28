/** Season lists that drive the season pickers, newest first. */

import { q } from "../db/pool.js";

const seasonList = async (sql: string): Promise<number[]> =>
  (await q<{ season: number }>(sql)).map((r) => r.season);

export const loadedSeasons = () =>
  seasonList("SELECT season FROM seasons ORDER BY season DESC");

export const gameSeasons = () =>
  seasonList("SELECT DISTINCT season FROM games ORDER BY season DESC");

export const statSeasons = () =>
  seasonList("SELECT DISTINCT season FROM player_season_stats WHERE season_type = 'REG' ORDER BY season DESC");

export const perGameSeasons = () =>
  seasonList("SELECT DISTINCT g.season FROM player_game_stats s JOIN games g ON g.game_id = s.game_id ORDER BY g.season DESC");
