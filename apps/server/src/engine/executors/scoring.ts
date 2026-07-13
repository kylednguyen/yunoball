/** SCORING executor: a player's touchdown timeline from scoring_plays —
 * first/last TD, or a most-recent-first list. */

import type { ScoringSpec } from "../spec.js";
import { Params, roundPred } from "./shared.js";

export function scoringSql(spec: ScoringSpec, p: Params): string {
  const where = [
    `sp.player_id = ${p.add(spec.playerId)}`,
    `g.season_type = ${p.add(spec.seasonType)}`,
  ];
  if (spec.season != null) where.push(`g.season = ${p.add(spec.season)}`);
  if (spec.sbOnly || spec.round) where.push(roundPred(spec.round ?? "SB"));
  const dir = spec.edge === "first" ? "ASC" : "DESC";
  return (
    "SELECT p.player_id, p.full_name, g.season, g.week, g.game_date, " +
    "CASE WHEN sp.team_id = g.home_team THEN g.away_team " +
    "ELSE g.home_team END AS opponent, " +
    "sp.qtr, sp.play_type, sp.description " +
    "FROM scoring_plays sp " +
    "JOIN games g ON g.game_id = sp.game_id " +
    "JOIN players p ON p.player_id = sp.player_id " +
    `WHERE ${where.join(" AND ")} ` +
    `ORDER BY g.season ${dir}, g.week ${dir}, sp.play_id ${dir} ` +
    `LIMIT ${p.add(spec.edge ? 1 : spec.limit)}`
  );
}
