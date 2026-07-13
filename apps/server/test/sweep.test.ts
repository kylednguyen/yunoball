/**
 * Capability sweep: for every stat-bearing intent × every stat in the
 * allowlist, build the SQL and EXPLAIN it against a schema-only scratch
 * database. EXPLAIN plans the query without running it, so it catches the
 * whole crash class the executors used to hide — SUM() over an empty ratio
 * expr, or a game-only column (carries, air yards, EPA) referenced against a
 * table that doesn't have it.
 *
 * The contract this pins: buildSql must NEVER emit SQL that fails to plan. A
 * stat an executor can't compute must be refused by the parser, not turned
 * into invalid SQL. So every (intent, stat) pair here must EXPLAIN cleanly.
 *
 * Requires the dev Postgres from docker-compose (localhost:5432); the test
 * creates and drops its own scratch database.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSql } from "../src/engine/build.js";
import { isComparableStat, statComputableFor } from "../src/engine/executors/shared.js";
import { STATS } from "../src/engine/spec.js";
import type { QuerySpec } from "../src/engine/spec.js";

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgresql://yunoball:yunoball@localhost:5432/yunoball";
const SCRATCH_DB = "yunoball_sweep_test";
const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(path.resolve(here, "../src/db/schema.sql"), "utf8");

let client: pg.Client;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${SCRATCH_DB}`;
  client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query(SCHEMA);
}, 30_000);

afterAll(async () => {
  await client?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
  await admin.end();
});

/** A representative spec per stat-bearing intent, parameterized by stat. Only
 * the fields the executor reads matter; EXPLAIN validates the shape. */
function specsForStat(stat: string): QuerySpec[] {
  const base = { stat, seasonType: "REG" as const };
  return [
    { intent: "leaders", ...base, scope: "season", season: 2023, dir: "desc", perGame: false, limit: 5 },
    { intent: "player_total", ...base, player: "X", playerId: "P1", scope: "career", limit: 1 },
    { intent: "player_rank", ...base, player: "X", playerId: "P1", scope: "career", limit: 1 },
    { intent: "qualifying_count", ...base, scope: "season", season: 2023, threshold: { op: ">", value: 1 }, limit: 1 },
    { intent: "game_count", ...base, player: "X", playerId: "P1", threshold: { op: ">", value: 1 }, limit: 5 },
    { intent: "single_game", ...base, player: "X", playerId: "P1", limit: 1 },
    { intent: "player_streak", ...base, player: "X", playerId: "P1", threshold: { op: ">=", value: 1 } },
    { intent: "team_stat", ...base, team: "KC", teamId: "KC", season: 2023 },
    { intent: "compare", ...base, player: "A", playerId: "P1", player2: "B", player2Id: "P2", scope: "season", limit: 2 },
    { intent: "milestone", ...base, target: 1000 },
  ] as unknown as QuerySpec[];
}

describe("capability sweep: every intent × stat plans cleanly", () => {
  it("emits no SQL that fails to EXPLAIN", async () => {
    const failures: string[] = [];
    let checked = 0;
    for (const stat of Object.keys(STATS)) {
      for (const spec of specsForStat(stat)) {
        // The capability gate (pipeline) refuses these before buildSql — the
        // sweep asserts everything that DOES reach the executors plans cleanly.
        const routable =
          spec.intent === "compare" ? isComparableStat(stat) : statComputableFor(spec.intent, stat);
        if (!routable) continue;
        checked++;
        let sql = "";
        let params: unknown[] = [];
        try {
          ({ sql, params } = buildSql(spec));
        } catch (err) {
          failures.push(`build ${spec.intent}/${stat}: ${String(err)}`);
          continue;
        }
        try {
          await client.query({ text: `EXPLAIN ${sql}`, values: params });
        } catch (err) {
          const msg = String(err).replace(/\s+/g, " ").slice(0, 120);
          failures.push(`explain ${spec.intent}/${stat}: ${msg}`);
        }
      }
    }
    expect(failures).toEqual([]);
    // Guard against the gate silently refusing everything.
    expect(checked).toBeGreaterThan(150);
  }, 60_000);
});
