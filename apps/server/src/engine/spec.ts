/** The QuerySpec — a typed intermediate representation between natural
 * language and SQL — plus the stat configuration that drives both the parser
 * and the SQL builder.
 *
 * The rule-based parser produces one of these small structured objects
 * instead of raw SQL. A deterministic builder turns it into safe,
 * parameterized SQL, so there is no injection surface. The spec also doubles
 * as a stable cache key.
 */

export type Intent =
  | "leaders" | "player_total" | "single_game" | "compare" | "scoring" | "game_count"
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

export interface QuerySpec {
  intent: Intent;
  stat: keyof typeof STATS & string;
  season?: number | null;
  seasonType: string; // REG | POST
  player?: string | null; // display name (narration / LIKE fallback)
  playerId?: string | null; // canonical id from the resolver (preferred)
  player2?: string | null; // second player (COMPARE)
  player2Id?: string | null;
  scope: "season" | "career"; // PLAYER_TOTAL and LEADERS
  firstN?: number | null; // first N games scope (1..50)
  lastN?: number | null; // last N games scope (1..50)
  limit: number; // 1..100
  /** SCORING: which end of the touchdown timeline ("first"/"last"), or null
   * for a most-recent-first list. */
  edge?: "first" | "last" | null;
  /** LEADERS: restrict to a position (best QB, top 10 WRs). */
  position?: string | null;
  /** LEADERS: "fewest"/"lowest" flips to ascending (with a games qualifier). */
  dir?: "desc" | "asc";
  /** Game-level filters — presence routes totals through the game log. */
  venue?: "home" | "away" | null;
  weekMin?: number | null;
  weekMax?: number | null;
  /** GAME_COUNT: qualifying-games threshold ("games over 300 passing yards"). */
  threshold?: { op: ">" | ">=" | "<"; value: number } | null;
  /** Scope the answer to the player's rookie (first) season. */
  rookie?: boolean;
  /** Restrict to Super Bowls (each postseason's final game). */
  sbOnly?: boolean;
  /** Playoff round (weeks ranked within each postseason: SB = final week). */
  round?: "WC" | "DIV" | "CON" | "SB" | null;
  /** GAME intents: the team(s) a question is about (canonical team ids). */
  teamId?: string | null;
  teamName?: string | null;
  team2Id?: string | null;
  team2Name?: string | null;
  /** Restrict to games against one opponent ("Jefferson vs Green Bay games"). */
  opponentId?: string | null;
  /** Exact game date (ISO), e.g. "Packers game on October 20, 2024". */
  gameDate?: string | null;
  /** Conference filter for round games ("AFC championship"). */
  conf?: "AFC" | "NFC" | null;
  /** GAME_RESULT: margin ceiling ("Super Bowls decided by 3 or fewer"). */
  marginMax?: number | null;
  /** DRAFT_PICK: overall selection number and/or round. */
  draftPick?: number | null;
  draftRound?: number | null;
}

export function specExpr(spec: QuerySpec): string {
  return STATS[spec.stat]!.expr;
}

export function specLabel(spec: QuerySpec): string {
  return STATS[spec.stat]!.label;
}

/** Must include every field buildSql() depends on — notably playerId, since
 * two players can share a display name. */
export function specCacheKey(s: QuerySpec): string {
  return [
    s.intent, s.stat, s.season, s.seasonType, (s.player ?? "").toLowerCase(),
    s.playerId, s.scope, s.limit, s.player2Id, s.firstN, s.edge,
    s.lastN, s.position, s.dir, s.venue, s.weekMin, s.weekMax,
    s.threshold && `${s.threshold.op}${s.threshold.value}`, s.rookie, s.sbOnly,
    s.round, s.teamId, s.team2Id, s.opponentId, s.gameDate, s.conf,
    s.marginMax, s.draftPick, s.draftRound,
  ].map(String).join("|");
}
