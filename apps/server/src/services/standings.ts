/** League standings computed from game results (W-L-T, points, streak). */

import type { StandingsResponse, StandingRow } from "@yunoball/types";
import { q } from "../db/pool.js";
import { ApiError } from "../lib/errors.js";
import { round } from "../lib/round.js";
import { computeRecords, emptyRecord, finalGames, streak, winPct } from "../repositories/records.js";
import { gameSeasons } from "../repositories/seasons.js";

const CONFERENCE_ORDER = ["AFC", "NFC"];

interface TeamRow {
  team_id: string;
  name: string;
  nickname: string | null;
  conference: string | null;
  division: string | null;
}

export async function getStandings(season?: number): Promise<StandingsResponse> {
  const seasons = await gameSeasons();
  if (seasons.length === 0) throw new ApiError(503, "No games loaded.");
  const target = season ?? seasons[0]!;
  if (!seasons.includes(target)) throw new ApiError(404, `Season ${target} not loaded.`);

  const teams = await q<TeamRow>(
    "SELECT team_id, name, nickname, conference, division FROM teams",
  );
  const games = await finalGames(target);
  const records = computeRecords(games, teams.map((t) => t.team_id));

  const row = (t: TeamRow): StandingRow => {
    const rec = records.get(t.team_id) ?? emptyRecord();
    return {
      team_id: t.team_id,
      name: t.name,
      nickname: t.nickname,
      wins: rec.w,
      losses: rec.l,
      ties: rec.t,
      pct: round(winPct(rec), 3),
      points_for: rec.pf,
      points_against: rec.pa,
      point_diff: rec.pf - rec.pa,
      streak: streak(rec.results),
    };
  };

  const byDivision = new Map<string, TeamRow[]>();
  for (const t of teams) {
    const div = t.division ?? "Unassigned";
    byDivision.set(div, [...(byDivision.get(div) ?? []), t]);
  }

  const conferences = CONFERENCE_ORDER.map((conf) => ({
    conference: conf,
    divisions: [...byDivision.entries()]
      .filter(([div]) => div.startsWith(conf))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([division, members]) => ({
        division,
        teams: members
          .map(row)
          .sort((a, b) => b.pct - a.pct || b.point_diff - a.point_diff || a.name.localeCompare(b.name)),
      })),
  })).filter((c) => c.divisions.length > 0);

  return { season: target, seasons, conferences };
}
