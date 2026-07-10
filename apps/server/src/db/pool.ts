/** Postgres pools — one read/write (ingest, answer persistence), one wired to
 * the least-privilege read-only role for query execution and API reads. */

import pg from "pg";
import { config } from "../config.js";

// SUM()/COUNT() come back as int8/numeric, which node-postgres returns as
// strings; the warehouse's magnitudes are all far below 2^53, so parse them —
// the wire format must carry numbers (parity with the previous backend).
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);
// Dates as plain YYYY-MM-DD strings, not JS Date objects.
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

function makePool(url: string): pg.Pool {
  if (!url) throw new Error("No database URL set (DATABASE_URL).");
  return new pg.Pool({ connectionString: url, max: 10 });
}

let rw: pg.Pool | undefined;
let ro: pg.Pool | undefined;

export function pool(): pg.Pool {
  return (rw ??= makePool(config.databaseUrl));
}

export function roPool(): pg.Pool {
  if (config.readonlyDatabaseUrl === config.databaseUrl) return pool();
  return (ro ??= makePool(config.readonlyDatabaseUrl));
}

/** Read query against the read-only role. */
export async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await roPool().query(sql, params);
  return res.rows as T[];
}

export async function closePools(): Promise<void> {
  await Promise.all([rw?.end(), ro !== rw ? ro?.end() : undefined]);
  rw = ro = undefined;
}
