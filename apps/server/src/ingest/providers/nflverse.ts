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
  playerIds: () => `${RELEASES}/players/players.csv`, // id crosswalk, one file
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

/** A release asset nflverse has not published. Distinct from a transient
 * failure: a season that hasn't been played yet has no stats file, and 404 is
 * the only way upstream says so. Not retryable — retrying a 404 just costs
 * three round trips before the same answer. */
class AssetNotPublished extends Error {
  constructor(readonly url: string) {
    super(`not published upstream: ${url}`);
    this.name = "AssetNotPublished";
  }
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
      if (res.status === 404) throw new AssetNotPublished(url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
      const tmp = `${dest}.part`;
      await streamPipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
      await rename(tmp, dest);
      return dest;
    } catch (err) {
      lastErr = err;
      await unlink(`${dest}.part`).catch(() => {});
      if (err instanceof AssetNotPublished) throw err;
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

/** Stream rows of a (possibly gzipped) CSV file already on disk. */
async function* rowsOf(file: string): AsyncGenerator<CsvRow> {
  const source = createReadStream(file);
  const parser = parse({ columns: true, bom: true, relax_column_count: true });
  const stream = file.endsWith(".gz")
    ? source.pipe(createGunzip()).pipe(parser)
    : source.pipe(parser);
  for await (const row of stream) {
    yield row as CsvRow;
  }
}

/** rows(), but `null` when the asset isn't published yet. The download has to
 * resolve first so a 404 surfaces here rather than mid-iteration. */
export async function optionalRowStream(url: string): Promise<AsyncGenerator<CsvRow> | null> {
  try {
    return rowsOf(await download(url));
  } catch (err) {
    if (err instanceof AssetNotPublished) {
      logger.warn({ url }, "asset not published upstream yet — skipping");
      return null;
    }
    throw err;
  }
}

/** Collect a whole asset into memory (the release files are a few MB each). */
export async function allRows(url: string): Promise<CsvRow[]> {
  const out: CsvRow[] = [];
  for await (const r of rowsOf(await download(url))) out.push(r);
  return out;
}

/** allRows, but `null` when the asset isn't published yet rather than throwing.
 * Callers that loop over seasons use this so one unplayed season can't take the
 * other twenty-five down with it. */
export async function optionalRows(url: string): Promise<CsvRow[] | null> {
  try {
    return await allRows(url);
  } catch (err) {
    if (err instanceof AssetNotPublished) {
      logger.warn({ url }, "asset not published upstream yet — skipping");
      return null;
    }
    throw err;
  }
}
