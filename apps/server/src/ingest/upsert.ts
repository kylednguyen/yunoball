/** Batched, transactional INSERT ... ON CONFLICT DO UPDATE.
 *
 * Multi-row VALUES inserts (chunked under Postgres's parameter budget) inside
 * one transaction per call, so re-running a season updates rows in place and
 * an interrupted run never leaves a table half-written.
 */

import type pg from "pg";
import type { ZodType } from "zod";
import { logger } from "../lib/logger.js";
import type { Ctx } from "./context.js";

const PARAM_BUDGET = 60_000; // Postgres caps bind params at 65_535

type Row = Record<string, unknown>;

export async function upsert(
  ctx: Ctx,
  table: string,
  rows: Row[],
  conflict: string[],
  schema: ZodType,
): Promise<number> {
  // Dedupe within the batch on the conflict key so a single statement can't
  // hit "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const byKey = new Map<string, Row>();
  for (const row of rows) byKey.set(conflict.map((c) => String(row[c])).join("|"), row);
  const deduped = [...byKey.values()];

  // Validate every row against the warehouse schema before writing.
  for (const row of deduped) {
    const res = schema.safeParse(row);
    if (!res.success) {
      throw new Error(
        `${table}: row failed schema validation: ${res.error.issues[0]?.message} in ${JSON.stringify(row).slice(0, 200)}`,
      );
    }
  }

  // Record this batch's pk values for downstream FK checks in the same run.
  if (conflict.length === 1) {
    const seen = ctx.ids.get(table) ?? new Set<string>();
    for (const row of deduped) seen.add(String(row[conflict[0]!]));
    ctx.ids.set(table, seen);
  }

  if (ctx.dryRun) {
    logger.info({ table, rows: deduped.length }, "[dry-run] would upsert");
    return deduped.length;
  }
  if (deduped.length === 0) return 0;

  const cols = Object.keys(deduped[0]!);
  const updates = cols.filter((c) => !conflict.includes(c));
  const action = updates.length
    ? `DO UPDATE SET ${updates.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
    : "DO NOTHING";
  const chunkSize = Math.max(1, Math.floor(PARAM_BUDGET / cols.length));

  const client: pg.PoolClient = await ctx.pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < deduped.length; i += chunkSize) {
      const chunk = deduped.slice(i, i + chunkSize);
      const params: unknown[] = [];
      const values = chunk
        .map(
          (row) =>
            `(${cols
              .map((c) => {
                params.push(row[c] ?? null);
                return `$${params.length}`;
              })
              .join(", ")})`,
        )
        .join(", ");
      await client.query(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES ${values}
         ON CONFLICT (${conflict.join(", ")}) ${action}`,
        params,
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return deduped.length;
}
