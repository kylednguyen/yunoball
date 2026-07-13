/** PLAYER_BIO executor: one player's roster card, or a bio-superlative board
 * ("tallest player", "oldest quarterback"). */

import type { PlayerBioSpec } from "../spec.js";
import { Params } from "./shared.js";

export function bioSql(spec: PlayerBioSpec, p: Params): string {
  const bioCols =
    "p.player_id, p.full_name, p.position, p.birth_date, p.height_inches, " +
    "p.weight_lbs, p.college, p.jersey_number, " +
    "EXTRACT(YEAR FROM age(p.birth_date))::int AS age";
  if (spec.playerId && spec.bioField === "teams") {
    // Every franchise the player has appeared for, in order of arrival.
    return (
      "SELECT s.team_id AS team, t.name AS team_name, " +
      "MIN(s.season) AS first_season, MAX(s.season) AS last_season, " +
      "COUNT(DISTINCT s.season) AS seasons " +
      "FROM player_season_stats s " +
      "LEFT JOIN teams t ON t.team_id = s.team_id " +
      `WHERE s.player_id = ${p.add(spec.playerId)} ` +
      "AND s.season_type = 'REG' AND s.team_id IS NOT NULL " +
      "GROUP BY s.team_id, t.name " +
      "ORDER BY MIN(s.season)"
    );
  }
  if (spec.playerId && spec.bioField === "experience") {
    return (
      "SELECT p.player_id, p.full_name, " +
      "COUNT(DISTINCT s.season) AS seasons, " +
      "MIN(s.season) AS first_season, MAX(s.season) AS last_season " +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE s.player_id = ${p.add(spec.playerId)} AND s.season_type = 'REG' ` +
      "GROUP BY p.player_id, p.full_name"
    );
  }
  if (spec.playerId) {
    return (
      `SELECT ${bioCols}, latest.team_id AS team, t.name AS team_name ` +
      "FROM players p " +
      "LEFT JOIN LATERAL (SELECT team_id FROM player_season_stats s " +
      "WHERE s.player_id = p.player_id AND s.team_id IS NOT NULL " +
      "ORDER BY s.season DESC LIMIT 1) latest ON true " +
      "LEFT JOIN teams t ON t.team_id = latest.team_id " +
      `WHERE p.player_id = ${p.add(spec.playerId)}`
    );
  }
  // Superlative board. Age ranks by birth_date (oldest = earliest), so the
  // requested direction inverts relative to the raw column.
  const col =
    spec.bioField === "weight" ? "p.weight_lbs"
      : spec.bioField === "age" ? "p.birth_date"
        : "p.height_inches";
  const dir =
    spec.bioField === "age"
      ? spec.dir === "desc" ? "ASC" : "DESC"
      : spec.dir === "asc" ? "ASC" : "DESC";
  const preds = [
    `${col} IS NOT NULL`,
    "EXISTS (SELECT 1 FROM player_season_stats s WHERE s.player_id = p.player_id)",
  ];
  // Physical-plausibility bounds so a corrupt roster row (e.g. a 6'11", 173 lb
  // DB whose height is mis-entered) can't win a superlative board.
  if (spec.bioField === "height") preds.push("p.height_inches BETWEEN 63 AND 82");
  else if (spec.bioField === "weight") preds.push("p.weight_lbs BETWEEN 150 AND 400");
  else if (spec.bioField === "age") preds.push("p.birth_date >= DATE '1970-01-01'");
  if (spec.position) preds.push(`p.position = ${p.add(spec.position)}`);
  return (
    `SELECT ${bioCols} FROM players p WHERE ${preds.join(" AND ")} ` +
    `ORDER BY ${col} ${dir}, p.full_name LIMIT ${p.add(spec.limit)}`
  );
}
