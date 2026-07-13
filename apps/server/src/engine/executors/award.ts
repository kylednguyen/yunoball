/** AWARD executor: MVP / Super Bowl MVP winners from the curated static
 * facts table (engine/facts.ts), served through SQL VALUES so the pipeline's
 * spec -> SQL -> rows contract holds. The literals are code constants, never
 * user input; season/player filters are bound parameters. */

import { AWARDS } from "../facts.js";
import type { AwardSpec } from "../spec.js";
import { Params } from "./shared.js";

export function awardSql(spec: AwardSpec, p: Params): string {
  const values = AWARDS
    .map((a) => `(${a.season}, '${a.award}', '${a.player.replace(/'/g, "''")}')`)
    .join(", ");
  const preds = [`a.award = ${p.add(spec.award)}`];
  if (spec.season != null) preds.push(`a.season = ${p.add(spec.season)}`);
  if (spec.player) preds.push(`a.player ILIKE ${p.add(`%${spec.player}%`)}`);
  return (
    `SELECT a.season, a.award, a.player, COUNT(*) OVER () AS wins ` +
    `FROM (VALUES ${values}) AS a(season, award, player) ` +
    `WHERE ${preds.join(" AND ")} ` +
    "ORDER BY a.season DESC LIMIT 30"
  );
}
