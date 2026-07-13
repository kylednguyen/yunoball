/** The QuerySpec AST — a typed intermediate representation between natural
 * language and SQL — plus the stat configuration that drives both the parser
 * and the executors.
 *
 * The rule-based parser compiles a question into one of these nodes instead
 * of raw SQL. A deterministic executor (engine/executors/) turns each node
 * into safe, parameterized SQL, so there is no injection surface. The node
 * also doubles as a stable cache key.
 *
 * The spec is a DISCRIMINATED UNION on `intent`: each intent's node carries
 * only the fields its executor legitimately consumes, so "the parser set a
 * field the executor silently ignores" — the engine's worst historical bug
 * class — is a compile error, not a wrong number.
 */

export type Intent =
  | "leaders" | "player_total" | "player_seasons" | "single_game" | "compare"
  | "scoring" | "game_count" | "qualifying_count" | "player_rank" | "player_bio"
  | "game_log" | "team_game_log" | "game_result" | "draft_pick";

export interface StatDef {
  /** SQL expression over the stats-table alias `s`. Allowlisted here, never
   * taken from free text, so it is safe to interpolate. Every column it
   * references exists in BOTH player_season_stats and player_game_stats
   * (except game-sourced stats, which aggregate player_game_stats only). */
  expr: string;
  /** Human label used by the templated narration. */
  label: string;
  /** Exact substrings that select this stat (most specific first overall). */
  phrases: string[];
  /** Whole-word tokens that select this stat — safe home for short terms
   * ("int", "tds", "picks") that would misfire as substrings. */
  words: string[];
  /** "game": columns only exist in player_game_stats — totals and leaders
   * aggregate the game log instead of season rollups. */
  source?: "game";
  /** Ratio stats (completion %): aggregate numerator/denominator separately,
   * divide after summing. `den` also drives a small-sample qualifier. */
  ratio?: { num: string; den: string };
  /** Display unit appended in narration (e.g. "%"). */
  unit?: string;
}

const n = (col: string) => `COALESCE(s.${col}, 0)`;

/** Ordered: the first stat whose phrase/word matches wins, so unambiguous
 * vocabulary (interceptions) sits above generic touchdown/yard cues. The two
 * computed stats at the bottom carry no vocabulary of their own — the parser
 * selects them for generic "touchdowns"/"yards" questions with no player. */
export const STATS: Record<string, StatDef> = {
  interceptions: {
    expr: "s.interceptions",
    label: "interceptions",
    // "pick" (singular) is deliberately absent — it collides with draft picks.
    phrases: ["interception", "picked off", "pick six", "int thrown"],
    words: ["int", "ints", "picks"],
  },
  passing_tds: {
    expr: "s.passing_tds",
    label: "passing touchdowns",
    phrases: ["passing touchdown", "passing td", "touchdown pass", "td pass", "pass td"],
    words: ["threw", "throws"],
  },
  rushing_tds: {
    expr: "s.rushing_tds",
    label: "rushing touchdowns",
    phrases: ["rushing touchdown", "rushing td", "rush td", "ground td"],
    words: [],
  },
  receiving_tds: {
    expr: "s.receiving_tds",
    label: "receiving touchdowns",
    phrases: ["receiving touchdown", "receiving td", "rec td", "touchdown catch", "td catch"],
    words: [],
  },
  passing_yards: {
    expr: "s.passing_yards",
    label: "passing yards",
    phrases: ["passing yard", "passing yds", "pass yds", "pass yard", "threw for", "passing"],
    words: [],
  },
  rushing_yards: {
    expr: "s.rushing_yards",
    label: "rushing yards",
    // "carries" is deliberately absent — it means attempts, not yards, and a
    // wrong number is worse than an honest "can't answer".
    phrases: ["rushing yard", "rushing yds", "rush yds", "rush yard", "rushed for", "rushing"],
    words: ["rush", "rushes"],
  },
  receiving_yards: {
    expr: "s.receiving_yards",
    label: "receiving yards",
    phrases: ["receiving yard", "receiving yds", "rec yds", "rec yard", "receiv"],
    words: [],
  },
  receptions: {
    expr: "s.receptions",
    label: "receptions",
    phrases: ["reception", "catches", "caught"],
    words: ["rec", "recs", "grabs"],
  },
  fantasy_points_ppr: {
    expr: "s.fantasy_points_ppr",
    label: "fantasy points (PPR)",
    phrases: ["fantasy", "ppr"],
    words: [],
  },
  tackles: {
    expr: "s.tackles",
    label: "tackles",
    phrases: ["tackles combined", "combined tackles", "total tackles"],
    words: ["tackle", "tackles"],
  },
  def_sacks: {
    expr: "s.def_sacks",
    label: "sacks",
    phrases: ["sacks made", "sack leader"],
    words: ["sack", "sacks"],
  },
  forced_fumbles: {
    expr: "s.forced_fumbles",
    label: "forced fumbles",
    phrases: ["forced fumble", "fumbles forced"],
    words: [],
  },
  passes_defended: {
    expr: "s.passes_defended",
    label: "passes defended",
    phrases: ["passes defended", "pass deflection", "pass breakup", "passes broken up"],
    words: [],
  },
  sacks_taken: {
    expr: "s.sacks",
    label: "sacks taken",
    phrases: ["sacks taken", "sacked", "times sacked"],
    words: [],
  },
  completion_pct: {
    expr: "", // ratio stats aggregate num/den; no per-row expression
    label: "completion percentage",
    phrases: ["completion percentage", "completion pct", "completion rate", "comp pct", "comp %"],
    words: [],
    source: "game",
    ratio: { num: "completions", den: "attempts" },
    unit: "%",
  },
  // ---- Computed stats (parser-selected for generic questions) ----
  total_tds: {
    expr: `${n("passing_tds")} + ${n("rushing_tds")} + ${n("receiving_tds")}`,
    label: "total touchdowns",
    phrases: ["total touchdown", "combined touchdown", "all touchdowns"],
    words: [],
  },
  scrimmage_yards: {
    expr: `${n("rushing_yards")} + ${n("receiving_yards")}`,
    label: "yards from scrimmage",
    phrases: ["scrimmage yard", "yards from scrimmage", "all-purpose yard", "all purpose yard"],
    words: [],
  },
};

// --------------------------------------------------------------------------
// The AST node types
// --------------------------------------------------------------------------

/** Fields every node carries. */
export interface SpecBase {
  stat: keyof typeof STATS & string;
  season?: number | null;
  seasonType: string; // REG | POST
  scope: "season" | "career";
  limit: number; // 1..100
}

/** Game-grain filters consumed by the shared gamePreds() predicate builder —
 * any node extending this can be scoped by venue, weeks, playoff round,
 * opponent, or an inclusive season range. */
export interface GameWindow {
  venue?: "home" | "away" | null;
  weekMin?: number | null;
  weekMax?: number | null;
  /** Restrict to Super Bowls (each postseason's final game). */
  sbOnly?: boolean;
  /** Playoff round (weeks ranked within each postseason: SB = final week). */
  round?: "WC" | "DIV" | "CON" | "SB" | null;
  /** Restrict to games against one opponent ("Jefferson vs Green Bay games"). */
  opponentId?: string | null;
  /** Inclusive season range ("from 2021 to 2023"); overrides `season`. */
  seasonMin?: number | null;
  seasonMax?: number | null;
}

/** Team-anchored game lookups (team_game_log / game_result) share these. */
export interface TeamGameFields {
  teamName?: string | null;
  team2Id?: string | null;
  team2Name?: string | null;
  round?: "WC" | "DIV" | "CON" | "SB" | null;
  /** Conference filter for round games ("AFC championship"). */
  conf?: "AFC" | "NFC" | null;
  weekMin?: number | null;
  weekMax?: number | null;
  /** Exact game date (ISO), e.g. "Packers game on October 20, 2024". */
  gameDate?: string | null;
  /** Margin ceiling ("Super Bowls decided by 3 or fewer"). */
  marginMax?: number | null;
  venue?: "home" | "away" | null;
}

export interface LeadersSpec extends SpecBase, GameWindow {
  intent: "leaders";
  position?: string | null;
  /** "fewest"/"lowest" flips to ascending (with a games qualifier). */
  dir?: "desc" | "asc";
  rookie?: boolean;
  /** Rank the per-game rate instead of the raw total. */
  perGame?: boolean;
}

export interface PlayerTotalSpec extends SpecBase, GameWindow {
  intent: "player_total";
  player?: string | null; // display name (narration / LIKE fallback)
  playerId?: string | null; // canonical id from the resolver (preferred)
  firstN?: number | null; // first N games scope (1..50)
  lastN?: number | null; // last N games scope (1..50)
  rookie?: boolean;
  /** Report the per-game rate instead of the raw total. */
  perGame?: boolean;
}

export interface PlayerSeasonsSpec extends SpecBase {
  intent: "player_seasons";
  playerId: string;
  player?: string | null;
  position?: string | null;
}

export interface SingleGameSpec extends SpecBase {
  intent: "single_game";
  player?: string | null;
  playerId?: string | null;
}

export interface CompareSpec extends SpecBase, GameWindow {
  intent: "compare";
  playerId: string;
  player2Id: string;
  player?: string | null;
  player2?: string | null;
  firstN?: number | null;
}

export interface ScoringSpec extends SpecBase {
  intent: "scoring";
  playerId: string;
  player?: string | null;
  sbOnly?: boolean;
  round?: "WC" | "DIV" | "CON" | "SB" | null;
  /** Which end of the touchdown timeline ("first"/"last"), or null for a
   * most-recent-first list. */
  edge?: "first" | "last" | null;
}

export interface GameCountSpec extends SpecBase, GameWindow {
  intent: "game_count";
  playerId: string;
  player?: string | null;
  /** Qualifying-games threshold ("games over 300 passing yards"). */
  threshold: { op: ">" | ">=" | "<"; value: number };
}

export interface QualifyingCountSpec extends SpecBase {
  intent: "qualifying_count";
  threshold: { op: ">" | ">=" | "<"; value: number };
  position?: string | null;
}

export interface PlayerRankSpec extends SpecBase {
  intent: "player_rank";
  playerId: string;
  player?: string | null;
  position?: string | null;
  seasonMin?: number | null;
  seasonMax?: number | null;
}

export interface PlayerBioSpec extends SpecBase {
  intent: "player_bio";
  /** Which bio fact ("team"/"age"/…), or the metric a superlative ranks by. */
  bioField: "team" | "age" | "height" | "weight" | "college" | "full";
  playerId?: string | null;
  player?: string | null;
  dir?: "desc" | "asc";
  position?: string | null;
}

export interface GameLogSpec extends SpecBase, GameWindow {
  intent: "game_log";
  playerId: string;
  player?: string | null;
  position?: string | null;
  firstN?: number | null;
  lastN?: number | null;
  /** Opponent display name for narration when opponentId is set. */
  team2Name?: string | null;
}

export interface TeamGameLogSpec extends SpecBase, TeamGameFields {
  intent: "team_game_log";
  teamId: string;
  lastN?: number | null;
}

export interface GameResultSpec extends SpecBase, TeamGameFields {
  intent: "game_result";
  /** Absent for neutral lookups ("who won Super Bowl 50"). */
  teamId?: string | null;
}

export interface DraftPickSpec extends SpecBase {
  intent: "draft_pick";
  playerId?: string | null;
  player?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  /** Overall selection number and/or round. */
  draftPick?: number | null;
  draftRound?: number | null;
}

export type QuerySpec =
  | LeadersSpec | PlayerTotalSpec | PlayerSeasonsSpec | SingleGameSpec
  | CompareSpec | ScoringSpec | GameCountSpec | QualifyingCountSpec
  | PlayerRankSpec | PlayerBioSpec | GameLogSpec | TeamGameLogSpec
  | GameResultSpec | DraftPickSpec;

// --------------------------------------------------------------------------
// The field-bag reader view
// --------------------------------------------------------------------------

/** Every field any node can carry, all optional. Cross-intent consumers that
 * legitimately read across the union — the auditor, the narration templates,
 * the cache key — use this view via fields(). Executors must NOT: they take
 * their exact node type, which is where the type enforcement lives. */
export interface SpecFields extends GameWindow, TeamGameFields {
  player?: string | null;
  playerId?: string | null;
  player2?: string | null;
  player2Id?: string | null;
  firstN?: number | null;
  lastN?: number | null;
  rookie?: boolean;
  perGame?: boolean;
  position?: string | null;
  dir?: "desc" | "asc";
  edge?: "first" | "last" | null;
  threshold?: { op: ">" | ">=" | "<"; value: number } | null;
  bioField?: "team" | "age" | "height" | "weight" | "college" | "full" | null;
  teamId?: string | null;
  draftPick?: number | null;
  draftRound?: number | null;
}

export type FieldedSpec = SpecBase & { intent: Intent } & SpecFields;

/** Reader view over any node — same object, loosened type. */
export function fields(spec: QuerySpec): FieldedSpec {
  return spec as unknown as FieldedSpec;
}

export function specExpr(spec: { stat: string }): string {
  return STATS[spec.stat]!.expr;
}

export function specLabel(spec: { stat: string }): string {
  return STATS[spec.stat]!.label;
}

/** Must include every field the executors depend on — notably playerId, since
 * two players can share a display name. */
export function specCacheKey(spec: QuerySpec): string {
  const s = fields(spec);
  return [
    s.intent, s.stat, s.season, s.seasonType, (s.player ?? "").toLowerCase(),
    s.playerId, s.scope, s.limit, s.player2Id, s.firstN, s.edge,
    s.lastN, s.position, s.dir, s.venue, s.weekMin, s.weekMax,
    s.threshold && `${s.threshold.op}${s.threshold.value}`, s.rookie, s.sbOnly,
    s.round, s.teamId, s.team2Id, s.opponentId, s.gameDate, s.conf,
    s.marginMax, s.draftPick, s.draftRound,
    s.bioField, s.perGame, s.seasonMin, s.seasonMax,
  ].map(String).join("|");
}
