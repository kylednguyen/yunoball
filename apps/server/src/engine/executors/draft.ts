/** DRAFT_PICK executor: draft lookups by overall pick, team, round, or
 * player name. */

import type { DraftPickSpec } from "../spec.js";
import { Params } from "./shared.js";

export function draftSql(spec: DraftPickSpec, p: Params): string {
  const preds: string[] = [];
  if (spec.playerId) {
    preds.push(`d.player_id = ${p.add(spec.playerId)}`);
  } else if (spec.player) {
    preds.push(`lower(d.player_name) = ${p.add(spec.player.toLowerCase())}`);
  }
  if (spec.season != null) {
    preds.push(`d.season = ${p.add(spec.season)}`);
  } else if (spec.draftPick != null && !spec.playerId && !spec.player) {
    // "the first pick" with no year means the most recent draft.
    preds.push("d.season = (SELECT MAX(season) FROM draft_picks)");
  }
  if (spec.draftPick != null) preds.push(`d.pick = ${p.add(spec.draftPick)}`);
  if (spec.draftRound != null) preds.push(`d.round = ${p.add(spec.draftRound)}`);
  if (spec.teamId) preds.push(`d.team_id = ${p.add(spec.teamId)}`);
  return (
    "SELECT d.season, d.round, d.pick, d.team_id AS team, t.name AS team_name, " +
    "d.player_name, d.position, d.college, d.player_id " +
    "FROM draft_picks d LEFT JOIN teams t ON t.team_id = d.team_id " +
    (preds.length ? `WHERE ${preds.join(" AND ")} ` : "") +
    `ORDER BY d.season DESC, d.pick LIMIT ${p.add(spec.limit)}`
  );
}
