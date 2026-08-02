/** The miner: runs every registered probe, derives claims, scores them, and
 * upserts the survivors into stat_facts.
 *
 * Deterministic end to end — no model is involved at run time. The only thing
 * an LLM ever contributes is the probe source itself, written at design time,
 * reviewed in a pull request and pinned by a golden test.
 *
 * Per-probe failure isolation mirrors the ingest: one broken probe is logged
 * and skipped, the rest of the run continues.
 */

import { createHash } from "node:crypto";
import { Params, statComputableFor } from "../engine/executors/shared.js";
import { STATS } from "../engine/spec.js";
import { q, pool } from "../db/pool.js";
import { logger } from "../lib/logger.js";
import { assertNoUnsupportedYear } from "./claim.js";
import { PROBES } from "./registry.js";
import { dedupe, surprise } from "./score.js";
import type {
  Claim, FactCandidate, FactProbe, MineContext, OccurrenceRow, ProbeVariant, SourceDataset,
} from "./types.js";

/** Earliest season each source dataset actually holds, read from the warehouse
 * rather than hardcoded. A backfill therefore widens what probes may claim,
 * and a dataset that failed to load tightens it — in both cases automatically,
 * which is the only way this stays correct over time. */
async function floorsFor(): Promise<Record<SourceDataset, number>> {
  const rows = await q<{ source: string; floor: number | null }>(
    `SELECT 'player_game_stats' AS source,
            (SELECT MIN(g.season) FROM player_game_stats s JOIN games g ON g.game_id = s.game_id) AS floor
     UNION ALL SELECT 'player_season_stats', (SELECT MIN(season) FROM player_season_stats)
     UNION ALL SELECT 'team_game_stats',
            (SELECT MIN(g.season) FROM team_game_stats t JOIN games g ON g.game_id = t.game_id)
     UNION ALL SELECT 'scoring_plays',
            (SELECT MIN(g.season) FROM scoring_plays sp JOIN games g ON g.game_id = sp.game_id)`,
  );
  const out = {} as Record<SourceDataset, number>;
  for (const r of rows) {
    // A dataset with no rows gets an impossibly high floor, so any probe over
    // it produces no claim at all rather than an unbounded one.
    out[r.source as SourceDataset] = r.floor ?? Number.MAX_SAFE_INTEGER;
  }
  return out;
}

/** A probe's coverage floor is the LATEST of its sources' floors: it can only
 * see as far back as its most recently-starting input. */
export function coverageFloor(probe: FactProbe, floors: Record<SourceDataset, number>): number {
  return Math.max(...probe.sources.map((s) => floors[s] ?? Number.MAX_SAFE_INTEGER));
}

/** Stable id: same probe + variant + subject + when => same row, so re-mining
 * a week updates in place instead of duplicating. */
export function factId(
  probeId: string, variantKey: string, subjectId: string, season: number, week: number | null,
): string {
  return createHash("sha1")
    .update([probeId, variantKey, subjectId, season, week ?? "-"].join("|"))
    .digest("hex")
    .slice(0, 24);
}

/** Guard: a variant may only name a stat the query engine can compute at the
 * grain the probe reads. Keeps a typo'd or advanced-table stat from becoming
 * SQL that references a column the table doesn't have. */
function assertVariantComputable(probe: FactProbe, v: ProbeVariant): void {
  // Team probes carry their own local column allowlist, not the STATS one.
  if (probe.sources.includes("team_game_stats")) return;
  const intent = probe.sources.includes("player_season_stats") ? "qualifying_count" : "single_game";
  for (const stat of [v.stat, v.stat2].filter(Boolean) as string[]) {
    if (!STATS[stat]) {
      throw new Error(`probe ${probe.id}/${v.key}: unknown stat "${stat}"`);
    }
    if (!statComputableFor(intent, stat)) {
      throw new Error(
        `probe ${probe.id}/${v.key}: stat "${stat}" is not computable at this probe's grain`,
      );
    }
  }
}

/** Turn one variant's occurrence list into at most one fact. */
export function claimFrom(rows: OccurrenceRow[], floor: number): Claim | null {
  if (rows.length === 0) return null;
  const subject = rows[0]!;
  // Everything that happened in the same season+week shares the honour.
  const coHolders = rows
    .slice(1)
    .filter((r) => r.season === subject.season && r.week === subject.week);
  const prior = rows.slice(1).find((r) => !(r.season === subject.season && r.week === subject.week));
  return {
    population: rows.length,
    priorSeason: prior?.season ?? null,
    coverageFloor: floor,
    coHolders,
  };
}

export interface MineOptions {
  /** Only publish events at or after this season. Defaults to the latest. */
  sinceSeason?: number;
  /** Restrict the run to one probe id. */
  onlyProbe?: string;
  /** Compute and score, write nothing. */
  dryRun?: boolean;
}

export interface MineResult {
  candidates: FactCandidate[];
  skipped: { probe: string; variant: string; reason: string }[];
  failures: string[];
}

export async function mine(opts: MineOptions = {}): Promise<MineResult> {
  const floors = await floorsFor();
  const latestRows = await q<{ latest: number | null }>("SELECT MAX(season) AS latest FROM seasons");
  const latestSeason = latestRows[0]?.latest ?? 0;
  const ctx: MineContext = {
    floors,
    latestSeason,
    sinceSeason: opts.sinceSeason ?? latestSeason,
  };

  const probes = opts.onlyProbe ? PROBES.filter((p) => p.id === opts.onlyProbe) : PROBES;
  if (opts.onlyProbe && probes.length === 0) {
    throw new Error(`unknown probe "${opts.onlyProbe}"`);
  }

  const candidates: FactCandidate[] = [];
  const skipped: MineResult["skipped"] = [];
  const failures: string[] = [];

  for (const probe of probes) {
    const floor = coverageFloor(probe, floors);
    for (const variant of probe.variants) {
      try {
        assertVariantComputable(probe, variant);
        const p = new Params();
        const sql = probe.sql(variant, p);
        const rows = await q<OccurrenceRow>(sql, p.values);

        if (rows.length > probe.maxPopulation) {
          skipped.push({
            probe: probe.id, variant: variant.key,
            reason: `not rare enough (>${probe.maxPopulation} occurrences)`,
          });
          continue;
        }
        const claim = claimFrom(rows, floor);
        if (!claim) {
          skipped.push({ probe: probe.id, variant: variant.key, reason: "no occurrences" });
          continue;
        }
        const subject = rows[0]!;
        if (subject.season < ctx.sinceSeason) {
          skipped.push({
            probe: probe.id, variant: variant.key,
            reason: `latest occurrence (${subject.season}) predates --since ${ctx.sinceSeason}`,
          });
          continue;
        }

        const headline = probe.headline(subject, claim, variant);
        // The guard that makes this safe to publish: refuse a headline naming
        // a season the probe could not have seen.
        assertNoUnsupportedYear(headline, floor);

        const seasonType = String(subject.season_type ?? "REG");
        const base = {
          probe_id: probe.id,
          family: probe.family,
          subject_kind: (probe.sources.includes("team_game_stats") ? "team" : "player") as
            "player" | "team",
          subject_id: subject.subject_id,
          subject_name: subject.subject_name,
          season: subject.season,
          week: subject.week,
          season_type: seasonType,
          headline,
          metric: variant.stat,
          value: Number(subject.value),
          population: claim.population,
          prior_season: claim.priorSeason,
          coverage_floor: floor,
          sql,
          evidence: rows.slice(0, 10),
          question: probe.question?.(subject, variant) ?? null,
        };
        const seasonsOfRecord = Math.max(1, latestSeason - floor + 1);
        const scored = surprise(base, {
          seasonsOfRecord,
          latestSeason,
          threshold: variant.threshold,
        });
        candidates.push({
          ...base,
          ...scored,
          fact_id: factId(probe.id, variant.key, subject.subject_id, subject.season, subject.week),
        });
      } catch (err) {
        failures.push(`${probe.id}/${variant.key}`);
        logger.error(
          { probe: probe.id, variant: variant.key, err: String(err) },
          "probe failed — continuing with the rest",
        );
      }
    }
  }

  const deduped = dedupe(candidates);
  if (!opts.dryRun) await persist(deduped);
  return { candidates: deduped, skipped, failures };
}

const COLS = [
  "fact_id", "probe_id", "family", "subject_kind", "subject_id", "subject_name",
  "season", "week", "season_type", "headline", "metric", "value", "population",
  "prior_season", "coverage_floor", "rarity", "surprise", "sql", "evidence", "question",
];

async function persist(facts: FactCandidate[]): Promise<void> {
  if (facts.length === 0) return;
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    for (const f of facts) {
      const values = COLS.map((c) => {
        const v = (f as unknown as Record<string, unknown>)[c];
        return c === "evidence" ? JSON.stringify(v) : v;
      });
      await client.query(
        `INSERT INTO stat_facts (${COLS.join(", ")})
         VALUES (${COLS.map((_, i) => `$${i + 1}`).join(", ")})
         ON CONFLICT (fact_id) DO UPDATE SET ${COLS.filter((c) => c !== "fact_id")
           .map((c) => `${c} = EXCLUDED.${c}`)
           .join(", ")}, computed_at = now()`,
        values,
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
