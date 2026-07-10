/** One ingestion run: connection, mode, id sets seen so far (FK checks),
 * and the skipped-row ledger — nothing is dropped silently. */

import type pg from "pg";
import { logger } from "../lib/logger.js";

export class Ctx {
  ids = new Map<string, Set<string>>();
  skipped = new Map<string, number>(); // "table: reason" -> count

  constructor(
    public pool: pg.Pool,
    public dryRun = false,
    public seasonType: string | null = null, // REG | POST | null = both
  ) {}

  /** Valid FK targets: rows already in the DB plus this run's upserts. */
  async known(table: string, pk: string): Promise<Set<string>> {
    const seen = this.ids.get(table) ?? new Set<string>();
    this.ids.set(table, seen);
    try {
      const res = await this.pool.query(`SELECT ${pk} FROM ${table}`);
      for (const row of res.rows) seen.add(String(row[pk]));
    } catch (err) {
      logger.debug({ table, err: String(err) }, "known() skipped (table may not exist yet)");
    }
    return seen;
  }

  /** Filter out rows and say why; tallies for the end-of-run summary. */
  drop<T>(rows: T[], keep: (row: T) => boolean, table: string, reason: string, sample: (row: T) => string): T[] {
    const kept: T[] = [];
    const dropped: T[] = [];
    for (const row of rows) (keep(row) ? kept : dropped).push(row);
    if (dropped.length > 0) {
      logger.warn(
        { table, count: dropped.length, sample: dropped.slice(0, 3).map(sample) },
        `${table}: skipping ${dropped.length} rows — ${reason}`,
      );
      const key = `${table}: ${reason}`;
      this.skipped.set(key, (this.skipped.get(key) ?? 0) + dropped.length);
    }
    return kept;
  }
}
