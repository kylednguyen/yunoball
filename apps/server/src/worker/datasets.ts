/** Dataset catalog + pure backfill/resume planning for the ingestion worker.
 *
 * This module is intentionally DB-free and side-effect-free so the planning
 * logic (season resolution, per-dataset floor clamping, resume skip-set) is
 * unit-testable without a database. The actual load functions and DB tracking
 * live in worker/cli.ts, which maps dataset names to pipelines here.
 */

/** Clean data floor for anything play-by-play-derived (games/stats/pbp) and
 * the default backfill floor. Deeper history only exists for a few datasets. */
export const CLEAN_FLOOR = 1999;

/** season sentinel written to source_state for single-file datasets (a PK
 * column can't be NULL, so -1 stands in for "no season"). */
export const SINGLE_SEASON = -1;

export type DatasetKind = "single" | "season";

export interface DatasetMeta {
  /** Stable dataset name — the CLI `--dataset` value and the tracking key. */
  name: string;
  /** "single" = one all-history file (run once); "season" = one file per year. */
  kind: DatasetKind;
  /** Earliest season the dataset publishes. Ignored for single-file datasets. */
  floor: number;
}

/** Datasets in dependency order (dimensions before facts; player_ids after the
 * players dimension; snap_counts after games). `worker ingest:all` and
 * `backfill` iterate this list in order. Floors follow the P0 guardrails:
 * clean floor 1999, plus modern-only floors for the P0 additions. */
export const DATASETS: readonly DatasetMeta[] = [
  { name: "teams", kind: "single", floor: CLEAN_FLOOR },
  { name: "seasons", kind: "single", floor: CLEAN_FLOOR },
  { name: "players", kind: "season", floor: CLEAN_FLOOR },
  { name: "player_ids", kind: "single", floor: CLEAN_FLOOR },
  { name: "games", kind: "season", floor: CLEAN_FLOOR },
  { name: "player_game_stats", kind: "season", floor: CLEAN_FLOOR },
  { name: "player_season_stats", kind: "season", floor: CLEAN_FLOOR },
  { name: "team_game_stats", kind: "season", floor: CLEAN_FLOOR },
  { name: "scoring_plays", kind: "season", floor: CLEAN_FLOOR },
  { name: "draft_picks", kind: "single", floor: 1980 },
  { name: "trades", kind: "single", floor: 2010 },
  { name: "injuries", kind: "season", floor: 2009 },
  { name: "depth_charts", kind: "season", floor: 2001 },
  { name: "snap_counts", kind: "season", floor: 2012 },
] as const;

export function datasetNames(): string[] {
  return DATASETS.map((d) => d.name);
}

export function getDataset(name: string): DatasetMeta | undefined {
  return DATASETS.find((d) => d.name === name);
}

/** The NFL season that has started by `today` (the season year = its September).
 * Used as the default upper bound for a backfill / ingest:all. */
export function currentSeason(today = new Date()): number {
  return today.getMonth() + 1 >= 9 ? today.getFullYear() : today.getFullYear() - 1;
}

/** Inclusive [from, to] season range, clamped to the dataset's floor. Returns
 * [] for single-file datasets and for ranges that end below the floor. */
export function seasonsFor(meta: DatasetMeta, from: number, to: number): number[] {
  if (meta.kind === "single") return [];
  const start = Math.max(from, meta.floor);
  if (start > to) return [];
  return Array.from({ length: to - start + 1 }, (_, i) => start + i);
}

/** The tracking key for a (dataset, season) pair. Single-file datasets use the
 * SINGLE_SEASON sentinel so they have exactly one key. */
export function stateKey(dataset: string, season: number | null): string {
  return `${dataset}|${season ?? SINGLE_SEASON}`;
}

export interface PlannedRun {
  dataset: string;
  /** null for single-file datasets; a concrete season otherwise. */
  season: number | null;
}

/** Expand a set of datasets over a season range into the ordered list of
 * (dataset, season) runs to execute. When `done` (the source_state keys) is
 * provided and `force` is false, pairs already completed are skipped — this is
 * the resumable-backfill skip logic, kept pure for testing. */
export function planRuns(
  metas: readonly DatasetMeta[],
  from: number,
  to: number,
  done: ReadonlySet<string> = new Set(),
  force = false,
): PlannedRun[] {
  const out: PlannedRun[] = [];
  for (const meta of metas) {
    const seasons: (number | null)[] =
      meta.kind === "single" ? [null] : seasonsFor(meta, from, to);
    for (const season of seasons) {
      if (!force && done.has(stateKey(meta.name, season))) continue;
      out.push({ dataset: meta.name, season });
    }
  }
  return out;
}
