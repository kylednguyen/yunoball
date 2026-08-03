/** The probe contract — the one new primitive behind the fact of the day.
 *
 * A probe is a checked-in, reviewed SQL template that returns EVERY occurrence
 * of one rare event, newest first. The miner reads that list and derives the
 * whole claim from it: the newest row is the subject, the row count is the
 * population, and the second row's season is when it last happened. Nothing is
 * generated at run time — the headline comes from the probe's own template.
 *
 * Probes never take free text and never interpolate a value into SQL: stat
 * expressions come from the engine's STATS allowlist and every parameter is
 * bound, exactly as the query engine does it (see engine/executors/shared.ts).
 */

import type { Params } from "../engine/executors/shared.js";

/** The shape of the claim a probe makes. Drives phrasing and scoring. */
type FactFamily =
  | "threshold" // N players ever with X >= T in a game/season
  | "drought" // first to do X since <season>
  | "streak" // consecutive games meeting a predicate
  | "pace" // fewest games / youngest to reach a career total
  | "conjunction" // two thresholds in one game
  | "anti"; // notable absence (most yards with zero touchdowns)

/** Warehouse tables a probe reads. The coverage floor is derived from these at
 * mine time — see floorsFor() in mine.ts. Never hardcode a floor: a probe over
 * a dataset that starts in 2012 may not claim "first since 1999". */
export type SourceDataset =
  | "player_game_stats"
  | "player_season_stats"
  | "team_game_stats"
  | "scoring_plays";

/** One occurrence of the event, as returned by a probe's SQL. */
export interface OccurrenceRow {
  subject_id: string;
  subject_name: string;
  season: number;
  week: number | null;
  value: number;
  [extra: string]: unknown;
}

/** What the miner knows while turning occurrences into facts. */
export interface MineContext {
  /** Earliest season each source dataset actually holds. */
  floors: Record<SourceDataset, number>;
  /** Newest season in the warehouse. */
  latestSeason: number;
  /** Only events at or after this season become facts — a fact is news. */
  sinceSeason: number;
}

/** A probe variant: one parameter set from the curated ladder.
 *
 * Thresholds MUST come from a round-number ladder checked in with the probe,
 * never fitted to the data. A threshold tuned until exactly one player clears
 * it produces a technically true, journalistically worthless fact ("the only
 * player with 217+ receiving yards and 2 touchdowns since 2019"). */
export interface ProbeVariant {
  /** Stable key — part of the fact id, so it must not change casually. */
  key: string;
  /** Stat key from the engine's STATS allowlist. */
  stat: string;
  threshold: number;
  /** Optional second leg for conjunction probes. */
  stat2?: string;
  threshold2?: number;
  /** Optional run length for streak probes. */
  runLength?: number;
}

export interface FactProbe {
  id: string;
  family: FactFamily;
  /** One line describing what this probe looks for; shown by `facts:mine --list`. */
  title: string;
  sources: SourceDataset[];
  variants: ProbeVariant[];
  /** Above this many occurrences the event is not rare enough to be a fact.
   * The SQL fetches one more than this so the miner can tell "hit the cap"
   * from "exactly this many". */
  maxPopulation: number;
  /** Build the occurrence query. Every user-derived value goes through `p`. */
  sql(variant: ProbeVariant, p: Params): string;
  /** Render the headline from the subject row and the derived claim. Pure
   * string templating — no numbers computed here that the SQL didn't return. */
  headline(subject: OccurrenceRow, claim: Claim, variant: ProbeVariant): string;
  /** The /search question this fact should deep-link to, if any. */
  question?(subject: OccurrenceRow, variant: ProbeVariant): string | null;
}

/** The derived claim: how rare, how long since, and how far back we can see. */
export interface Claim {
  population: number;
  priorSeason: number | null;
  coverageFloor: number;
  /** Occurrences sharing the subject's season+week — co-holders of "first". */
  coHolders: OccurrenceRow[];
}

/** A scored, ready-to-store fact. */
export interface FactCandidate {
  fact_id: string;
  probe_id: string;
  family: FactFamily;
  subject_kind: "player" | "team";
  subject_id: string;
  subject_name: string;
  season: number;
  week: number | null;
  season_type: string;
  headline: string;
  metric: string;
  value: number;
  population: number;
  prior_season: number | null;
  coverage_floor: number;
  rarity: number;
  surprise: number;
  sql: string;
  evidence: OccurrenceRow[];
  question: string | null;
}
