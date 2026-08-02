/** Fact-mining CLI.
 *
 *    pnpm facts:mine --dry-run              # score and print, write nothing
 *    pnpm facts:mine                        # mine + upsert stat_facts
 *    pnpm facts:mine --probe game_streak    # one probe, for authoring
 *    pnpm facts:mine --since 2024           # widen what counts as "news"
 *    pnpm facts:mine --list                 # the registry, no database needed
 *    pnpm facts:select                      # publish today's fact of the day
 *    pnpm facts:select --day 2026-08-02
 *
 * The dry run is the review surface: it prints each candidate with its
 * headline, population, coverage floor and evidence count, so a probe's output
 * can be judged before any of it reaches a table.
 */

import { parseArgs } from "node:util";
import { closePools } from "../db/pool.js";
import { logger } from "../lib/logger.js";
import { mine } from "./mine.js";
import { PROBES } from "./registry.js";
import { selectForDay } from "./select.js";

/** Today in UTC as YYYY-MM-DD — the cron runs in UTC and the day key must
 * match whatever the scheduled job computed. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      probe: { type: "string" },
      since: { type: "string" },
      day: { type: "string" },
      list: { type: "boolean", default: false },
      limit: { type: "string" },
    },
  });

  if (values.list) {
    for (const p of PROBES) {
      logger.info(
        { probe: p.id, family: p.family, variants: p.variants.length, sources: p.sources },
        `${p.id}: ${p.title}`,
      );
    }
    return 0;
  }

  const command = positionals[0] ?? "mine";

  if (command === "select") {
    const day = values.day ?? today();
    const fact = await selectForDay(day);
    if (!fact) {
      logger.warn({ day }, "no fact available to publish — is stat_facts empty?");
      return 1;
    }
    logger.info({ day, fact_id: fact.fact_id, surprise: fact.surprise }, fact.headline);
    return 0;
  }

  if (command !== "mine") {
    logger.error({ command }, "unknown command (expected 'mine' or 'select')");
    return 2;
  }

  const since = values.since ? Number(values.since) : undefined;
  if (values.since && !Number.isInteger(since)) {
    logger.error("--since must be a season year");
    return 2;
  }

  const result = await mine({
    dryRun: values["dry-run"],
    onlyProbe: values.probe,
    sinceSeason: since,
  });

  const limit = values.limit ? Number(values.limit) : 25;
  for (const c of result.candidates.slice(0, limit)) {
    logger.info(
      {
        surprise: c.surprise,
        probe: c.probe_id,
        population: c.population,
        prior: c.prior_season,
        floor: c.coverage_floor,
        evidence: c.evidence.length,
      },
      c.headline,
    );
  }

  // Silent truncation would read as "nothing else qualified"; say what was cut.
  if (result.candidates.length > limit) {
    logger.info(
      { shown: limit, total: result.candidates.length },
      `${result.candidates.length - limit} further candidates not shown (--limit)`,
    );
  }
  if (result.skipped.length > 0) {
    logger.info({ skipped: result.skipped.length }, "variants that produced no fact");
    for (const s of result.skipped) {
      logger.debug({ ...s }, `${s.probe}/${s.variant}: ${s.reason}`);
    }
  }

  // An empty backlog in the offseason is expected; an empty one in October is
  // a broken probe registry. Say so rather than exiting quietly green.
  if (result.candidates.length === 0) {
    logger.warn("no candidates produced — check --since and that the warehouse is loaded");
  }
  if (result.failures.length > 0) {
    logger.error({ failures: result.failures }, "some probes failed");
    return 1;
  }
  logger.info(
    { candidates: result.candidates.length, dryRun: values["dry-run"] },
    values["dry-run"] ? "dry run complete (nothing written)" : "mining complete",
  );
  return 0;
}

if (process.argv[1]?.endsWith("facts/cli.ts") || process.argv[1]?.endsWith("facts/cli.js")) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      logger.error({ err: String(err) }, "fact mining failed");
      process.exitCode = 1;
    })
    .finally(() => closePools());
}
