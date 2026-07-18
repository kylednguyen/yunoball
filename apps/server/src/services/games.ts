/** Scores & results by season/week, plus performers of the week. */

import type { GamesResponse, PerformersResponse } from "@yunoball/types";
import { q } from "../db/pool.js";
import { ApiError } from "../lib/errors.js";
import { headshotUrl } from "../lib/espn.js";
import { round } from "../lib/round.js";
import { gameSeasons, perGameSeasons } from "../repositories/seasons.js";

export async function getGames(season?: number, week?: number): Promise<GamesResponse> {
  const seasons = await gameSeasons();
  if (seasons.length === 0) throw new ApiError(503, "No games loaded.");
  const targetSeason = season ?? seasons[0]!;
  if (!seasons.includes(targetSeason)) {
    throw new ApiError(404, `Season ${targetSeason} not loaded.`);
  }

  const weeks = (
    await q<{ week: number }>(
      "SELECT DISTINCT week FROM games WHERE season = $1 ORDER BY week",
      [targetSeason],
    )
  ).map((r) => r.week);
  const targetWeek = week ?? weeks.at(-1)!;
  if (!weeks.includes(targetWeek)) {
    throw new ApiError(404, `Week ${targetWeek} not loaded for ${targetSeason}.`);
  }

  const rows = await q<{
    game_id: string; season: number; week: number; game_date: string | null;
    home_team: string; home_name: string; home_nick: string | null; home_score: number | null;
    away_team: string; away_name: string; away_nick: string | null; away_score: number | null;
  }>(
    `SELECT g.game_id, g.season, g.week, g.game_date,
            g.home_team, ht.name AS home_name, ht.nickname AS home_nick, g.home_score,
            g.away_team, aw.name AS away_name, aw.nickname AS away_nick, g.away_score
     FROM games g
     JOIN teams ht ON ht.team_id = g.home_team
     JOIN teams aw ON aw.team_id = g.away_team
     WHERE g.season = $1 AND g.week = $2
     ORDER BY g.game_date, g.game_id`,
    [targetSeason, targetWeek],
  );

  return {
    season: targetSeason,
    seasons,
    week: targetWeek,
    weeks,
    games: rows.map((r) => ({
      game_id: r.game_id,
      season: r.season,
      week: r.week,
      date: r.game_date,
      home: { team_id: r.home_team, name: r.home_name, nickname: r.home_nick, score: r.home_score },
      away: { team_id: r.away_team, name: r.away_name, nickname: r.away_nick, score: r.away_score },
      final: r.home_score !== null && r.away_score !== null,
    })),
  };
}

interface PerformerRow {
  player_id: string; name: string; position: string | null; team_id: string;
  opponent: string; passing_yards: number; passing_tds: number; interceptions: number;
  rushing_yards: number; rushing_tds: number; receptions: number;
  receiving_yards: number; receiving_tds: number; fantasy_points_ppr: number;
}

/** Position-agnostic box score built from whatever the player did. */
function statLine(r: PerformerRow): string {
  const parts: string[] = [];
  if (r.passing_yards || r.passing_tds) {
    let seg = `${r.passing_yards} pass yds`;
    if (r.passing_tds) seg += `, ${r.passing_tds} pass TD`;
    if (r.interceptions) seg += `, ${r.interceptions} INT`;
    parts.push(seg);
  }
  if (r.rushing_yards || r.rushing_tds) {
    let seg = `${r.rushing_yards} rush yds`;
    if (r.rushing_tds) seg += `, ${r.rushing_tds} rush TD`;
    parts.push(seg);
  }
  if (r.receptions || r.receiving_yards || r.receiving_tds) {
    let seg = `${r.receptions} rec, ${r.receiving_yards} yds`;
    if (r.receiving_tds) seg += `, ${r.receiving_tds} rec TD`;
    parts.push(seg);
  }
  return parts.join(", ") || "no production";
}

/** Top fantasy (PPR) performances for a week, with the full stat line. */
export async function getPerformers(
  season?: number, week?: number, limit = 10,
): Promise<PerformersResponse> {
  const seasons = await perGameSeasons();
  if (seasons.length === 0) throw new ApiError(503, "No per-game stats loaded.");
  const targetSeason = season ?? seasons[0]!;
  if (!seasons.includes(targetSeason)) {
    throw new ApiError(404, `Season ${targetSeason} not loaded.`);
  }

  const weeks = (
    await q<{ week: number }>(
      `SELECT DISTINCT g.week FROM player_game_stats s
       JOIN games g ON g.game_id = s.game_id
       WHERE g.season = $1 ORDER BY g.week`,
      [targetSeason],
    )
  ).map((r) => r.week);
  if (weeks.length === 0) throw new ApiError(404, `No weeks loaded for ${targetSeason}.`);
  const targetWeek = week ?? weeks.at(-1)!;
  if (!weeks.includes(targetWeek)) {
    throw new ApiError(404, `Week ${targetWeek} not loaded for ${targetSeason}.`);
  }

  const rows = await q<PerformerRow>(
    `SELECT s.player_id, p.full_name AS name, p.position, s.team_id,
            CASE WHEN s.team_id = g.home_team THEN g.away_team
                 ELSE g.home_team END AS opponent,
            COALESCE(s.passing_yards, 0) AS passing_yards,
            COALESCE(s.passing_tds, 0) AS passing_tds,
            COALESCE(s.interceptions, 0) AS interceptions,
            COALESCE(s.rushing_yards, 0) AS rushing_yards,
            COALESCE(s.rushing_tds, 0) AS rushing_tds,
            COALESCE(s.receptions, 0) AS receptions,
            COALESCE(s.receiving_yards, 0) AS receiving_yards,
            COALESCE(s.receiving_tds, 0) AS receiving_tds,
            COALESCE(s.fantasy_points_ppr, 0) AS fantasy_points_ppr
     FROM player_game_stats s
     JOIN games g ON g.game_id = s.game_id
     JOIN players p ON p.player_id = s.player_id
     WHERE g.season = $1 AND g.week = $2
     ORDER BY s.fantasy_points_ppr DESC, p.full_name
     LIMIT $3`,
    [targetSeason, targetWeek, limit],
  );

  return {
    season: targetSeason,
    seasons,
    week: targetWeek,
    weeks,
    performers: rows.map((r, i) => ({
      rank: i + 1,
      player_id: r.player_id,
      name: r.name,
      position: r.position,
      team: r.team_id,
      opponent: r.opponent,
      headshot_url: headshotUrl(r.player_id),
      fantasy_points_ppr: round(r.fantasy_points_ppr, 1),
      stat_line: statLine(r),
    })),
  };
}

// ---- Box scores ----------------------------------------------------------- //

import type { BoxScore, BoxScorePlayer, TeamGameLine } from "@yunoball/types";

const BOX_COLS = `
  COALESCE(s.completions, 0) AS completions,
  COALESCE(s.attempts, 0) AS attempts,
  COALESCE(s.passing_yards, 0) AS passing_yards,
  COALESCE(s.passing_tds, 0) AS passing_tds,
  COALESCE(s.interceptions, 0) AS interceptions,
  COALESCE(s.sacks, 0) AS sacks,
  COALESCE(s.carries, 0) AS carries,
  COALESCE(s.rushing_yards, 0) AS rushing_yards,
  COALESCE(s.rushing_tds, 0) AS rushing_tds,
  COALESCE(s.targets, 0) AS targets,
  COALESCE(s.receptions, 0) AS receptions,
  COALESCE(s.receiving_yards, 0) AS receiving_yards,
  COALESCE(s.receiving_tds, 0) AS receiving_tds,
  COALESCE(s.fumbles, 0) AS fumbles,
  COALESCE(s.fumbles_lost, 0) AS fumbles_lost,
  COALESCE(s.tackles, 0) AS tackles,
  COALESCE(s.def_sacks, 0) AS def_sacks,
  COALESCE(s.def_interceptions, 0) AS def_interceptions,
  COALESCE(s.forced_fumbles, 0) AS forced_fumbles,
  COALESCE(s.passes_defended, 0) AS passes_defended,
  COALESCE(s.fantasy_points_ppr, 0) AS fantasy_points_ppr`;

/** '(3:37) 30-C.Hubbard left guard...' -> ["3:37", "30-C.Hubbard left guard..."]. */
function splitClock(desc: string | null): [string | null, string | null] {
  const m = desc?.match(/^\((\d{0,2}:\d{2})\)\s*/);
  return m ? [m[1]!, desc!.slice(m[0].length)] : [null, desc];
}

/** Everything one game page needs: score header (with each team's record
 * through this game), team stat lines, the chronological scoring log, and
 * each team's player stat lines, busiest players first. */
export async function getBoxScore(gameId: string): Promise<BoxScore> {
  const games = await q<{
    game_id: string; season: number; season_type: string; week: number;
    game_date: string | null; stadium: string | null; roof: string | null;
    surface: string | null; temp: number | null; wind: number | null;
    gametime: string | null; home_coach: string | null; away_coach: string | null;
    home_team: string; home_name: string; home_nick: string | null; home_score: number | null;
    away_team: string; away_name: string; away_nick: string | null; away_score: number | null;
  }>(
    `SELECT g.game_id, g.season, g.season_type, g.week, g.game_date, g.stadium,
            g.roof, g.surface, g.temp, g.wind, g.gametime, g.home_coach, g.away_coach,
            g.home_team, ht.name AS home_name, ht.nickname AS home_nick, g.home_score,
            g.away_team, aw.name AS away_name, aw.nickname AS away_nick, g.away_score
     FROM games g
     JOIN teams ht ON ht.team_id = g.home_team
     JOIN teams aw ON aw.team_id = g.away_team
     WHERE g.game_id = $1`,
    [gameId],
  );
  const g = games[0];
  if (!g) throw new ApiError(404, "Game not found.");

  const [rows, recordRows, scoringRows, lineRows] = await Promise.all([
    q<BoxScorePlayer & { team_id: string }>(
      `SELECT s.team_id, s.player_id, p.full_name AS name, p.position, ${BOX_COLS}
       FROM player_game_stats s
       JOIN players p ON p.player_id = s.player_id
       WHERE s.game_id = $1
       ORDER BY s.fantasy_points_ppr DESC NULLS LAST, p.full_name`,
      [gameId],
    ),
    // Each team's W-L(-T) across the season through this game (both phases).
    q<{ team_id: string; w: number; l: number; t: number }>(
      `SELECT t.team_id,
              COUNT(*) FILTER (WHERE (g2.home_team = t.team_id AND g2.home_score > g2.away_score)
                                  OR (g2.away_team = t.team_id AND g2.away_score > g2.home_score))::int AS w,
              COUNT(*) FILTER (WHERE (g2.home_team = t.team_id AND g2.home_score < g2.away_score)
                                  OR (g2.away_team = t.team_id AND g2.away_score < g2.home_score))::int AS l,
              COUNT(*) FILTER (WHERE g2.home_score = g2.away_score)::int AS t
       FROM (VALUES ($2::varchar), ($3::varchar)) AS t (team_id)
       JOIN games g2
         ON g2.season = $4 AND g2.home_score IS NOT NULL
        AND (g2.home_team = t.team_id OR g2.away_team = t.team_id)
        AND (g2.game_date <= (SELECT game_date FROM games WHERE game_id = $1))
       GROUP BY t.team_id`,
      [gameId, g.home_team, g.away_team, g.season],
    ),
    q<{ qtr: number | null; team_id: string; player_id: string | null; player: string | null;
        play_type: string | null; yards: number | null; description: string | null }>(
      `SELECT sp.qtr, sp.team_id, sp.player_id, p.full_name AS player,
              sp.play_type, sp.yards, sp.description
       FROM scoring_plays sp
       LEFT JOIN players p ON p.player_id = sp.player_id
       WHERE sp.game_id = $1
       ORDER BY sp.play_id`,
      [gameId],
    ),
    q<TeamGameLine & { team_id: string }>(
      `SELECT team_id, total_yards, passing_yards, rushing_yards, turnovers,
              time_of_possession_sec, drives
       FROM team_game_stats WHERE game_id = $1`,
      [gameId],
    ),
  ]);

  const record = (team: string): string | null => {
    const r = recordRows.find((row) => row.team_id === team);
    if (!r) return null;
    return `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;
  };

  const side = (team: string, name: string, nick: string | null, score: number | null) => ({
    team_id: team,
    name,
    nickname: nick,
    score,
    record: record(team),
    line: lineRows.find((row) => row.team_id === team) ?? null,
    players: rows
      .filter((r) => r.team_id === team)
      .map(({ team_id: _t, ...player }) => ({
        ...player,
        headshot_url: headshotUrl(player.player_id),
        fantasy_points_ppr: round(Number(player.fantasy_points_ppr), 1),
      })),
  });

  return {
    game_id: g.game_id,
    season: g.season,
    season_type: g.season_type,
    week: g.week,
    date: g.game_date,
    stadium: g.stadium,
    roof: g.roof,
    surface: g.surface,
    temp: g.temp,
    wind: g.wind,
    gametime: g.gametime,
    home_coach: g.home_coach,
    away_coach: g.away_coach,
    scoring: scoringRows.map((s) => {
      const [clock, description] = splitClock(s.description);
      return { ...s, clock, description };
    }),
    home: side(g.home_team, g.home_name, g.home_nick, g.home_score),
    away: side(g.away_team, g.away_name, g.away_nick, g.away_score),
  };
}
