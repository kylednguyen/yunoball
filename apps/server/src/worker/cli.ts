/** YunoBall ingestion worker CLI.
 *
 *   pnpm worker ingest:all                          # every dataset, 1999..current
 *   pnpm worker ingest:all --from-year 2020 --to-year 2023
 *   pnpm worker ingest:dataset --dataset injuries   # one dataset, all its seasons
 *   pnpm worker ingest:dataset --dataset games --season 2023
 *   pnpm worker backfill --from-year 1999 --to-year 2024
 *   pnpm worker backfill --from-year 2012 --to-year 2024 --only snap_counts
 *   pnpm worker resume                              # skip (dataset, season) already done
 *   pnpm worker resume --force                      # re-run everything anyway
 *   pnpm worker verify                              # FK / row-count / season-gap checks
 *
 * Each (dataset, season) run writes an `ingestion_runs` row and, on success,
 * upserts `source_state` (the resumable checkpoint). A failing run is logged
 * and the worker continues with the rest, then exits nonzero. Dry runs
 * (--dry-run) validate + count without writing (and without tracking).
 */

import { parseArgs } from "node:util";
import { config } from "../config.js";
import { pool, closePools } from "../db/pool.js";
import { logger } from "../lib/logger.js";
import { Ctx } from "../ingest/context.js";
import * as p from "../ingest/pipelines.js";
import { setCachePolicy } from "../ingest/providers/nflverse.js";
import {
  CLEAN_FLOOR,
  DATASETS,
  SINGLE_SEASON,
  currentSeason,
  datasetNames,
  getDataset,
  planRuns,
  stateKey,
  type DatasetMeta,
  type PlannedRun,
} from "./datasets.js";

const SOURCE = "nflverse";

/** Dataset name -> pipeline. `years` carries the full resolved range for
 * single-file datasets (only `seasons` uses it) and the single target year for
 * per-season datasets. */
const RUNNERS: Record<string, (ctx: Ctx, years: number[]) => Promise<number>> = {
  teams: (ctx) => p.loadTeams(ctx),
  seasons: (ctx, years) => p.loadSeasons(ctx, years),
  players: (ctx, years) => p.loadPlayers(ctx, years),
  player_ids: (ctx) => p.loadPlayerIds(ctx),
  games: (ctx, years) => p.loadGames(ctx, years),
  player_game_stats: (ctx, years) => p.loadPlayerGameStats(ctx, years),
  player_season_stats: (ctx, years) => p.loadPlayerSeasonStats(ctx, years),
  team_game_stats: (ctx, years) => p.loadTeamGameStats(ctx, years),
  scoring_plays: (ctx, years) => p.loadScoringPlays(ctx, years),
  draft_picks: (ctx) => p.loadDraftPicks(ctx),
  trades: (ctx) => p.loadTrades(ctx),
  injuries: (ctx, years) => p.loadInjuries(ctx, years),
  depth_charts: (ctx, years) => p.loadDepthCharts(ctx, years),
  snap_counts: (ctx, years) => p.loadSnapCounts(ctx, years),
};

const OPTIONS = {
  "from-year": { type: "string" },
  "to-year": { type: "string" },
  season: { type: "string" },
  dataset: { type: "string" },
  only: { type: "string", multiple: true },
  force: { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
  "no-cache": { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

// ---- season range resolution ----

function intOr(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && Number.isInteger(n) ? n : fallback;
}

/** Resolve the requested inclusive season range; defaults to 1999..current. */
function resolveRange(values: Values): { from: number; to: number } {
  const from = intOr(values["from-year"], CLEAN_FLOOR);
  const to = intOr(values["to-year"], currentSeason());
  return { from, to };
}

function seasonRange(from: number, to: number): number[] {
  if (from > to) return [];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// ---- run tracking (ingestion_runs + source_state) ----

async function startRun(ctx: Ctx, dataset: string, season: number | null): Promise<number> {
  const res = await ctx.pool.query(
    `INSERT INTO ingestion_runs (source, dataset, season, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [SOURCE, dataset, season],
  );
  return Number(res.rows[0]!.id);
}

async function finishRun(
  ctx: Ctx,
  id: number,
  status: "success" | "error",
  rowCount: number | null,
  error: string | null,
): Promise<void> {
  await ctx.pool.query(
    `UPDATE ingestion_runs
     SET status = $2, row_count = $3, finished_at = now(), error = $4
     WHERE id = $1`,
    [id, status, rowCount, error],
  );
}

async function markSource(
  ctx: Ctx,
  dataset: string,
  season: number | null,
  rowCount: number,
): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO source_state (source, dataset, season, last_success_at, row_count)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (source, dataset, season)
     DO UPDATE SET last_success_at = now(), row_count = EXCLUDED.row_count`,
    [SOURCE, dataset, season ?? SINGLE_SEASON, rowCount],
  );
}

/** source_state keys of (dataset, season) pairs already loaded — the resume
 * skip-set. Empty if the table doesn't exist yet. */
async function loadDoneSet(): Promise<Set<string>> {
  const done = new Set<string>();
  if (!config.databaseUrl) return done;
  try {
    const res = await pool().query(
      `SELECT dataset, season FROM source_state WHERE source = $1`,
      [SOURCE],
    );
    for (const row of res.rows) done.add(stateKey(String(row.dataset), Number(row.season)));
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
  }
  return done;
}

// ---- plan execution ----

function label(dataset: string, season: number | null): string {
  return season == null ? dataset : `${dataset} ${season}`;
}

async function runPlan(
  ctx: Ctx,
  plan: PlannedRun[],
  baseYears: number[],
): Promise<{ ok: number; failed: string[] }> {
  const failed: string[] = [];
  let ok = 0;
  for (const { dataset, season } of plan) {
    const runner = RUNNERS[dataset];
    if (!runner) {
      logger.error({ dataset }, "no runner for dataset — skipping");
      failed.push(stateKey(dataset, season));
      continue;
    }
    const years = season == null ? baseYears : [season];
    const started = Date.now();
    let runId: number | undefined;
    if (!ctx.dryRun) runId = await startRun(ctx, dataset, season);
    try {
      const n = await runner(ctx, years);
      if (!ctx.dryRun && runId != null) {
        await finishRun(ctx, runId, "success", n, null);
        await markSource(ctx, dataset, season, n);
      }
      ok++;
      logger.info(
        { dataset, season, rows: n, ms: Date.now() - started, dryRun: ctx.dryRun },
        `${label(dataset, season)}: ${ctx.dryRun ? "would upsert" : "upserted"} ${n} rows`,
      );
    } catch (err) {
      failed.push(stateKey(dataset, season));
      if (!ctx.dryRun && runId != null) await finishRun(ctx, runId, "error", null, String(err));
      logger.error({ dataset, season, err }, `${label(dataset, season)}: FAILED — continuing`);
    }
  }
  return { ok, failed };
}

async function executePlan(plan: PlannedRun[], from: number, to: number, values: Values): Promise<number> {
  setCachePolicy({ noCache: Boolean(values["no-cache"]) });
  const dryRun = Boolean(values["dry-run"]);
  if (!config.databaseUrl && !dryRun) {
    logger.error("DATABASE_URL is required (use --dry-run to validate without a database)");
    return 2;
  }
  if (plan.length === 0) {
    logger.info("nothing to do — every requested (dataset, season) is already loaded");
    return 0;
  }
  const ctx = new Ctx(pool(), dryRun, null);
  logger.info({ runs: plan.length, range: `${from}-${to}`, dryRun }, "worker starting");
  const { ok, failed } = await runPlan(ctx, plan, seasonRange(Math.max(from, CLEAN_FLOOR), to));

  if (ctx.skipped.size > 0) {
    logger.info({ skipped: Object.fromEntries(ctx.skipped) }, "skipped rows by reason");
  }
  if (failed.length > 0) {
    logger.error({ ok, failed }, `worker finished with ${failed.length} failed run(s)`);
    return 1;
  }
  logger.info({ ok }, "worker complete");
  return 0;
}

// ---- subcommands ----

function parse(rest: string[]): Values {
  return parseArgs({ args: rest, options: OPTIONS, allowPositionals: true }).values;
}

async function ingestAll(rest: string[]): Promise<number> {
  const values = parse(rest);
  const { from, to } = resolveRange(values);
  return executePlan(planRuns(DATASETS, from, to), from, to, values);
}

async function ingestDataset(rest: string[]): Promise<number> {
  const values = parse(rest);
  if (!values.dataset) {
    logger.error({ known: datasetNames() }, "ingest:dataset requires --dataset <name>");
    return 2;
  }
  const meta = getDataset(values.dataset);
  if (!meta) {
    logger.error({ dataset: values.dataset, known: datasetNames() }, "unknown dataset");
    return 2;
  }
  // --season pins a single year; otherwise the dataset's full clamped range.
  let { from, to } = resolveRange(values);
  if (values.season !== undefined) {
    const y = Number(values.season);
    if (!Number.isInteger(y)) {
      logger.error({ season: values.season }, "--season must be an integer");
      return 2;
    }
    from = to = y;
  }
  return executePlan(planRuns([meta], from, to), from, to, values);
}

async function backfill(rest: string[]): Promise<number> {
  const values = parse(rest);
  const { from, to } = resolveRange(values);
  let metas: readonly DatasetMeta[] = DATASETS;
  if (values.only && values.only.length > 0) {
    const unknown = values.only.filter((n) => !getDataset(n));
    if (unknown.length > 0) {
      logger.error({ unknown, known: datasetNames() }, "--only lists unknown dataset(s)");
      return 2;
    }
    const wanted = new Set(values.only);
    metas = DATASETS.filter((d) => wanted.has(d.name));
  }
  return executePlan(planRuns(metas, from, to), from, to, values);
}

async function resume(rest: string[]): Promise<number> {
  const values = parse(rest);
  const { from, to } = resolveRange(values);
  const done = await loadDoneSet();
  const plan = planRuns(DATASETS, from, to, done, Boolean(values.force));
  logger.info(
    { alreadyDone: done.size, pending: plan.length, force: Boolean(values.force) },
    "resume plan",
  );
  return executePlan(plan, from, to, values);
}

// ---- verify: FK integrity + row-count sanity + season-gap detection ----

const VERIFY_HELP = `worker verify — data integrity checks (exit nonzero on failure)

  Checks:
    - FK integrity: orphan rows in injuries / depth_charts / snap_counts /
      player_ids / trades that point at a missing player or game.
    - Row-count sanity: warns on core tables that are unexpectedly empty.
    - Season gaps: missing seasons within each per-season dataset's loaded range
      (from source_state).

  Usage: pnpm worker verify [--help]`;

async function countOrphans(problems: string[], label: string, sql: string): Promise<void> {
  try {
    const res = await pool().query(sql);
    const n = Number(res.rows[0]?.n ?? 0);
    if (n > 0) problems.push(`FK: ${label} — ${n} orphan row(s)`);
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") {
      logger.debug({ label }, "verify: table absent, skipping check");
      return;
    }
    throw err;
  }
}

async function checkSeasonGaps(problems: string[]): Promise<void> {
  try {
    const res = await pool().query(
      `SELECT dataset, array_agg(season ORDER BY season) AS seasons
       FROM source_state WHERE season <> $1 GROUP BY dataset`,
      [SINGLE_SEASON],
    );
    for (const row of res.rows) {
      const seasons: number[] = (row.seasons as number[]).map(Number);
      if (seasons.length < 2) continue;
      const present = new Set(seasons);
      const min = seasons[0]!;
      const max = seasons[seasons.length - 1]!;
      const missing: number[] = [];
      for (let y = min; y <= max; y++) if (!present.has(y)) missing.push(y);
      if (missing.length > 0) {
        problems.push(`gap: ${row.dataset} missing season(s) ${missing.join(", ")}`);
      }
    }
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return;
    throw err;
  }
}

async function checkRowCounts(problems: string[]): Promise<void> {
  // Empty core tables are a warning (a fresh DB legitimately has none), but a
  // table whose source_state records a nonzero load yet is empty is a failure.
  const tables = ["players", "player_ids", "games", "trades", "injuries", "depth_charts", "snap_counts"];
  for (const table of tables) {
    try {
      const res = await pool().query(`SELECT count(*)::int AS n FROM ${table}`);
      const n = Number(res.rows[0]?.n ?? 0);
      if (n === 0) {
        logger.warn({ table }, "verify: table is empty");
        const st = await pool().query(
          `SELECT coalesce(sum(row_count), 0)::int AS loaded FROM source_state WHERE dataset = $1`,
          [table],
        );
        if (Number(st.rows[0]?.loaded ?? 0) > 0) {
          problems.push(`row-count: ${table} is empty but source_state reports a nonzero load`);
        }
      } else {
        logger.info({ table, rows: n }, "verify: row count");
      }
    } catch (err) {
      if ((err as { code?: string }).code === "42P01") continue;
      throw err;
    }
  }
}

async function verify(rest: string[]): Promise<number> {
  const values = parse(rest);
  if (values.help) {
    logger.info(VERIFY_HELP);
    return 0;
  }
  if (!config.databaseUrl) {
    logger.error("verify requires DATABASE_URL");
    return 2;
  }
  const problems: string[] = [];

  await countOrphans(problems, "injuries.player_id -> players",
    `SELECT count(*)::int AS n FROM injuries i
     LEFT JOIN players pl USING (player_id) WHERE pl.player_id IS NULL`);
  await countOrphans(problems, "depth_charts.player_id -> players",
    `SELECT count(*)::int AS n FROM depth_charts d
     LEFT JOIN players pl USING (player_id) WHERE pl.player_id IS NULL`);
  await countOrphans(problems, "player_ids.player_id -> players",
    `SELECT count(*)::int AS n FROM player_ids x
     LEFT JOIN players pl USING (player_id) WHERE pl.player_id IS NULL`);
  await countOrphans(problems, "snap_counts.game_id -> games",
    `SELECT count(*)::int AS n FROM snap_counts s
     LEFT JOIN games g USING (game_id) WHERE g.game_id IS NULL`);
  await countOrphans(problems, "snap_counts.player_id -> players",
    `SELECT count(*)::int AS n FROM snap_counts s
     LEFT JOIN players pl ON s.player_id = pl.player_id
     WHERE s.player_id IS NOT NULL AND pl.player_id IS NULL`);
  await countOrphans(problems, "trades.player_id -> players",
    `SELECT count(*)::int AS n FROM trades t
     LEFT JOIN players pl ON t.player_id = pl.player_id
     WHERE t.player_id IS NOT NULL AND pl.player_id IS NULL`);

  await checkRowCounts(problems);
  await checkSeasonGaps(problems);

  if (problems.length > 0) {
    logger.error({ problems }, `verify FAILED — ${problems.length} problem(s)`);
    return 1;
  }
  logger.info("verify passed — no FK orphans, row counts sane, no season gaps");
  return 0;
}

function usage(): void {
  logger.info(
    `pnpm worker <command>

  ingest:all       run every dataset for the resolved seasons (default ${CLEAN_FLOOR}..current)
  ingest:dataset   one dataset (--dataset <name> [--season <y>])
  backfill         a season range (--from-year <y> --to-year <y> [--only <name...>])
  resume           skip (dataset, season) pairs already in source_state (--force to re-run)
  verify           FK integrity + row-count sanity + season-gap detection

  Common flags: --from-year --to-year --dry-run --no-cache
  Datasets: ${datasetNames().join(", ")}`,
  );
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "ingest:all":
      return ingestAll(rest);
    case "ingest:dataset":
      return ingestDataset(rest);
    case "backfill":
      return backfill(rest);
    case "resume":
      return resume(rest);
    case "verify":
      return verify(rest);
    case "--help":
    case "-h":
      usage();
      return 0;
    case undefined:
      usage();
      return 2;
    default:
      logger.error({ command }, "unknown worker command");
      usage();
      return 2;
  }
}

if (process.argv[1]?.endsWith("worker/cli.ts") || process.argv[1]?.endsWith("worker/cli.js")) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .finally(() => closePools());
}
