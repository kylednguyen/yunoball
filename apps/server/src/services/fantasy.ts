/** The player pool for the fantasy lineup builder — season totals + PPR. */

import type { FantasyPlayersResponse } from "@yunoball/types";
import { q } from "../db/pool.js";
import { ApiError } from "../lib/errors.js";
import { headshotUrl } from "../lib/espn.js";
import { round } from "../lib/round.js";
import { statSeasons } from "../repositories/seasons.js";

export const POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

export async function getFantasyPlayers(opts: {
  season?: number; position?: string; q?: string; limit: number;
}): Promise<FantasyPlayersResponse> {
  let position = opts.position;
  if (position !== undefined) {
    position = position.toUpperCase();
    if (!POSITIONS.has(position)) throw new ApiError(400, `Unknown position: ${position}`);
  }

  const seasons = await statSeasons();
  if (seasons.length === 0) throw new ApiError(503, "No player stats loaded.");
  const target = opts.season ?? seasons[0]!;
  if (!seasons.includes(target)) throw new ApiError(404, `Season ${target} not loaded.`);

  const clauses = ["s.season = $1", "s.season_type = 'REG'"];
  const params: unknown[] = [target, opts.limit];
  if (position) {
    params.push(position);
    clauses.push(`p.position = $${params.length}`);
  }
  if (opts.q) {
    params.push(`%${opts.q.toLowerCase()}%`);
    clauses.push(`LOWER(p.full_name) LIKE $${params.length}`);
  }

  const rows = await q<{
    player_id: string; name: string; team: string | null; position: string | null;
    gp: number; pass_yds: number; pass_tds: number; ints: number; rush_yds: number;
    rush_tds: number; rec: number; rec_yds: number; rec_tds: number; fp: number;
    fp_half: number; fp_std: number;
  }>(
    // Half-PPR and standard scoring differ from PPR only by the per-reception
    // bonus, so they subtract 0.5/1.0 per catch from the stored PPR total.
    `SELECT p.player_id, p.full_name AS name, s.team_id AS team, p.position,
            COALESCE(s.games_played, 0) AS gp,
            COALESCE(s.passing_yards, 0) AS pass_yds,
            COALESCE(s.passing_tds, 0) AS pass_tds,
            COALESCE(s.interceptions, 0) AS ints,
            COALESCE(s.rushing_yards, 0) AS rush_yds,
            COALESCE(s.rushing_tds, 0) AS rush_tds,
            COALESCE(s.receptions, 0) AS rec,
            COALESCE(s.receiving_yards, 0) AS rec_yds,
            COALESCE(s.receiving_tds, 0) AS rec_tds,
            COALESCE(s.fantasy_points_ppr, 0) AS fp,
            COALESCE(s.fantasy_points_ppr, 0) - 0.5 * COALESCE(s.receptions, 0) AS fp_half,
            COALESCE(s.fantasy_points_ppr, 0) - COALESCE(s.receptions, 0) AS fp_std
     FROM player_season_stats s JOIN players p USING (player_id)
     WHERE ${clauses.join(" AND ")}
     ORDER BY fp DESC, p.full_name
     LIMIT $2`,
    params,
  );

  return {
    season: target,
    seasons,
    players: rows.map((r) => ({
      player_id: r.player_id,
      name: r.name,
      team: r.team,
      position: r.position,
      headshot_url: headshotUrl(r.player_id),
      games_played: r.gp,
      passing_yards: r.pass_yds,
      passing_tds: r.pass_tds,
      interceptions: r.ints,
      rushing_yards: r.rush_yds,
      rushing_tds: r.rush_tds,
      receptions: r.rec,
      receiving_yards: r.rec_yds,
      receiving_tds: r.rec_tds,
      fantasy_points_ppr: round(r.fp, 1),
      fantasy_points_half: round(r.fp_half, 1),
      fantasy_points_std: round(r.fp_std, 1),
      points_per_game: r.gp ? round(r.fp / r.gp, 1) : 0,
    })),
  };
}
