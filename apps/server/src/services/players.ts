/** A player's profile page in one call: identity, career totals,
 * season-by-season splits and the game log. Trusted SQL only.
 *
 * The player's current team is derived from his most recent season stats —
 * the players dimension deliberately has no team column (players move;
 * per-season team lives on the stat rows).
 */

import type { PlayerProfile, PlayerSeasonLine } from "@yunoball/types";
import { q } from "../db/pool.js";
import { ApiError } from "../lib/errors.js";
import { headshotUrl } from "../lib/espn.js";
import { round } from "../lib/round.js";

export async function getPlayerProfile(playerId: string): Promise<PlayerProfile> {
  const players = await q<{
    player_id: string; full_name: string; position: string | null;
    team_id: string | null; team_name: string | null;
    birth_date: string | null; height_inches: number | null;
    weight_lbs: number | null; college: string | null;
  }>(
    `SELECT p.player_id, p.full_name, p.position, latest.team_id, t.name AS team_name,
            p.birth_date, p.height_inches, p.weight_lbs, p.college
     FROM players p
     LEFT JOIN LATERAL (
       SELECT team_id FROM player_season_stats s
       WHERE s.player_id = p.player_id AND s.team_id IS NOT NULL
       ORDER BY s.season DESC LIMIT 1
     ) latest ON true
     LEFT JOIN teams t ON t.team_id = latest.team_id
     WHERE p.player_id = $1`,
    [playerId],
  );
  const p = players[0];
  if (!p) throw new ApiError(404, "Player not found.");

  const seasonRows = await q<{
    season: number; team_id: string | null; gp: number; pass_yds: number;
    pass_tds: number; ints: number; rush_yds: number; rush_tds: number;
    rec: number; rec_yds: number; rec_tds: number; fp: number;
    cmp: number; att: number; sck: number; scky: number; fum: number;
    fuml: number; tkl: number; dsk: number; dint: number; ff: number; pd: number;
  }>(
    `SELECT season, team_id,
            COALESCE(games_played, 0) AS gp,
            COALESCE(passing_yards, 0) AS pass_yds,
            COALESCE(passing_tds, 0) AS pass_tds,
            COALESCE(interceptions, 0) AS ints,
            COALESCE(rushing_yards, 0) AS rush_yds,
            COALESCE(rushing_tds, 0) AS rush_tds,
            COALESCE(receptions, 0) AS rec,
            COALESCE(receiving_yards, 0) AS rec_yds,
            COALESCE(receiving_tds, 0) AS rec_tds,
            COALESCE(fantasy_points_ppr, 0) AS fp,
            COALESCE(completions, 0) AS cmp,
            COALESCE(attempts, 0) AS att,
            COALESCE(sacks, 0) AS sck,
            COALESCE(sack_yards, 0) AS scky,
            COALESCE(fumbles, 0) AS fum,
            COALESCE(fumbles_lost, 0) AS fuml,
            COALESCE(tackles, 0) AS tkl,
            COALESCE(def_sacks, 0) AS dsk,
            COALESCE(def_interceptions, 0) AS dint,
            COALESCE(forced_fumbles, 0) AS ff,
            COALESCE(passes_defended, 0) AS pd
     FROM player_season_stats
     WHERE player_id = $1 AND season_type = 'REG'
     ORDER BY season DESC`,
    [playerId],
  );

  const postRows = await q<(typeof seasonRows)[number]>(
    `SELECT season, team_id,
            COALESCE(games_played, 0) AS gp,
            COALESCE(passing_yards, 0) AS pass_yds,
            COALESCE(passing_tds, 0) AS pass_tds,
            COALESCE(interceptions, 0) AS ints,
            COALESCE(rushing_yards, 0) AS rush_yds,
            COALESCE(rushing_tds, 0) AS rush_tds,
            COALESCE(receptions, 0) AS rec,
            COALESCE(receiving_yards, 0) AS rec_yds,
            COALESCE(receiving_tds, 0) AS rec_tds,
            COALESCE(fantasy_points_ppr, 0) AS fp,
            COALESCE(completions, 0) AS cmp,
            COALESCE(attempts, 0) AS att,
            COALESCE(sacks, 0) AS sck,
            COALESCE(sack_yards, 0) AS scky,
            COALESCE(fumbles, 0) AS fum,
            COALESCE(fumbles_lost, 0) AS fuml,
            COALESCE(tackles, 0) AS tkl,
            COALESCE(def_sacks, 0) AS dsk,
            COALESCE(def_interceptions, 0) AS dint,
            COALESCE(forced_fumbles, 0) AS ff,
            COALESCE(passes_defended, 0) AS pd
     FROM player_season_stats
     WHERE player_id = $1 AND season_type = 'POST'
     ORDER BY season DESC`,
    [playerId],
  );

  // Rank by PPR among players at the same position, per season.
  const posRanks = new Map<number, [number, number]>();
  if (p.position) {
    const rankRows = await q<{ season: number; rnk: number; cnt: number }>(
      `SELECT season, rnk, cnt FROM (
         SELECT s.season, s.player_id,
                RANK() OVER (PARTITION BY s.season ORDER BY s.fantasy_points_ppr DESC) AS rnk,
                COUNT(*) OVER (PARTITION BY s.season) AS cnt
         FROM player_season_stats s
         JOIN players p2 ON p2.player_id = s.player_id
         WHERE p2.position = $1 AND s.season_type = 'REG'
           AND s.fantasy_points_ppr IS NOT NULL
       ) ranked WHERE player_id = $2`,
      [p.position, playerId],
    );
    for (const r of rankRows) posRanks.set(r.season, [Number(r.rnk), Number(r.cnt)]);
  }

  // Touchdown log — play-level scoring events, newest first.
  const scoringRows = await q<{
    game_id: string; season: number; week: number; game_date: string | null;
    opponent: string; qtr: number | null; play_type: string | null;
    description: string | null;
  }>(
    `SELECT sp.game_id, g.season, g.week, g.game_date,
            CASE WHEN sp.team_id = g.home_team THEN g.away_team
                 ELSE g.home_team END AS opponent,
            sp.qtr, sp.play_type, sp.description
     FROM scoring_plays sp JOIN games g ON g.game_id = sp.game_id
     WHERE sp.player_id = $1
     ORDER BY g.season DESC, g.week DESC, sp.play_id DESC`,
    [playerId],
  );

  const logRows = await q<{
    game_id: string; season: number; season_type: string; week: number; game_date: string | null;
    team_id: string; home_team: string; away_team: string;
    home_score: number | null; away_score: number | null;
    cmp: number; att: number; pass_yds: number; pass_tds: number; ints: number;
    car: number; rush_yds: number; rush_tds: number;
    tgt: number; rec: number; rec_yds: number; rec_tds: number;
    fum: number; fuml: number; tkl: number; dsk: number; dint: number;
    ff: number; pd: number; fp: number;
    pass_plays: number; pass_epa: number; pass_success: number;
  }>(
    `SELECT s.game_id, g.season, g.season_type, g.week, g.game_date,
            s.team_id, g.home_team, g.away_team, g.home_score, g.away_score,
            COALESCE(s.completions, 0) AS cmp,
            COALESCE(s.attempts, 0) AS att,
            COALESCE(s.passing_yards, 0) AS pass_yds,
            COALESCE(s.passing_tds, 0) AS pass_tds,
            COALESCE(s.interceptions, 0) AS ints,
            COALESCE(s.carries, 0) AS car,
            COALESCE(s.rushing_yards, 0) AS rush_yds,
            COALESCE(s.rushing_tds, 0) AS rush_tds,
            COALESCE(s.targets, 0) AS tgt,
            COALESCE(s.receptions, 0) AS rec,
            COALESCE(s.receiving_yards, 0) AS rec_yds,
            COALESCE(s.receiving_tds, 0) AS rec_tds,
            COALESCE(s.fumbles, 0) AS fum,
            COALESCE(s.fumbles_lost, 0) AS fuml,
            COALESCE(s.tackles, 0) AS tkl,
            COALESCE(s.def_sacks, 0) AS dsk,
            COALESCE(s.def_interceptions, 0) AS dint,
            COALESCE(s.forced_fumbles, 0) AS ff,
            COALESCE(s.passes_defended, 0) AS pd,
            COALESCE(s.fantasy_points_ppr, 0) AS fp,
            COALESCE(a.pass_plays, 0) AS pass_plays,
            COALESCE(a.pass_epa, 0) AS pass_epa,
            COALESCE(a.pass_success, 0) AS pass_success
     FROM player_game_stats s JOIN games g ON g.game_id = s.game_id
     LEFT JOIN player_game_advanced a
       ON a.player_id = s.player_id AND a.game_id = s.game_id
     WHERE s.player_id = $1
     ORDER BY g.season DESC, g.week DESC`,
    [playerId],
  );

  const seasons: PlayerSeasonLine[] = seasonRows.map((r) => ({
    season: r.season,
    team: r.team_id,
    position_rank: posRanks.get(r.season)?.[0] ?? null,
    position_players: posRanks.get(r.season)?.[1] ?? null,
    games_played: r.gp,
    completions: r.cmp,
    attempts: r.att,
    sacks: Number(r.sck),
    sack_yards: r.scky,
    fumbles: r.fum,
    fumbles_lost: r.fuml,
    tackles: r.tkl,
    def_sacks: Number(r.dsk),
    def_interceptions: r.dint,
    forced_fumbles: r.ff,
    passes_defended: r.pd,
    passing_yards: r.pass_yds,
    passing_tds: r.pass_tds,
    interceptions: r.ints,
    rushing_yards: r.rush_yds,
    rushing_tds: r.rush_tds,
    receptions: r.rec,
    receiving_yards: r.rec_yds,
    receiving_tds: r.rec_tds,
    fantasy_points_ppr: round(r.fp, 1),
    points_per_game: r.gp ? round(r.fp / r.gp, 1) : 0,
  }));

  const postseasons: PlayerSeasonLine[] = postRows.map((r) => ({
    season: r.season,
    team: r.team_id,
    position_rank: null,
    position_players: null,
    games_played: r.gp,
    completions: r.cmp,
    attempts: r.att,
    sacks: Number(r.sck),
    sack_yards: r.scky,
    fumbles: r.fum,
    fumbles_lost: r.fuml,
    tackles: r.tkl,
    def_sacks: Number(r.dsk),
    def_interceptions: r.dint,
    forced_fumbles: r.ff,
    passes_defended: r.pd,
    passing_yards: r.pass_yds,
    passing_tds: r.pass_tds,
    interceptions: r.ints,
    rushing_yards: r.rush_yds,
    rushing_tds: r.rush_tds,
    receptions: r.rec,
    receiving_yards: r.rec_yds,
    receiving_tds: r.rec_tds,
    fantasy_points_ppr: round(r.fp, 1),
    points_per_game: r.gp ? round(r.fp / r.gp, 1) : 0,
  }));

  // first/last span REG and POST so postseason-only careers aren't dropped.
  const allSeasonNums = [...seasons, ...postseasons].map((s) => s.season);

  const sum = (f: (s: PlayerSeasonLine) => number) => seasons.reduce((a, s) => a + f(s), 0);
  const career = {
    seasons: seasons.length,
    games_played: sum((s) => s.games_played),
    passing_yards: sum((s) => s.passing_yards),
    passing_tds: sum((s) => s.passing_tds),
    interceptions: sum((s) => s.interceptions),
    rushing_yards: sum((s) => s.rushing_yards),
    rushing_tds: sum((s) => s.rushing_tds),
    receptions: sum((s) => s.receptions),
    receiving_yards: sum((s) => s.receiving_yards),
    receiving_tds: sum((s) => s.receiving_tds),
    fantasy_points_ppr: round(sum((s) => s.fantasy_points_ppr), 1),
  };

  const gameLog = logRows.map((r) => {
    const isHome = r.team_id === r.home_team;
    const teamScore = isHome ? r.home_score : r.away_score;
    const oppScore = isHome ? r.away_score : r.home_score;
    const result =
      teamScore === null || oppScore === null
        ? "—"
        : teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "T";
    return {
      game_id: r.game_id,
      season: r.season,
      season_type: r.season_type,
      week: r.week,
      date: r.game_date,
      opponent: isHome ? r.away_team : r.home_team,
      home: isHome,
      team_score: teamScore,
      opp_score: oppScore,
      result,
      completions: r.cmp,
      attempts: r.att,
      passing_yards: r.pass_yds,
      passing_tds: r.pass_tds,
      interceptions: r.ints,
      carries: r.car,
      rushing_yards: r.rush_yds,
      rushing_tds: r.rush_tds,
      targets: r.tgt,
      receptions: r.rec,
      receiving_yards: r.rec_yds,
      receiving_tds: r.rec_tds,
      fumbles: r.fum,
      fumbles_lost: r.fuml,
      tackles: r.tkl,
      def_sacks: Number(r.dsk),
      def_interceptions: r.dint,
      forced_fumbles: r.ff,
      passes_defended: r.pd,
      fantasy_points_ppr: round(r.fp, 1),
      pass_plays: r.pass_plays,
      pass_epa: round(r.pass_epa, 3),
      pass_success: r.pass_success,
    };
  });

  return {
    player_id: p.player_id,
    name: p.full_name,
    position: p.position,
    team: p.team_id,
    team_name: p.team_name,
    headshot_url: headshotUrl(p.player_id),
    bio: {
      birth_date: p.birth_date,
      height_inches: p.height_inches,
      weight_lbs: p.weight_lbs,
      college: p.college,
      first_season: allSeasonNums.length ? Math.min(...allSeasonNums) : null,
      last_season: allSeasonNums.length ? Math.max(...allSeasonNums) : null,
    },
    career,
    seasons,
    postseasons,
    game_log: gameLog,
    scoring_plays: scoringRows.map((r) => ({
      game_id: r.game_id,
      season: r.season,
      week: r.week,
      date: r.game_date,
      opponent: r.opponent,
      qtr: r.qtr,
      play_type: r.play_type,
      description: r.description,
    })),
  };
}

// ---- Splits: aggregated views of one season's game log ------------------- //

import type { PlayerSplits, SplitRow } from "@yunoball/types";

interface SplitGameRow {
  season_type: string;
  week: number;
  game_date: string | null;
  home: boolean;
  won: boolean | null;
  opponent: string;
  opp_conf: string | null;
  opp_div: string | null;
  completions: number; attempts: number;
  passing_yards: number; passing_tds: number; interceptions: number;
  carries: number; rushing_yards: number; rushing_tds: number;
  receptions: number; receiving_yards: number; receiving_tds: number;
  tackles: number; def_sacks: number; def_interceptions: number;
  forced_fumbles: number; passes_defended: number;
  fantasy_points_ppr: number;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function sumRows(label: string, rows: SplitGameRow[]): SplitRow {
  const sum = (f: (r: SplitGameRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    label,
    gp: rows.length,
    completions: sum((r) => r.completions),
    attempts: sum((r) => r.attempts),
    passing_yards: sum((r) => r.passing_yards),
    passing_tds: sum((r) => r.passing_tds),
    interceptions: sum((r) => r.interceptions),
    carries: sum((r) => r.carries),
    rushing_yards: sum((r) => r.rushing_yards),
    rushing_tds: sum((r) => r.rushing_tds),
    receptions: sum((r) => r.receptions),
    receiving_yards: sum((r) => r.receiving_yards),
    receiving_tds: sum((r) => r.receiving_tds),
    tackles: sum((r) => r.tackles),
    def_sacks: round(sum((r) => r.def_sacks), 1),
    def_interceptions: sum((r) => r.def_interceptions),
    forced_fumbles: sum((r) => r.forced_fumbles),
    passes_defended: sum((r) => r.passes_defended),
    fantasy_points_ppr: round(sum((r) => r.fantasy_points_ppr), 1),
  };
}

function groupBy(
  title: string,
  rows: SplitGameRow[],
  key: (r: SplitGameRow) => string | null,
  order?: (labels: string[]) => string[],
): { title: string; rows: SplitRow[] } {
  const buckets = new Map<string, SplitGameRow[]>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    buckets.set(k, [...(buckets.get(k) ?? []), r]);
  }
  let labels = [...buckets.keys()];
  labels = order ? order(labels) : labels.sort();
  return { title, rows: labels.map((l) => sumRows(l, buckets.get(l)!)) };
}

/** StatMuse-style splits for one regular season: overall, home/road,
 * wins/losses, by month, by opponent conference/division, by opponent. */
export async function getPlayerSplits(
  playerId: string, season?: number,
): Promise<PlayerSplits> {
  const seasons = (
    await q<{ season: number }>(
      `SELECT DISTINCT g.season FROM player_game_stats s
       JOIN games g ON g.game_id = s.game_id
       WHERE s.player_id = $1 AND g.season_type = 'REG' ORDER BY g.season DESC`,
      [playerId],
    )
  ).map((r) => r.season);
  if (seasons.length === 0) throw new ApiError(404, "No games for this player.");
  const target = season ?? seasons[0]!;
  if (!seasons.includes(target)) throw new ApiError(404, `Season ${target} not loaded.`);

  const rows = await q<SplitGameRow>(
    `SELECT g.season_type, g.week, g.game_date,
            s.team_id = g.home_team AS home,
            CASE WHEN g.home_score IS NULL THEN NULL
                 WHEN g.home_score = g.away_score THEN NULL
                 ELSE (CASE WHEN s.team_id = g.home_team
                            THEN g.home_score > g.away_score
                            ELSE g.away_score > g.home_score END) END AS won,
            CASE WHEN s.team_id = g.home_team THEN g.away_team
                 ELSE g.home_team END AS opponent,
            t.conference AS opp_conf, t.division AS opp_div,
            COALESCE(s.completions, 0) AS completions,
            COALESCE(s.attempts, 0) AS attempts,
            COALESCE(s.passing_yards, 0) AS passing_yards,
            COALESCE(s.passing_tds, 0) AS passing_tds,
            COALESCE(s.interceptions, 0) AS interceptions,
            COALESCE(s.carries, 0) AS carries,
            COALESCE(s.rushing_yards, 0) AS rushing_yards,
            COALESCE(s.rushing_tds, 0) AS rushing_tds,
            COALESCE(s.receptions, 0) AS receptions,
            COALESCE(s.receiving_yards, 0) AS receiving_yards,
            COALESCE(s.receiving_tds, 0) AS receiving_tds,
            COALESCE(s.tackles, 0) AS tackles,
            COALESCE(s.def_sacks, 0) AS def_sacks,
            COALESCE(s.def_interceptions, 0) AS def_interceptions,
            COALESCE(s.forced_fumbles, 0) AS forced_fumbles,
            COALESCE(s.passes_defended, 0) AS passes_defended,
            COALESCE(s.fantasy_points_ppr, 0) AS fantasy_points_ppr
     FROM player_game_stats s
     JOIN games g ON g.game_id = s.game_id
     JOIN teams t ON t.team_id =
          CASE WHEN s.team_id = g.home_team THEN g.away_team ELSE g.home_team END
     WHERE s.player_id = $1 AND g.season = $2 AND g.season_type = 'REG'
     ORDER BY g.week`,
    [playerId, target],
  );

  const month = (r: SplitGameRow) => {
    const m = r.game_date?.match(/^\d{4}-(\d{2})/);
    return m ? MONTH_NAMES[Number(m[1]) - 1]! : null;
  };
  // Months in season order (Sep..Feb), driven by first appearance week-wise.
  const monthOrder = (labels: string[]) => {
    const firstWeek = new Map<string, number>();
    for (const r of rows) {
      const m = month(r);
      if (m && !firstWeek.has(m)) firstWeek.set(m, r.week);
    }
    return labels.sort((a, b) => (firstWeek.get(a) ?? 99) - (firstWeek.get(b) ?? 99));
  };

  const groups = [
    { title: "Overall", rows: [sumRows(String(target), rows)] },
    groupBy("Location", rows, (r) => (r.home ? "Home" : "Road"),
      (l) => l.sort((a) => (a === "Home" ? -1 : 1))),
    groupBy("Result", rows, (r) => (r.won === null ? "Ties" : r.won ? "Wins" : "Losses"),
      (l) => l.sort((a) => (a === "Wins" ? -1 : 1))),
    groupBy("Month", rows, month, monthOrder),
    groupBy("Conference", rows, (r) => r.opp_conf),
    groupBy("Division", rows, (r) => r.opp_div),
    groupBy("Opponent", rows, (r) => r.opponent),
  ].filter((g) => g.rows.length > 0);

  return { player_id: playerId, season: target, seasons, groups };
}
