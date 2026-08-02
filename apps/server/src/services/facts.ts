/** Notable-fact reads.
 *
 * Everything here is a single-row or short-list lookup against stat_facts —
 * the expensive window scans happen in the mining job, never in a request.
 */

import type { FactOfTheDayResponse, FactsResponse, StatFact, StatFactDetail } from "@yunoball/types";
import { q } from "../db/pool.js";
import { factOfTheDay } from "../facts/select.js";
import { FACT_COLUMNS, rowToFact, type StoredFact } from "../facts/store.js";
import { ApiError } from "../lib/errors.js";

/** The list shape drops the evidence rows and the internal rarity term; the
 * detail route carries the evidence. The probe's SQL never crosses the wire at
 * all — it is stored for provenance and inspected through the CLI, matching
 * how an answer's query is redacted at the HTTP boundary (redactAnswer). */
function toWire(f: StoredFact): StatFact {
  const { sql: _sql, evidence: _evidence, rarity: _rarity, ...rest } = f;
  return rest;
}

export async function getFactOfTheDay(day?: string): Promise<FactOfTheDayResponse> {
  const target = day ?? new Date().toISOString().slice(0, 10);
  const fact = await factOfTheDay(target);
  return { day: target, fact: fact ? toWire(fact) : null };
}

export async function getFacts(
  opts: { season?: number; limit?: number } = {},
): Promise<FactsResponse> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const params: unknown[] = [];
  let where = "";
  if (opts.season !== undefined) {
    params.push(opts.season);
    where = `WHERE f.season = $${params.length}`;
  }
  params.push(limit);
  const rows = await q<Record<string, unknown>>(
    `SELECT ${FACT_COLUMNS} FROM stat_facts f ${where}
     ORDER BY f.surprise DESC, f.fact_id
     LIMIT $${params.length}`,
    params,
  );
  return { facts: rows.map(rowToFact).map(toWire) };
}

export async function getFact(factId: string): Promise<StatFactDetail> {
  const rows = await q<Record<string, unknown>>(
    `SELECT ${FACT_COLUMNS} FROM stat_facts f WHERE f.fact_id = $1`,
    [factId],
  );
  if (rows.length === 0) throw new ApiError(404, "No such fact.");
  const stored = rowToFact(rows[0]!);
  return { ...toWire(stored), evidence: stored.evidence as Record<string, unknown>[] };
}
