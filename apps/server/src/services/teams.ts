/** A team's season page in one call: identity, computed record with division
 * rank, offense/defense totals ranked against the league, team stat leaders,
 * key players and the full season schedule. */

import type { TeamProfile, TeamStat } from "@yunoball/types";
import { q } from "../db/pool.js";
import { ApiError } from "../lib/errors.js";
import { headshotUrl } from "../lib/espn.js";
import { round } from "../lib/round.js";
import { computeRecords, emptyRecord, finalGames, streak, winPct } from "../repositories/records.js";
import { gameSeasons } from "../repositories/seasons.js";

const LEADER_CATEGORIES: [string, string, string][] = [
  ["passing_yards", "Passing yards", "yds"],
  ["rushing_yards", "Rushing yards", "yds"],
  ["receiving_yards", "Receiving yards", "yds"],
  ["receptions", "Receptions", "rec"],
  ["fantasy_points_ppr", "Fantasy (PPR)", "pts"],
  ["def_sacks", "Sacks", "sacks"],
  ["tackles", "Tackles", "tkl"],
  ["def_interceptions", "Interceptions", "int"],
];

function rank(values: Map<string, number>, team: string, bestIsHigh = true): number {
  const v = values.get(team) ?? 0;
  let better = 0;
  for (const x of values.values()) {
    if (bestIsHigh ? x > v : x < v) better++;
  }
  return 1 + better;
}

export async function getTeamProfile(teamId: string, season?: number): Promise<TeamProfile> {
  const tid = teamId.toUpperCase();
  const teams = await q<{
    team_id: string; name: string; nickname: string | null;
    conference: string | null; division: string | null;
  }>(
    "SELECT team_id, name, nickname, conference, division FROM teams WHERE team_id = $1",
    [tid],
  );
  const team = teams[0];
  if (!team) throw new ApiError(404, "Team not found.");

  const seasons = await gameSeasons();
  if (seasons.length === 0) throw new ApiError(503, "No games loaded.");
  const target = season ?? seasons[0]!;
  if (!seasons.includes(target)) throw new ApiError(404, `Season ${target} not loaded.`);

  const finals = await finalGames(target);
  const divisionMembers = (
    await q<{ team_id: string }>("SELECT team_id FROM teams WHERE division = $1", [team.division])
  ).map((r) => r.team_id);

  const offenseRows = await q<{
    team_id: string; pass_yds: number; rush_yds: number; pass_tds: number; rush_tds: number;
  }>(
    `SELECT team_id,
            SUM(COALESCE(passing_yards, 0)) AS pass_yds,
            SUM(COALESCE(rushing_yards, 0)) AS rush_yds,
            SUM(COALESCE(passing_tds, 0)) AS pass_tds,
            SUM(COALESCE(rushing_tds, 0)) AS rush_tds
     FROM player_season_stats
     WHERE season = $1 AND season_type = 'REG' AND team_id IS NOT NULL
     GROUP BY team_id`,
    [target],
  );

  // The true season roster (ingested nflverse rosters), stats joined on where
  // they exist — linemen and zero-stat players stay on the list.
  const rosterRows = await q<{
    player_id: string; name: string; position: string | null;
    jersey_number: number | null; gp: number;
    pass_yds: number; rush_yds: number; rec: number; rec_yds: number;
    pass_tds: number; rush_tds: number; rec_tds: number; fp: number;
    sacks: number; tkl: number; def_int: number;
  }>(
    `SELECT r.player_id, p.full_name AS name,
            COALESCE(r.position, p.position) AS position,
            r.jersey_number,
            COALESCE(s.games_played, 0) AS gp,
            COALESCE(s.passing_yards, 0) AS pass_yds,
            COALESCE(s.rushing_yards, 0) AS rush_yds,
            COALESCE(s.receptions, 0) AS rec,
            COALESCE(s.receiving_yards, 0) AS rec_yds,
            COALESCE(s.passing_tds, 0) AS pass_tds,
            COALESCE(s.rushing_tds, 0) AS rush_tds,
            COALESCE(s.receiving_tds, 0) AS rec_tds,
            COALESCE(s.fantasy_points_ppr, 0) AS fp,
            COALESCE(s.def_sacks, 0) AS sacks,
            COALESCE(s.tackles, 0) AS tkl,
            COALESCE(s.def_interceptions, 0) AS def_int
     FROM rosters r
     JOIN players p USING (player_id)
     LEFT JOIN player_season_stats s
       ON s.player_id = r.player_id AND s.team_id = r.team_id
      AND s.season = r.season AND s.season_type = 'REG'
     WHERE r.team_id = $1 AND r.season = $2
     ORDER BY COALESCE(s.fantasy_points_ppr, 0) DESC, p.full_name`,
    [tid, target],
  );

  const scheduleRows = await q<{
    game_id: string; week: number; game_date: string | null; home_team: string;
    away_team: string; home_score: number | null; away_score: number | null;
    opp_nick: string | null;
  }>(
    `SELECT g.game_id, g.week, g.game_date, g.home_team, g.away_team,
            g.home_score, g.away_score, t.nickname AS opp_nick
     FROM games g
     JOIN teams t ON t.team_id =
         CASE WHEN g.home_team = $1 THEN g.away_team ELSE g.home_team END
     WHERE g.season = $2 AND g.season_type = 'REG'
       AND (g.home_team = $1 OR g.away_team = $1)
     ORDER BY g.week`,
    [tid, target],
  );

  // Records for every team, so ranks and division position come out of one pass.
  const records = computeRecords(finals);
  const mine = records.get(tid) ?? emptyRecord();
  const recOf = (t: string) => records.get(t) ?? emptyRecord();

  const divSorted = [...divisionMembers].sort((a, b) => {
    const ra = recOf(a), rb = recOf(b);
    return (
      winPct(rb) - winPct(ra) ||
      rb.pf - rb.pa - (ra.pf - ra.pa) ||
      a.localeCompare(b)
    );
  });

  const teamRecord = {
    wins: mine.w,
    losses: mine.l,
    ties: mine.t,
    pct: round(winPct(mine), 3),
    points_for: mine.pf,
    points_against: mine.pa,
    point_diff: mine.pf - mine.pa,
    streak: streak(mine.results),
    division_rank: divSorted.includes(tid) ? divSorted.indexOf(tid) + 1 : 0,
    division_size: divSorted.length,
  };

  const gamesPlayed = mine.w + mine.l + mine.t;

  // League-wide stat maps -> value + rank for this team.
  const pfMap = new Map([...records].map(([t, r]) => [t, r.pf]));
  const paMap = new Map([...records].map(([t, r]) => [t, r.pa]));
  const offMaps: Record<string, Map<string, number>> = {
    passing_yards: new Map(offenseRows.map((r) => [r.team_id, Number(r.pass_yds)])),
    rushing_yards: new Map(offenseRows.map((r) => [r.team_id, Number(r.rush_yds)])),
    passing_tds: new Map(offenseRows.map((r) => [r.team_id, Number(r.pass_tds)])),
    rushing_tds: new Map(offenseRows.map((r) => [r.team_id, Number(r.rush_tds)])),
  };
  offMaps.total_yards = new Map(
    [...new Set([...offMaps.passing_yards!.keys(), ...offMaps.rushing_yards!.keys()])].map((t) => [
      t,
      (offMaps.passing_yards!.get(t) ?? 0) + (offMaps.rushing_yards!.get(t) ?? 0),
    ]),
  );

  const stat = (key: string, label: string, values: Map<string, number>, bestIsHigh = true): TeamStat => {
    const v = values.get(tid) ?? 0;
    return {
      key,
      label,
      value: v,
      per_game: gamesPlayed ? round(v / gamesPlayed, 1) : 0,
      rank: rank(values, tid, bestIsHigh),
    };
  };

  const offense = [
    stat("points_for", "Points scored", pfMap),
    stat("total_yards", "Total yards", offMaps.total_yards!),
    stat("passing_yards", "Passing yards", offMaps.passing_yards!),
    stat("rushing_yards", "Rushing yards", offMaps.rushing_yards!),
    stat("passing_tds", "Passing TDs", offMaps.passing_tds!),
    stat("rushing_tds", "Rushing TDs", offMaps.rushing_tds!),
  ];
  // ponytail: warehouse has no defensive player stats yet; points allowed is
  // the defensive picture until they're ingested.
  const defense = [stat("points_against", "Points allowed", paMap, false)];

  const leaderCols: Record<string, keyof (typeof rosterRows)[number]> = {
    passing_yards: "pass_yds",
    rushing_yards: "rush_yds",
    receiving_yards: "rec_yds",
    receptions: "rec",
    fantasy_points_ppr: "fp",
    def_sacks: "sacks",
    tackles: "tkl",
    def_interceptions: "def_int",
  };
  const leaders = [];
  for (const [key, label, unit] of LEADER_CATEGORIES) {
    const col = leaderCols[key]!;
    let best: (typeof rosterRows)[number] | null = null;
    for (const r of rosterRows) {
      if (best === null || Number(r[col]) > Number(best[col])) best = r;
    }
    if (!best || !Number(best[col])) continue;
    leaders.push({
      key,
      label,
      unit,
      player_id: best.player_id,
      name: best.name,
      position: best.position,
      headshot_url: headshotUrl(best.player_id),
      value: round(Number(best[col]), 1),
    });
  }

  // The whole roster, best producers first — the web table paginates.
  const keyPlayers = rosterRows.map((r) => ({
    player_id: r.player_id,
    name: r.name,
    position: r.position,
    jersey_number: r.jersey_number,
    headshot_url: headshotUrl(r.player_id),
    games_played: r.gp,
    passing_yards: r.pass_yds,
    rushing_yards: r.rush_yds,
    receptions: r.rec,
    receiving_yards: r.rec_yds,
    total_tds: r.pass_tds + r.rush_tds + r.rec_tds,
    fantasy_points_ppr: round(r.fp, 1),
  }));

  const games = scheduleRows.map((g) => {
    const isHome = g.home_team === tid;
    const teamScore = isHome ? g.home_score : g.away_score;
    const oppScore = isHome ? g.away_score : g.home_score;
    const result =
      teamScore === null || oppScore === null
        ? "—"
        : teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "T";
    return {
      game_id: g.game_id,
      week: g.week,
      date: g.game_date,
      opponent: isHome ? g.away_team : g.home_team,
      opponent_nickname: g.opp_nick,
      home: isHome,
      team_score: teamScore,
      opp_score: oppScore,
      result,
    };
  });

  return {
    team_id: team.team_id,
    name: team.name,
    nickname: team.nickname,
    conference: team.conference,
    division: team.division,
    season: target,
    seasons,
    record: teamRecord,
    offense,
    defense,
    leaders,
    key_players: keyPlayers,
    games,
  };
}
