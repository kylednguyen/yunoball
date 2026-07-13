/** Ingestion CLI.
 *
 *    pnpm ingest:nfl --season 2024               # one season (--years works too)
 *    pnpm ingest:nfl --years 2022 2023 2024      # specific seasons
 *    pnpm ingest:nfl --all                       # every season since 1999
 *    pnpm ingest:nfl --season 2024 --dry-run     # validate + count, write nothing
 *    pnpm ingest:nfl --season 2024 --season-type REG
 *
 * Loads dimensions then facts, in dependency order. A failing dataset is
 * logged and the run continues with the datasets that don't depend on it.
 * Every skipped row is logged with a reason and summarized at the end.
 */

import { parseArgs } from "node:util";
import { config } from "../config.js";
import { pool, closePools } from "../db/pool.js";
import { logger } from "../lib/logger.js";
import { Ctx } from "./context.js";
import * as p from "./pipelines.js";

// nflverse player-stat coverage starts in 1999.
const FIRST_SEASON = 1999;

const STEPS = [
  "teams", "seasons", "players", "games", "player_game_stats",
  "player_season_stats", "team_game_stats", "scoring_plays", "draft_picks",
] as const;
type Step = (typeof STEPS)[number];

function allSeasons(): number[] {
  // Through the season that has started by today (NFL season year = its Sept).
  const today = new Date();
  const last = today.getMonth() + 1 >= 9 ? today.getFullYear() : today.getFullYear() - 1;
  return Array.from({ length: last - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    // Allow bare year positionals so the documented `--years 2022 2023 2024`
    // (and `ingest:nfl 2023 2024`) work — node's parseArgs otherwise treats
    // every value after the first as an unexpected positional.
    allowPositionals: true,
    options: {
      years: { type: "string", multiple: true },
      season: { type: "string", multiple: true },
      all: { type: "boolean", default: false },
      only: { type: "string", multiple: true },
      skip: { type: "string", multiple: true, default: [] },
      "season-type": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const yearArgs = [
    ...(values.years ?? []),
    ...(values.season ?? []),
    ...positionals,
  ].map(Number);
  if (!values.all && yearArgs.length === 0) {
    logger.error("specify --season <year>, --years <y...>, or --all");
    return 2;
  }
  if (yearArgs.some((y) => !Number.isInteger(y))) {
    logger.error({ yearArgs }, "seasons must be integers");
    return 2;
  }
  const seasonType = values["season-type"];
  if (seasonType && !["REG", "POST"].includes(seasonType)) {
    logger.error("--season-type must be REG or POST");
    return 2;
  }
  for (const step of [...(values.only ?? []), ...(values.skip ?? [])]) {
    if (!STEPS.includes(step as Step)) {
      logger.error({ step, known: STEPS }, "unknown pipeline");
      return 2;
    }
  }

  const years = values.all ? allSeasons() : [...new Set(yearArgs)].sort();
  if (!config.databaseUrl && !values["dry-run"]) {
    logger.error("DATABASE_URL is required (dry runs work without one only for validation)");
    return 2;
  }

  const ctx = new Ctx(pool(), values["dry-run"], seasonType ?? null);
  logger.info(
    { seasons: `${years[0]}–${years.at(-1)}`, count: years.length, dryRun: ctx.dryRun },
    "ingest starting",
  );

  const registry: Record<Step, () => Promise<number>> = {
    teams: () => p.loadTeams(ctx),
    seasons: () => p.loadSeasons(ctx, years),
    players: () => p.loadPlayers(ctx, years),
    games: () => p.loadGames(ctx, years),
    player_game_stats: () => p.loadPlayerGameStats(ctx, years),
    player_season_stats: () => p.loadPlayerSeasonStats(ctx, years),
    team_game_stats: () => p.loadTeamGameStats(ctx, years),
    scoring_plays: () => p.loadScoringPlays(ctx, years),
    draft_picks: () => p.loadDraftPicks(ctx),
  };

  const selected = new Set<Step>((values.only as Step[] | undefined) ?? [...STEPS]);
  for (const s of (values.skip as Step[]) ?? []) selected.delete(s);

  const failures: string[] = [];
  for (const step of STEPS) { // dependency order
    if (!selected.has(step)) continue;
    const started = Date.now();
    try {
      const count = await registry[step]();
      logger.info(
        { step, rows: count, ms: Date.now() - started, dryRun: ctx.dryRun },
        `${step}: ${ctx.dryRun ? "would upsert" : "upserted"} ${count} rows`,
      );
    } catch (err) {
      // Failure isolation: later datasets that don't depend on this one still run.
      failures.push(step);
      logger.error({ step, err }, `${step}: FAILED — continuing with remaining datasets`);
    }
  }

  if (ctx.skipped.size > 0) {
    logger.info(
      { skipped: Object.fromEntries(ctx.skipped) },
      "skipped rows by reason (see warnings above for samples)",
    );
  } else {
    logger.info("no rows skipped");
  }
  if (failures.length > 0) {
    logger.error({ failures }, "ingest finished with failures");
    return 1;
  }
  logger.info("ingest complete");
  return 0;
}

if (process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .finally(() => closePools());
}
