/** Phrasing rules and the coverage-floor guard.
 *
 * This is the file that keeps the fact of the day from becoming the thing it
 * would otherwise obviously become: a confident sentence about 1972 written by
 * a warehouse that starts in 1999.
 *
 * The rule, enforced twice — once by giving probes a phrase builder that
 * cannot say more than the data supports, and once by a post-hoc scan of the
 * rendered headline (assertNoUnsupportedYear), because a probe author can
 * always hand-write a year by mistake.
 */

import type { Claim, OccurrenceRow } from "./types.js";

const ORDINALS = [
  "", "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
  "eighth", "ninth", "tenth",
];

/** "first", "second", ... "11th". Words up to ten, digits past it — the way a
 * broadcast graphic reads it. */
export function ordinal(n: number): string {
  if (n >= 1 && n < ORDINALS.length) return ORDINALS[n]!;
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** How far back the claim can honestly reach.
 *
 *   prior > floor        -> "since 2007"           (we saw the previous one)
 *   prior == null/floor  -> "since 1999, the earliest season on record here"
 *
 * The second branch is the whole point. When the event has never happened
 * inside the warehouse, or last happened in the very first season we hold, the
 * true statement is about OUR RECORD, not about NFL history. Saying "the first
 * ever" there would be a wrong number dressed as a superlative. */
export function sinceClause(claim: Claim): string {
  const { priorSeason, coverageFloor } = claim;
  if (priorSeason !== null && priorSeason > coverageFloor) return `since ${priorSeason}`;
  return `since ${coverageFloor}, the earliest season on record here`;
}

/** Co-holders make "the first" wrong. "Josh Allen and Lamar Jackson are the
 * first players to..." — the probe gets the list so its template can name them
 * rather than silently crowning whichever row sorted first. */
export function subjectPhrase(subject: OccurrenceRow, claim: Claim): string {
  if (claim.coHolders.length === 0) return subject.subject_name;
  const names = [subject.subject_name, ...claim.coHolders.map((r) => r.subject_name)];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Post-hoc guard: refuse a headline that names a season the probe could not
 * have seen. Catches a hand-written year in a template, which the phrase
 * builders above cannot.
 *
 * Deliberately a throw, not a warning. A fact that overstates its own evidence
 * is exactly the failure this product cannot ship, and the miner catches it
 * per-probe so one bad template can't take down a run. */
export function assertNoUnsupportedYear(headline: string, coverageFloor: number): void {
  for (const match of headline.matchAll(/\b(19|20)\d{2}\b/g)) {
    const year = Number(match[0]);
    if (year < coverageFloor) {
      throw new Error(
        `headline claims ${year} but the probe's coverage floor is ${coverageFloor}: ` +
          `"${headline}". Use sinceClause() rather than writing a year into the template.`,
      );
    }
  }
}

/** Season label for a week within a season ("Week 4 of 2025", "the 2025
 * playoffs"). Weeks are meaningless for season-grain probes, hence null. */
export function whenPhrase(
  season: number,
  week: number | null,
  seasonType: string,
): string {
  if (week === null) return `${season}`;
  if (seasonType === "POST") return `the ${season} playoffs`;
  return `Week ${week} of ${season}`;
}
