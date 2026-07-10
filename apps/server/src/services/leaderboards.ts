/** Precomputed season leaderboards over a column allowlist. */

import type { LeaderboardsResponse, Leaderboard } from "@yunoball/types";
import { q } from "../db/pool.js";
import { ApiError } from "../lib/errors.js";
import { headshotUrl } from "../lib/espn.js";
import { loadedSeasons } from "../repositories/seasons.js";

// key -> [label, unit]. Column name == key (allowlisted, safe to interpolate).
export const PLAYER_CATEGORIES: [string, string, string][] = [
  ["passing_yards", "Passing yards", "yds"],
  ["passing_tds", "Passing TDs", "TD"],
  ["rushing_yards", "Rushing yards", "yds"],
  ["rushing_tds", "Rushing TDs", "TD"],
  ["receiving_yards", "Receiving yards", "yds"],
  ["receptions", "Receptions", "rec"],
  ["receiving_tds", "Receiving TDs", "TD"],
  ["fantasy_points_ppr", "Fantasy PPG (PPR)", "ppg"],
];
const ALLOWED = new Set(PLAYER_CATEGORIES.map(([k]) => k));

async function playerBoard(
  column: string, label: string, unit: string, season: number, limit: number,
  team?: string, position?: string,
): Promise<Leaderboard> {
  const params: unknown[] = [season, limit];
  let filters = "";
  if (team) {
    params.push(team.toUpperCase());
    filters += ` AND s.team_id = $${params.length}`;
  }
  if (position) {
    params.push(position.toUpperCase());
    filters += ` AND p.position = $${params.length}`;
  }
  // Fantasy ranks by points per game (min. 8 games), everything else by total.
  const valueExpr =
    column === "fantasy_points_ppr"
      ? "ROUND((s.fantasy_points_ppr / NULLIF(s.games_played, 0))::numeric, 1)"
      : `s.${column}`;
  if (column === "fantasy_points_ppr") filters += " AND COALESCE(s.games_played, 0) >= 8";
  const rows = await q<{
    player_id: string; name: string; team: string | null;
    position: string | null; value: number;
  }>(
    `SELECT p.player_id, p.full_name AS name, s.team_id AS team,
            p.position, ${valueExpr} AS value
     FROM player_season_stats s JOIN players p USING (player_id)
     WHERE s.season = $1 AND s.season_type = 'REG'
       AND s.${column} IS NOT NULL${filters}
     ORDER BY value DESC, p.full_name
     LIMIT $2`,
    params,
  );
  return {
    key: column,
    label,
    unit,
    rows: rows.map((r, i) => ({
      rank: i + 1,
      player_id: r.player_id,
      name: r.name,
      team: r.team,
      position: r.position,
      value: Number(r.value),
      headshot_url: headshotUrl(r.player_id),
    })),
  };
}

export async function getLeaderboards(opts: {
  season?: number; category?: string; team?: string; position?: string; limit: number;
}): Promise<LeaderboardsResponse> {
  const seasons = await loadedSeasons();
  if (seasons.length === 0) throw new ApiError(503, "No seasons loaded.");
  const target = opts.season ?? seasons[0]!;
  if (opts.season !== undefined && !seasons.includes(opts.season)) {
    throw new ApiError(404, `Season ${opts.season} not loaded.`);
  }

  let selected = PLAYER_CATEGORIES;
  if (opts.category) {
    if (!ALLOWED.has(opts.category)) {
      throw new ApiError(400, `Unknown category: ${opts.category}`);
    }
    selected = PLAYER_CATEGORIES.filter(([k]) => k === opts.category);
  }

  const boards = await Promise.all(
    selected.map(([col, label, unit]) =>
      playerBoard(col, label, unit, target, opts.limit, opts.team, opts.position),
    ),
  );
  return { season: target, seasons, boards };
}
