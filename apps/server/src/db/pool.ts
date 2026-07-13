/** Postgres pools — one read/write (ingest, answer persistence), one wired to
 * the least-privilege read-only role for query execution and API reads. */

import fs from "node:fs";
import pg from "pg";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

// SUM()/COUNT() come back as int8/numeric, which node-postgres returns as
// strings; the warehouse's magnitudes are all far below 2^53, so parse them —
// the wire format must carry numbers (parity with the previous backend).
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);
// Dates as plain YYYY-MM-DD strings, not JS Date objects.
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

/** TLS options for a hosted connection. Prefer verified TLS: when a CA is
 * supplied (DATABASE_CA_CERT as PEM, or DATABASE_CA_CERT_FILE as a path) the
 * server certificate is validated. Only when no CA is configured do we fall
 * back to encrypted-but-unverified, and we say so loudly — an unverified
 * channel is MITM-able, so it should be a conscious, visible choice. */
function sslFor(url: string): pg.PoolConfig["ssl"] {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (local) return undefined;

  const ca =
    config.databaseCaCert ||
    (config.databaseCaCertFile ? fs.readFileSync(config.databaseCaCertFile, "utf8") : "");
  if (ca) return { ca, rejectUnauthorized: true };

  logger.warn(
    "Database TLS is enabled but the server certificate is NOT verified " +
      "(no DATABASE_CA_CERT / DATABASE_CA_CERT_FILE set). The connection is " +
      "encrypted but MITM-able — set the provider CA in production.",
  );
  return { rejectUnauthorized: false };
}

function makePool(url: string, label: string, statementTimeoutMs: number): pg.Pool {
  if (!url) throw new Error("No database URL set (DATABASE_URL).");
  const p = new pg.Pool({
    connectionString: url,
    max: config.dbPoolMax,
    ssl: sslFor(url),
    // Fail fast instead of hanging forever when the DB is unreachable.
    connectionTimeoutMillis: config.dbConnectionTimeoutMs,
    // Cap any single query so one pathological statement can't pin a
    // connection. 0 = uncapped: used for the read/write pool, where ingest
    // legitimately runs multi-second batch upserts.
    ...(statementTimeoutMs > 0
      ? { statement_timeout: statementTimeoutMs, query_timeout: statementTimeoutMs }
      : {}),
  });
  // pg emits 'error' on idle clients (pooler restarts, network resets). Without
  // a listener this becomes an uncaughtException and takes the process down; a
  // dropped idle connection must be a logged non-event, not a restart.
  p.on("error", (err) => {
    logger.error({ err: String(err), pool: label }, "idle database client error");
  });
  return p;
}

let rw: pg.Pool | undefined;
let ro: pg.Pool | undefined;

export function pool(): pg.Pool {
  // RW pool: generous cap (minutes) so ingest's multi-second batch upserts
  // never trip it, while a truly stuck write is still bounded rather than
  // pinning a connection forever. When no separate read-only URL is set, this
  // pool also serves reads (still bounded).
  return (rw ??= makePool(config.databaseUrl, "rw", config.dbWriteStatementTimeoutMs));
}

export function roPool(): pg.Pool {
  if (config.readonlyDatabaseUrl === config.databaseUrl) return pool();
  // Dedicated RO pool: user-facing reads get the tight cap so a runaway query
  // can't wedge a client.
  return (ro ??= makePool(config.readonlyDatabaseUrl, "ro", config.dbStatementTimeoutMs));
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
