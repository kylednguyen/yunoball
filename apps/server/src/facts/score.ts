/** Surprise scoring — what makes a true statement worth publishing.
 *
 * Every candidate reaching this point is already true and already rare enough
 * to have survived the probe's population cap. Scoring decides which of a few
 * hundred true things leads the day.
 *
 * Four terms, weighted by how much each one actually moves a reader:
 *
 *   rarity     how often the event happens per season of record. The dominant
 *              term: "third time ever" beats everything else.
 *   drought    how long since the previous occurrence. A common event that
 *              hasn't happened in twelve years is news; the same event last
 *              seen in October is not.
 *   recency    whether the subject did it in the season now being played.
 *              An in-season fact is a talking point, an old one is trivia.
 *   roundness  a threshold people count in (100, 200, 400 yards) reads as a
 *              milestone; an odd one reads as a fitted number.
 *
 * The weights are deliberately blunt and checked in as constants rather than
 * tuned: this ranks a backlog, it does not need to be a model.
 */

import type { FactCandidate } from "./types.js";

const W_RARITY = 2.0;
const W_DROUGHT = 1.2;
const W_RECENCY = 0.8;
const W_ROUNDNESS = 0.5;

/** Occurrences per season of record — the rate the rarity term inverts. */
function rarity(population: number, seasonsOfRecord: number): number {
  const perSeason = population / Math.max(1, seasonsOfRecord);
  return Math.log(1 / Math.max(perSeason, 1e-3));
}

/** A threshold a fan would actually count in. Hundreds are milestones, fifties
 * are half-milestones, everything else is a number someone chose. */
export function roundness(threshold: number): number {
  if (threshold % 100 === 0) return 1;
  if (threshold % 50 === 0) return 0.6;
  if (threshold % 10 === 0) return 0.3;
  return 0;
}

export function surprise(
  candidate: Omit<FactCandidate, "surprise" | "rarity" | "fact_id">,
  opts: { seasonsOfRecord: number; latestSeason: number; threshold: number },
): { rarity: number; surprise: number } {
  const r = rarity(candidate.population, opts.seasonsOfRecord);

  // No prior occurrence means the drought is the whole window we can see.
  const drought =
    candidate.prior_season === null
      ? candidate.season - candidate.coverage_floor
      : candidate.season - candidate.prior_season;

  const recency = candidate.season >= opts.latestSeason ? 1 : 0;

  const score =
    W_RARITY * r +
    W_DROUGHT * Math.log(1 + Math.max(0, drought)) +
    W_RECENCY * recency +
    W_ROUNDNESS * roundness(opts.threshold);

  return { rarity: r, surprise: Number(score.toFixed(4)) };
}

/** Near-duplicate suppression. Two probes firing on the same player, same
 * metric family and same week are the same story told twice; keep the more
 * surprising one. Metric family is the stat's first word ("passing_yards" and
 * "passing_tds" are both "passing"), which is coarse on purpose — a reader
 * does not want two passing facts about one quarterback in one day. */
export function dedupeKey(c: Pick<FactCandidate, "subject_id" | "metric" | "season" | "week">): string {
  const family = c.metric.split("_")[0] ?? c.metric;
  return `${c.subject_id}|${family}|${c.season}|${c.week ?? "-"}`;
}

export function dedupe(candidates: FactCandidate[]): FactCandidate[] {
  const best = new Map<string, FactCandidate>();
  for (const c of candidates) {
    const key = dedupeKey(c);
    const current = best.get(key);
    if (!current || c.surprise > current.surprise) best.set(key, c);
  }
  return [...best.values()].sort((a, b) => b.surprise - a.surprise);
}
