/** TEAM_GAME_LOG / GAME_RESULT executor: game rows from one team's
 * perspective, or neutral home/away rows when no team anchors the question. */

import type { GameResultSpec, TeamGameLogSpec } from "../spec.js";
import { Params, RESULT_COL, ROUND_NAME_SQL, roundPred } from "./shared.js";

export function gameRowsSql(spec: TeamGameLogSpec | GameResultSpec, p: Params): string {
  const preds: string[] = ["g.home_score IS NOT NULL"]; // completed games only
  if (spec.season != null) preds.push(`g.season = ${p.add(spec.season)}`);
  if (spec.round) {
    preds.push("g.season_type = 'POST'", roundPred(spec.round));
  } else if (spec.seasonType === "POST") {
    preds.push("g.season_type = 'POST'");
  } else if (spec.season != null || spec.weekMin != null) {
    preds.push("g.season_type = 'REG'");
  }
  if (spec.weekMin != null) preds.push(`g.week >= ${p.add(spec.weekMin)}`);
  if (spec.weekMax != null) preds.push(`g.week <= ${p.add(spec.weekMax)}`);
  if (spec.gameDate) preds.push(`g.game_date = ${p.add(spec.gameDate)}`);
  if (spec.marginMax != null) {
    preds.push(`ABS(g.home_score - g.away_score) <= ${p.add(spec.marginMax)}`);
  }
  if (spec.conf) {
    const conf = p.add(spec.conf);
    preds.push(
      `EXISTS (SELECT 1 FROM teams tc WHERE tc.team_id = g.home_team AND tc.conference = ${conf})`,
    );
  }

  if (spec.teamId) {
    const tid = p.add(spec.teamId);
    preds.push(`(g.home_team = ${tid} OR g.away_team = ${tid})`);
    if (spec.team2Id) {
      const t2 = p.add(spec.team2Id);
      preds.push(`(g.home_team = ${t2} OR g.away_team = ${t2})`);
    }
    if (spec.venue === "home") preds.push(`g.home_team = ${tid}`);
    if (spec.venue === "away") preds.push(`g.away_team = ${tid}`);
    const inner =
      "SELECT g.game_id, g.season, g.week, g.game_date, " +
      `${ROUND_NAME_SQL} AS round, ` +
      `CASE WHEN g.home_team = ${tid} THEN g.away_team ELSE g.home_team END AS opponent, ` +
      `CASE WHEN g.home_team = ${tid} THEN 'home' ELSE 'away' END AS venue, ` +
      `CASE WHEN g.home_team = ${tid} THEN g.home_score ELSE g.away_score END AS team_score, ` +
      `CASE WHEN g.home_team = ${tid} THEN g.away_score ELSE g.home_score END AS opp_score ` +
      "FROM games g " +
      `WHERE ${preds.join(" AND ")}`;
    return (
      `SELECT ts.*, ${RESULT_COL} FROM (${inner}) ts ` +
      "ORDER BY ts.season DESC, ts.week DESC " +
      `LIMIT ${p.add(spec.limit)}`
    );
  }

  // Neutral rows ("who won Super Bowl 50"): both teams by name, winner first
  // in narration; most recent matching game first.
  return (
    "SELECT g.game_id, g.season, g.week, g.game_date, " +
    `${ROUND_NAME_SQL} AS round, ` +
    "ht.name AS home_name, g.home_team, g.home_score, " +
    "at.name AS away_name, g.away_team, g.away_score, g.stadium " +
    "FROM games g " +
    "JOIN teams ht ON ht.team_id = g.home_team " +
    "JOIN teams at ON at.team_id = g.away_team " +
    `WHERE ${preds.join(" AND ")} ` +
    "ORDER BY g.season DESC, g.week DESC " +
    `LIMIT ${p.add(spec.limit)}`
  );
}
