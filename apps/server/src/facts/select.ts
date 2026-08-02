/** Daily selection.
 *
 * Selection is a PURE FUNCTION of the date over the ranked backlog, which is
 * what lets the cron job be a cache warmer rather than a hard dependency:
 * the scheduled run and an API read compute the same answer, so a missed or
 * delayed run self-heals on the next request instead of leaving a hole.
 *
 * (Scheduled GitHub Actions drift and are occasionally skipped outright. A
 * "fact of the day" that silently goes stale is the obvious failure mode, so
 * the design removes the dependency instead of monitoring it.)
 */

import { createHash } from "node:crypto";
import { q, pool } from "../db/pool.js";
import type { StoredFact } from "./store.js";
import { FACT_COLUMNS, rowToFact } from "./store.js";

/** How many days a subject must sit out after being featured. Without this the
 * backlog's top slice is one player's whole season. */
const SUBJECT_COOLDOWN_DAYS = 10;

/** Size of the pool the day's hash picks from. Deep enough that consecutive
 * days differ, shallow enough that the pick is always a genuinely surprising
 * fact rather than the 200th-best one. */
const CANDIDATE_POOL = 25;

/** Deterministic index from a date string — no Math.random, so the same day
 * always resolves to the same fact given the same backlog. */
function pickIndex(day: string, count: number): number {
  const digest = createHash("sha1").update(day).digest();
  return digest.readUInt32BE(0) % count;
}

/** The ranked, cooldown-filtered backlog for a given day. */
async function backlog(day: string): Promise<StoredFact[]> {
  const rows = await q<Record<string, unknown>>(
    `SELECT ${FACT_COLUMNS} FROM stat_facts f
     WHERE NOT EXISTS (
       SELECT 1 FROM fact_of_the_day d
       JOIN stat_facts f2 ON f2.fact_id = d.fact_id
       WHERE f2.subject_id = f.subject_id
         AND d.day > $1::date - $2::int
         AND d.day <= $1::date
     )
     ORDER BY f.surprise DESC, f.fact_id
     LIMIT $3`,
    [day, SUBJECT_COOLDOWN_DAYS, CANDIDATE_POOL],
  );
  return rows.map(rowToFact);
}

/** Compute the day's fact without writing. */
async function computeFactOfTheDay(day: string): Promise<StoredFact | null> {
  const pool_ = await backlog(day);
  if (pool_.length === 0) return null;
  return pool_[pickIndex(day, pool_.length)] ?? null;
}

/** Read the published fact for a day, computing and backfilling it if the
 * scheduled run never happened. */
export async function factOfTheDay(day: string): Promise<StoredFact | null> {
  const existing = await q<Record<string, unknown>>(
    `SELECT ${FACT_COLUMNS} FROM stat_facts f
     JOIN fact_of_the_day d ON d.fact_id = f.fact_id
     WHERE d.day = $1`,
    [day],
  );
  if (existing.length > 0) return rowToFact(existing[0]!);

  const chosen = await computeFactOfTheDay(day);
  if (chosen) await publish(day, chosen.fact_id);
  return chosen;
}

/** Write the day's selection. Idempotent: re-running the cron job on a day
 * that already has a fact leaves it alone rather than swapping it out from
 * under anyone who already read it. */
async function publish(day: string, factId: string): Promise<void> {
  await pool().query(
    `INSERT INTO fact_of_the_day (day, fact_id) VALUES ($1, $2)
     ON CONFLICT (day) DO NOTHING`,
    [day, factId],
  );
}

/** The cron entry point: select and publish for a given day. */
export async function selectForDay(day: string): Promise<StoredFact | null> {
  return factOfTheDay(day);
}
