/** SCORING executor: a player's touchdown timeline from scoring_plays —
 * first/last TD, or a most-recent-first list — plus the scoring BOARD:
 * touchdown counts per player filtered by distance and td_kind. */

import type { ScoringBoardSpec, ScoringSpec } from "../spec.js";
import { gamePreds, Params, roundPred } from "./shared.js";

/** "Most TDs of 50 or more yards" / "from exactly 1 yard out" / "inside the
 * 5" / defensive-return boards: COUNT(*) per scorer over scoring_plays.
 * Distance bounds compare s.yards (NULL distance never qualifies); kind
 * filters compare the exact ingest-time td_kind classification — never the
 * description text, which miscounts own-fumble recoveries as defensive.
 * scoring_plays is aliased `s` so the shared gamePreds venue/opponent
 * predicates (s.team_id vs games) apply unchanged. */
export function scoringBoardSql(spec: ScoringBoardSpec, p: Params): string {
  const where = [...gamePreds(spec, p)];
  if (spec.yardsMin != null) where.push(`s.yards >= ${p.add(spec.yardsMin)}`);
  if (spec.yardsMax != null) where.push(`s.yards <= ${p.add(spec.yardsMax)}`);
  if (spec.tdKind === "defense") {
    where.push("s.td_kind IN ('int_return', 'fumble_return')");
  } else if (spec.tdKind) {
    where.push(`s.td_kind = ${p.add(spec.tdKind)}`);
  }
  return (
    "SELECT p.player_id, p.full_name, COUNT(*) AS value " +
    "FROM scoring_plays s " +
    "JOIN games g ON g.game_id = s.game_id " +
    "JOIN players p ON p.player_id = s.player_id " +
    `WHERE ${where.join(" AND ")} ` +
    "GROUP BY p.player_id, p.full_name " +
    `ORDER BY value DESC, p.full_name LIMIT ${p.add(spec.limit)}`
  );
}

export function scoringSql(spec: ScoringSpec, p: Params): string {
  if (spec.longest) {
    // Longest touchdowns by play length, league-wide or for one player.
    const where = [`g.season_type = ${p.add(spec.seasonType)}`, "sp.yards IS NOT NULL"];
    if (spec.playerId) where.push(`sp.player_id = ${p.add(spec.playerId)}`);
    if (spec.season != null) where.push(`g.season = ${p.add(spec.season)}`);
    return (
      "SELECT p.player_id, p.full_name, g.season, g.week, g.game_date, " +
      "CASE WHEN sp.team_id = g.home_team THEN g.away_team " +
      "ELSE g.home_team END AS opponent, " +
      "sp.yards, sp.play_type, sp.description " +
      "FROM scoring_plays sp " +
      "JOIN games g ON g.game_id = sp.game_id " +
      "JOIN players p ON p.player_id = sp.player_id " +
      `WHERE ${where.join(" AND ")} ` +
      `ORDER BY sp.yards DESC, g.season DESC LIMIT ${p.add(spec.limit)}`
    );
  }
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
