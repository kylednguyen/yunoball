/** PLAYER_RANK executor: one player's league rank on a stat over a scope
 * (career / season / range). */

import type { PlayerRankSpec } from "../spec.js";
import { Params, statDef, sumValueExpr } from "./shared.js";

export function rankSql(spec: PlayerRankSpec, p: Params): string {
  const def = statDef(spec);
  const valueExpr = sumValueExpr(def);
  const preds = [`s.season_type = ${p.add(spec.seasonType)}`];
  if (spec.seasonMin != null && spec.seasonMax != null) {
    preds.push(`s.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`);
  } else if (spec.scope !== "career" && spec.season != null) {
    preds.push(`s.season = ${p.add(spec.season)}`);
  }
  const posPred = spec.position ? ` AND p.position = ${p.add(spec.position)}` : "";
  // Ratio ranks need a volume floor; counted denominators exclude non-producers
  // so "1st of N" reflects players who actually recorded the stat.
  const having = def.ratio
    ? ` HAVING SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(spec.scope === "career" ? 1000 : 150)}`
    : ` HAVING SUM(${def.expr}) > 0`;
  return (
    "WITH ranked AS (" +
    `SELECT p.player_id, p.full_name, ${valueExpr} AS value, ` +
    `RANK() OVER (ORDER BY ${valueExpr} DESC) AS rk, ` +
    "COUNT(*) OVER () AS total_players " +
    "FROM player_season_stats s JOIN players p ON p.player_id = s.player_id " +
    `WHERE ${preds.join(" AND ")}${posPred} ` +
    `GROUP BY p.player_id, p.full_name${having}) ` +
    `SELECT * FROM ranked WHERE player_id = ${p.add(spec.playerId)}`
  );
}
