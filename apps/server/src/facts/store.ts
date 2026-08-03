/** Reading facts back out of the warehouse.
 *
 * One column list and one row mapper, shared by the selector and the API
 * service, so the wire shape can't drift between "the fact the cron published"
 * and "the fact the endpoint serves".
 */

import type { OccurrenceRow } from "./types.js";

/** Selected columns, aliased `f`. `sql` and `evidence` are included: a fact
 * that can't show its work doesn't ship, and the API exposes both on the
 * detail route the same way an answer card exposes its SQL. */
export const FACT_COLUMNS = [
  "f.fact_id", "f.probe_id", "f.family", "f.subject_kind", "f.subject_id",
  "f.subject_name", "f.season", "f.week", "f.season_type", "f.headline",
  "f.metric", "f.value", "f.population", "f.prior_season", "f.coverage_floor",
  "f.rarity", "f.surprise", "f.sql", "f.evidence", "f.question", "f.computed_at",
].join(", ");

export interface StoredFact {
  fact_id: string;
  probe_id: string;
  family: string;
  subject_kind: string;
  subject_id: string | null;
  subject_name: string;
  season: number | null;
  week: number | null;
  season_type: string;
  headline: string;
  metric: string | null;
  value: number | null;
  population: number;
  prior_season: number | null;
  coverage_floor: number;
  rarity: number;
  surprise: number;
  sql: string;
  evidence: OccurrenceRow[];
  question: string | null;
  computed_at: string;
}

export function rowToFact(r: Record<string, unknown>): StoredFact {
  return {
    fact_id: String(r.fact_id),
    probe_id: String(r.probe_id),
    family: String(r.family),
    subject_kind: String(r.subject_kind),
    subject_id: r.subject_id === null ? null : String(r.subject_id),
    subject_name: String(r.subject_name),
    season: r.season === null ? null : Number(r.season),
    week: r.week === null ? null : Number(r.week),
    season_type: String(r.season_type),
    headline: String(r.headline),
    metric: r.metric === null ? null : String(r.metric),
    value: r.value === null ? null : Number(r.value),
    population: Number(r.population),
    prior_season: r.prior_season === null ? null : Number(r.prior_season),
    coverage_floor: Number(r.coverage_floor),
    rarity: Number(r.rarity),
    surprise: Number(r.surprise),
    sql: String(r.sql),
    // jsonb comes back parsed from node-postgres.
    evidence: (r.evidence ?? []) as OccurrenceRow[],
    question: r.question === null ? null : String(r.question),
    computed_at: String(r.computed_at),
  };
}
