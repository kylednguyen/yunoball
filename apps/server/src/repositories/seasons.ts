/** Season lists that drive the season pickers, newest first.
 *
 * "Loaded" means *has data to show*, not "appears in the schedule". Next
 * season's fixtures land months before its first kickoff, so a list built from
 * the schedule alone makes every default land on a season with nothing in it —
 * empty leaderboards, an all-0-0 table, a scores page on a week nobody played. */

import { q } from "../db/pool.js";

const seasonList = async (sql: string): Promise<number[]> =>
  (await q<{ season: number }>(sql)).map((r) => r.season);

/** Seasons with at least one played game — drives scores, standings, teams. */
export const gameSeasons = () =>
  seasonList(
    `SELECT DISTINCT season FROM games
     WHERE home_score IS NOT NULL AND away_score IS NOT NULL
     ORDER BY season DESC`,
  );

export const statSeasons = () =>
  seasonList("SELECT DISTINCT season FROM player_season_stats WHERE season_type = 'REG' ORDER BY season DESC");

export const perGameSeasons = () =>
  seasonList("SELECT DISTINCT g.season FROM player_game_stats s JOIN games g ON g.game_id = s.game_id ORDER BY g.season DESC");
