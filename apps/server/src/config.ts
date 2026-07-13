/** Runtime settings from environment / the repo-root .env. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load the repo-root .env regardless of cwd (pnpm --filter runs set cwd to
// apps/server, which silently missed the root .env in the previous backend).
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../../.env") });
dotenv.config(); // plus cwd/.env, if any (does not override existing vars)

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : fallback;
}

export const config = {
  // Hosts like Render/Fly inject the port to bind as $PORT; API_PORT is the
  // local-dev override; 4000 is the fallback.
  port: int(process.env.PORT ?? process.env.API_PORT, 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Least-privilege role for engine-executed SQL; falls back to the app URL.
  readonlyDatabaseUrl: process.env.READONLY_DATABASE_URL || process.env.DATABASE_URL || "",
  // Provider CA for verified TLS to a hosted database. Supply the PEM inline
  // (DATABASE_CA_CERT) or as a file path (DATABASE_CA_CERT_FILE). When neither
  // is set, hosted connections stay encrypted but unverified (logged warning).
  databaseCaCert: process.env.DATABASE_CA_CERT ?? "",
  databaseCaCertFile: process.env.DATABASE_CA_CERT_FILE ?? "",
  // Connection-pool sizing and query safety limits (milliseconds).
  dbPoolMax: int(process.env.DB_POOL_MAX, 10),
  dbConnectionTimeoutMs: int(process.env.DB_CONNECTION_TIMEOUT_MS, 10_000),
  // Read-only (user-facing) query cap; and a generous write cap that ingest
  // batches stay well under.
  dbStatementTimeoutMs: int(process.env.DB_STATEMENT_TIMEOUT_MS, 15_000),
  dbWriteStatementTimeoutMs: int(process.env.DB_WRITE_STATEMENT_TIMEOUT_MS, 120_000),
  // ponytail: always allow any localhost port so dynamically-assigned dev
  // ports work. Harmless — cors() sends no credentials. Tighten if a prod
  // deploy ever needs to reject localhost.
  corsOrigins: [
    ...(process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","),
    /^https?:\/\/localhost:\d+$/,
  ],
  // Trusted proxy hops in front of the API (Render/Fly terminate at one LB).
  // Drives Express's req.ip so the rate limiter can't be fooled by a spoofed
  // X-Forwarded-For. 0 = trust none (direct connections / local dev).
  trustProxy: int(process.env.TRUST_PROXY_HOPS, 1),
  answerCacheTtlSeconds: int(process.env.ANSWER_CACHE_TTL_SECONDS, 60 * 60 * 24),
  // Requests per client IP per minute on POST /api/search and /api/agent
  // (0 disables).
  rateLimitPerMinute: int(process.env.RATE_LIMIT_PER_MINUTE, 30),
  logLevel: process.env.LOG_LEVEL ?? "info",
};
