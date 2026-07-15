/** NFLverse data provider — release-file CSVs, cached on disk, fetched with
 * retries. Additional providers (ESPN, SportsDataIO, live scoring, ...) get
 * their own module here; pipelines consume plain row streams, so the public
 * API never changes when a provider is added. */

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { parse } from "csv-parse";
import { logger } from "../../lib/logger.js";

const RELEASES = "https://github.com/nflverse/nflverse-data/releases/download";

export const assets = {
  teams: () => `${RELEASES}/teams/teams_colors_logos.csv`,
  schedules: () => `${RELEASES}/schedules/games.csv`, // all seasons, one file
  rosters: (year: number) => `${RELEASES}/rosters/roster_${year}.csv`,
  weeklyStats: (year: number) => `${RELEASES}/stats_player/stats_player_week_${year}.csv`,
  seasonStats: (year: number, level: "reg" | "post") =>
    `${RELEASES}/stats_player/stats_player_${level}_${year}.csv`,
  pbp: (year: number) => `${RELEASES}/pbp/play_by_play_${year}.csv.gz`,
  draftPicks: () => `${RELEASES}/draft_picks/draft_picks.csv`, // all drafts, one file
  // P0 datasets. players/trades are single all-history files; the rest are
  // per-season (like weeklyStats). Season floors (injuries 2009, depth 2001,
  // snaps 2012, trades 2010) are enforced by the worker, not here.
  players: () => `${RELEASES}/players/players.csv`, // all-time master + id crosswalk
  trades: () => `${RELEASES}/trades/trades.csv`, // all trades (2002+), one file
  injuries: (year: number) => `${RELEASES}/injuries/injuries_${year}.csv`,
  depthCharts: (year: number) => `${RELEASES}/depth_charts/depth_charts_${year}.csv`,
  snapCounts: (year: number) => `${RELEASES}/snap_counts/snap_counts_${year}.csv`,
};

const CACHE_DIR =
  process.env.INGEST_CACHE_DIR ?? path.join(os.homedir(), ".cache", "yunoball-ingest");

const RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// nflverse republishes current-season assets throughout the season (new weeks,
// stat corrections), so the disk cache can serve stale data on an in-season
// re-ingest. `--no-cache` forces a fresh fetch; historical seasons are
// immutable, so the default cache-reuse stays correct for them.
let forceRefresh = false;
export function setCachePolicy(opts: { noCache?: boolean }): void {
  forceRefresh = Boolean(opts.noCache);
}

/** Download to the on-disk cache (reused across runs) with retry + backoff. */
async function download(url: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const dest = path.join(CACHE_DIR, path.basename(url));
  if (!forceRefresh && existsSync(dest) && statSync(dest).size > 0) return dest;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      logger.info({ url, attempt }, "fetching dataset");
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
      const tmp = `${dest}.part`;
      await streamPipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
      await rename(tmp, dest);
      return dest;
    } catch (err) {
      lastErr = err;
      await unlink(`${dest}.part`).catch(() => {});
      if (attempt < RETRIES) {
        const backoff = 1000 * 4 ** (attempt - 1);
        logger.warn({ url, attempt, err: String(err) }, `fetch failed; retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }
  throw new Error(`download failed after ${RETRIES} attempts: ${url} (${String(lastErr)})`);
}

export type CsvRow = Record<string, string>;

/** Stream rows of a (possibly gzipped) CSV release asset. */
export async function* rows(url: string): AsyncGenerator<CsvRow> {
  const file = await download(url);
  const source = createReadStream(file);
  const parser = parse({ columns: true, bom: true, relax_column_count: true });
  const stream = file.endsWith(".gz")
    ? source.pipe(createGunzip()).pipe(parser)
    : source.pipe(parser);
  for await (const row of stream) {
    yield row as CsvRow;
  }
}

/** Collect a whole asset into memory (the release files are a few MB each). */
export async function allRows(url: string): Promise<CsvRow[]> {
  const out: CsvRow[] = [];
  for await (const r of rows(url)) out.push(r);
  return out;
}
