/** Answer cache — two-tier in-process LRU with TTL, plus the durable
 * shareable store in Postgres.
 *
 *   L1: normalized question text -> response   (skips the whole pipeline)
 *   L2: QuerySpec key           -> response   (dedupes different phrasings)
 *
 * The previous backend used Redis with an in-memory fallback; a single Node
 * process only needs the in-memory tier. Durability (share links surviving a
 * restart) comes from the Postgres answer_cache table, not the hot cache.
 * ponytail: in-process LRU; add Redis behind these four functions if the API
 * ever runs multi-instance.
 */

import { createHash } from "node:crypto";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { logger } from "./logger.js";
import type { AnswerResult } from "@yunoball/types";

class LruTtl<V> {
  private store = new Map<string, { value: V; expiry: number }>();
  constructor(private maxSize = 1024) {}

  get(key: string): V | undefined {
    const item = this.store.get(key);
    if (!item) return undefined;
    if (item.expiry <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key); // re-insert to refresh recency
    this.store.set(key, item);
    return item.value;
  }

  set(key: string, value: V, ttlSeconds: number): void {
    this.store.delete(key);
    this.store.set(key, { value, expiry: Date.now() + ttlSeconds * 1000 });
    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

const answers = new LruTtl<AnswerResult>();

// --------------------------- keys --------------------------- //

/** Lowercase and strip punctuation so "...touchdowns?" and "...touchdowns"
 * share a cache entry. */
export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

/** Stable, shareable handle for a question (digest of its normalized form). */
export function shareId(question: string): string {
  return hash(normalizeQuestion(question));
}

export function textKey(question: string): string {
  return `yb:q:${hash(normalizeQuestion(question))}`;
}

export function specKey(specCacheKey: string): string {
  return `yb:spec:${hash(specCacheKey)}`;
}

// --------------------------- ops --------------------------- //

export function cacheGet(key: string): AnswerResult | undefined {
  return answers.get(key);
}

export function cacheSet(key: string, payload: AnswerResult): void {
  answers.set(key, payload, config.answerCacheTtlSeconds);
}

// ------------------- durable shareable store (Postgres) ------------------- //

const PERSIST_SQL = `
  INSERT INTO answer_cache (share_id, question, normalized_question, sql, answer_json, hits)
  VALUES ($1, $2, $3, $4, $5, 1)
  ON CONFLICT (normalized_question) DO UPDATE SET
    share_id = EXCLUDED.share_id,
    sql = EXCLUDED.sql,
    answer_json = EXCLUDED.answer_json,
    hits = answer_cache.hits + 1
`;

/** Durably record an answer for sharing + analytics (best-effort). */
export async function persistAnswer(payload: AnswerResult): Promise<void> {
  try {
    await pool().query(PERSIST_SQL, [
      payload.share_id ?? shareId(payload.question),
      payload.question,
      normalizeQuestion(payload.question),
      payload.sql,
      JSON.stringify(payload),
    ]);
  } catch (err) {
    logger.warn({ err }, "answer persist failed (non-fatal)");
  }
}

export async function getAnswerByShareId(sid: string): Promise<AnswerResult | null> {
  try {
    const res = await pool().query(
      "SELECT answer_json FROM answer_cache WHERE share_id = $1",
      [sid],
    );
    const row = res.rows[0];
    return row ? (JSON.parse(row.answer_json) as AnswerResult) : null;
  } catch (err) {
    logger.warn({ err }, "share lookup failed");
    return null;
  }
}
