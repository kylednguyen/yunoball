/** Rule-based NL -> QuerySpec parser (deterministic, zero-LLM).
 *
 * Vocabulary lives in the STATS config (spec.ts): per-stat phrases (substring)
 * and words (whole-word, safe for short terms like "ints" or "tds"). On top
 * of that, this module handles question SHAPES:
 *
 *   leaders            "most passing yards in 2024", "best qb", "top 10 WRs",
 *                      "fewest interceptions this season" (ascending)
 *   career leaders     "most career rushing yards", "most receptions ever"
 *   player total       "Mahomes passing yards [in 2023]", bare "Josh Allen",
 *                      with game-level filters: home/away, week ranges,
 *                      first/last N games, rookie year, playoffs
 *   game counts        "Lamar games over 300 passing yards"
 *   single game        "most rushing yards in a game"
 *   compare            "Allen vs Mahomes", "Allen and Mahomes"
 *   scoring            "Henry's first touchdown", "when did Adams last score"
 *
 * Questions the warehouse genuinely can't answer return a tailored refusal
 * (defensive stats, team-level stats, schedules) — an honest sentence with a
 * pointer beats a wrong number. Anything else returns null and the pipeline
 * answers generically.
 */

import type { ResolvedEntity } from "@yunoball/types";
import { STATS } from "./spec.js";
import type { QuerySpec } from "./spec.js";
import { isComparableStat, isSeasonRollupStat } from "./executors/shared.js";
import type { IndexedPlayer, IndexedTeam } from "./resolve.js";

export interface Refusal {
  refusal: string;
}

export type ParseResult = QuerySpec | Refusal | null;

export function isRefusal(r: ParseResult): r is Refusal {
  return r !== null && "refusal" in r;
}

const POST_KEYS = ["post season", "postseason", "playoff", "super bowl", "superbowl"];

/** A position's primary production stat — what a question is really about
 * when none is named. Real stats, never fantasy points. */
const PRIMARY_STAT: Record<string, string> = {
  QB: "passing_yards",
  RB: "rushing_yards",
  WR: "receiving_yards",
  TE: "receiving_yards",
  // Defensive positions, including the coarse groups the warehouse stores
  // (DL/LB/DB): pass rushers are framed by sacks, everyone else by tackles.
  LB: "tackles", ILB: "tackles", OLB: "tackles", MLB: "tackles",
  DL: "def_sacks", DE: "def_sacks", DT: "tackles", NT: "tackles", EDGE: "def_sacks",
  CB: "tackles", S: "tackles", FS: "tackles", SS: "tackles", DB: "tackles",
};

/** ...and its primary touchdown stat, for generic "touchdowns" questions. */
const PRIMARY_TD: Record<string, string> = {
  QB: "passing_tds",
  RB: "rushing_tds",
  WR: "receiving_tds",
  TE: "receiving_tds",
};

function detectPosition(qText: string): string | null {
  for (const [re, pos] of POSITION_WORDS) {
    if (re.test(qText)) return pos;
  }
  return null;
}

const POSITION_WORDS: [RegExp, string][] = [
  [/\b(qbs?|quarterbacks?)\b/, "QB"],
  [/\b(rbs?|running backs?)\b/, "RB"],
  [/\b(wrs?|wide receivers?|receivers?)\b/, "WR"],
  [/\b(tes?|tight ends?)\b/, "TE"],
];

const WORD_NUMS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const ORD_NUMS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
// \d{1,3}: "first N games/seasons" windows run up to career-length (100+
// games), past topN/lastN's old 2-digit assumption.
const NUM_ALT = `\\d{1,3}|${Object.keys(WORD_NUMS).join("|")}`;

// "X versus Y" / "X vs Y" / "X and Y" splits the question into two halves;
// compare only fires when BOTH halves resolve to (different) players.
const VS_RE = /\s+(?:versus|vs\.?|and|&|compared (?:to|with|against))\s+/;

/** Words that don't change a bare-name question's meaning ("show me mahomes
 * stats" is still just "mahomes"). */
const BARE_FILLER = new Set([
  "show", "me", "stats", "stat", "numbers", "info", "profile", "about",
  "the", "his", "her", "of", "for", "s",
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(qText: string, word: string): boolean {
  return new RegExp(`\\b${escapeRe(word)}\\b`).test(qText);
}

/** First stat whose vocabulary matches, in STATS declaration order.
 * Phrases (multi-word, specific) beat single words across ALL stats, so
 * "threw for ... yards" hits passing_yards before the bare "threw" word
 * can claim passing touchdowns. */
function detectStat(qText: string): string | null {
  for (const [stat, def] of Object.entries(STATS)) {
    if (def.phrases.some((p) => qText.includes(p))) return stat;
  }
  for (const [stat, def] of Object.entries(STATS)) {
    if (def.words.some((w) => hasWord(qText, w))) return stat;
  }
  return null;
}

/** Generic cues that need context (player position / leaders) to resolve. */
function genericCue(qText: string): "tds" | "yards" | null {
  if (/\b(touchdowns?|tds?)\b/.test(qText)) return "tds";
  if (/\b(yards?|yds)\b/.test(qText)) return "yards";
  return null;
}

/** Question vocabulary that must never anchor a single-word player match —
 * real surnames collide with it (T.J. Rushing, Jahvid Best). Multi-word full
 * names are exempt, so "jahvid best rushing yards" still resolves while
 * "best rushing yards" stays a leaders question. */
export const RESERVED: Set<string> = (() => {
  const words = new Set<string>([
    "top", "best", "first", "fewest", "career", "all", "time", "ever",
    "history", "this", "current", "last", "latest", "season", "seasons",
    "year", "years", "game", "games", "single", "one", "playoff", "playoffs",
    "postseason", "super", "bowl", "week", "weeks", "versus", "vs", "who",
    "what", "when", "how", "many", "much", "did", "the", "in", "a", "an",
    "of", "for", "and", "with", "by", "at", "over", "under", "leader",
    "leaders", "league", "player", "players", "threw", "throw", "points",
    "most", "record", "records", "stats", "stat", "home", "away", "rookie",
    "highest", "lowest", "worst", "bottom", "compare", "show", "me",
    "qb", "rb", "wr", "te", "quarterback", "quarterbacks",
    // Result/game vocabulary: never a name anchor ("final" is not John Fina).
    "bowls", "superbowl", "superbowls",
    "final", "score", "scores", "result", "results", "won", "winner",
    "winners", "beat", "defeated", "happened", "played", "decided",
    "against", "draft", "drafted", "pick", "round", "rounds", "appearance", "appearances",
    "log", "matchup", "matchups", "championship", "afc", "nfc",
    "wild", "card", "divisional", "conference",
    // English function words that are real surname keys in the warehouse:
    // "what division ARE the chiefs in" must never resolve Kareem Are, and
    // "more THAN 300 yards" never Than Merrill. Full names still match.
    "are", "than",
    // Filter vocabulary that collides with a nickname key: the fused
    // "primetime" is the broadcast-window split, never Deion Sanders.
    "primetime",
    // Exact-match misfires in the playerHit() fallback: "line" is Zach
    // Line's surname ("5-yard line"), "still" is Tarheeb/Devon/Bryan
    // Still's surname ("...and still won") — real words that must never
    // anchor a bare single-word match.
    "line", "still",
  ]);
  for (const def of Object.values(STATS)) {
    for (const phrase of def.phrases) {
      for (const w of phrase.split(" ")) words.add(w);
    }
    for (const w of def.words) words.add(w);
  }
  for (const cue of ["yards", "yard", "yds", "touchdowns", "touchdown", "tds", "td"]) {
    words.add(cue);
  }
  return words;
})();

/** Whole-word full-name / surname match against the player index. Longest
 * tokens first so "geno smith" beats a lone "smith"; reserved question
 * vocabulary never anchors a match. */
function playerHit(
  qText: string, index: Map<string, IndexedPlayer>,
  teams?: Map<string, IndexedTeam>,
): IndexedPlayer | null {
  const tokens = [...index.keys()].sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    if (!token.includes(" ") && RESERVED.has(token)) continue;
    if (teams?.has(token)) continue; // "bills" is the team, not Keaton Bills
    if (hasWord(qText, token)) return index.get(token)!;
  }
  return null;
}

/** Every distinct player mentioned (for 3-way-compare detection), capped. */
function allPlayerHits(
  qText: string, index: Map<string, IndexedPlayer>,
  teams?: Map<string, IndexedTeam>, cap = 4,
): IndexedPlayer[] {
  const seen = new Map<string, IndexedPlayer>();
  const tokens = [...index.keys()].sort((a, b) => b.length - a.length);
  let remaining = qText;
  for (const token of tokens) {
    if (seen.size >= cap) break;
    if (!token.includes(" ") && RESERVED.has(token)) continue;
    if (teams?.has(token)) continue;
    if (new RegExp(`\\b${escapeRe(token)}\\b`).test(remaining)) {
      const p = index.get(token)!;
      if (!seen.has(p.playerId)) {
        seen.set(p.playerId, p);
        // Blank the matched token so "josh allen" doesn't re-match on "allen".
        remaining = remaining.replace(new RegExp(`\\b${escapeRe(token)}\\b`), " ");
      }
    }
  }
  return [...seen.values()];
}

function teamHit(qText: string, teams: Map<string, IndexedTeam>): IndexedTeam | null {
  return teamHits(qText, teams, 1)[0] ?? null;
}

/** Distinct teams in MENTION order (longest keys claim their text first, so
 * "kansas city chiefs" can't double-count via "chiefs"). */
function teamHits(qText: string, teams: Map<string, IndexedTeam>, cap = 2): IndexedTeam[] {
  const tokens = [...teams.keys()].sort((a, b) => b.length - a.length);
  const found: { at: number; team: IndexedTeam }[] = [];
  let remaining = qText;
  for (const token of tokens) {
    const m = remaining.match(new RegExp(`\\b${escapeRe(token)}\\b`));
    if (m && m.index !== undefined) {
      const team = teams.get(token)!;
      if (!found.some((f) => f.team.teamId === team.teamId)) {
        found.push({ at: m.index, team });
        remaining =
          remaining.slice(0, m.index) + " ".repeat(token.length) + remaining.slice(m.index + token.length);
      }
    }
  }
  return found.sort((a, b) => a.at - b.at).slice(0, cap).map((f) => f.team);
}

/** A four-digit year, or relative phrasings resolved against the newest
 * loaded season ("this season", "last year", "current season"). */
function detectSeason(qText: string, latestSeason: number | null): number | null {
  // "since 1999" / "since 2000" is a range start (seasonRange handles it),
  // not a single season — strip it so it isn't misread as a one-year filter.
  const cleaned = qText.replace(/\bsince\s+(?:the\s+)?(?:19|20)\d{2}\b/g, " ");
  // A four-digit run immediately followed by a stat unit is a threshold value
  // ("2000 yard rushers", "1500 receiving yards"), never a season year.
  const m = cleaned.match(
    /\b(19|20)\d{2}\b(?!\s*[-]?\s*(?:\+|yards?|yds?|receptions?|catches|tds?|touchdowns?|tackles?|sacks?|points?|pts?))/,
  );
  if (m) return Number(m[0]);
  if (latestSeason == null) return null;
  if (/\b(this|current) (season|year)\b/.test(qText)) return latestSeason;
  // "last season" / "last year" both mean the prior season.
  if (/\blast (season|year)\b/.test(qText)) return latestSeason - 1;
  return null;
}

function numFrom(tok: string): number {
  return WORD_NUMS[tok] ?? Number(tok);
}

/** 'first 5 games', 'first five games', or a bare 'first 5'. */
function firstN(qText: string): number | null {
  const m = qText.match(new RegExp(`\\bfirst (${NUM_ALT})\\b`));
  return m ? numFrom(m[1]!) : null;
}

/** 'last 5 games' — most recent N games; bare 'last game' means the most
 * recent one. */
function lastN(qText: string): number | null {
  const m = qText.match(new RegExp(`\\blast (${NUM_ALT}) (?:games?|starts?)\\b`));
  if (m) return numFrom(m[1]!);
  return /\blast game\b/.test(qText) ? 1 : null;
}

/** 'top 5', 'top ten', 'best 3' -> result count for leaders/single-game. */
function topN(qText: string): number | null {
  const m = qText.match(new RegExp(`\\b(?:top|best|first) (${NUM_ALT})\\b`));
  if (!m) return null;
  return Math.min(Math.max(numFrom(m[1]!), 1), 50);
}

/** 'through/in his first N (career|playoff)? games/starts' — a leaderboard
 * window over each player's own first N games ("who scored the most
 * touchdowns through his first 50 career games", "in his first 10 playoff
 * games"). Requires the games/starts noun so it never collides with a
 * season window ("in his first three seasons", see seasonWindowN). */
function firstNGamesWindow(qText: string): { n: number; starts: boolean } | null {
  const m = qText.match(
    new RegExp(`\\b(?:through|in) (?:(?:his|her|their)\\s+)?first (${NUM_ALT}) (?:career |playoff )?(games|starts)\\b`),
  );
  return m ? { n: numFrom(m[1]!), starts: m[2] === "starts" } : null;
}

/** 'before his Nth season' or 'in/through his first N seasons' — the
 * exclusive boundary season number for a career season-window leaderboard
 * (season < rookie_season + boundary - 1); same semantics as
 * GameCountLeadersSpec.beforeSeasonN. "First N seasons" (seasons 1..N)
 * converts to the boundary form (N + 1) so both phrasings share one field. */
function seasonWindowN(qText: string): number | null {
  let m = qText.match(
    /\bbefore (?:(?:his|her|their)\s+)?(?:(\d{1,2})(?:st|nd|rd|th)|(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth))(?:\s+nfl)? seasons?\b/,
  );
  if (m) return m[1] ? Number(m[1]) : (ORD_NUMS[m[2]!] ?? null);
  m = qText.match(
    new RegExp(`\\b(?:in|through) (?:(?:his|her|their)\\s+)?first (${NUM_ALT})(?:\\s+nfl)? seasons?\\b`),
  );
  return m ? numFrom(m[1]!) + 1 : null;
}

/** Touchdown-distance and TD-kind board filters ("most 1-yard touchdowns",
 * "touchdowns of 50 or more yards", "inside the 5-yard line", pick sixes,
 * fumble-return TDs). Null unless the question is a scoring board: a distance
 * plus touchdown vocabulary, or a defensive-return phrase. */
function scoringBoardFilters(qText: string): {
  yardsMin: number | null;
  yardsMax: number | null;
  tdKind: "rush" | "pass" | "defense" | "int_return" | "fumble_return" | null;
} | null {
  const TD = "(?:touchdowns?|tds?)";
  const KIND = "(?:(?:rushing|receiving|defensive) )?";
  let yardsMin: number | null = null;
  let yardsMax: number | null = null;
  let m = qText.match(/\bfrom exactly (\d{1,3}) yards?(?: out)?\b/);
  if (m) yardsMin = yardsMax = Number(m[1]);
  m = qText.match(new RegExp(`\\b(\\d{1,3})[-\\s]yard ${KIND}${TD}`));
  if (m && yardsMin == null) yardsMin = yardsMax = Number(m[1]);
  m = qText.match(new RegExp(`\\b${TD} of (\\d{1,3})(?:\\+| or more) yards?\\b`));
  if (m) yardsMin = Number(m[1]);
  m = qText.match(new RegExp(`\\b(\\d{1,3})\\+[-\\s]yard ${KIND}${TD}`));
  if (m) yardsMin = Number(m[1]);
  // "inside the 5" / "inside the 5-yard line" — but never "inside the
  // 2-minute warning", which is a clock split, not a distance.
  m = qText.match(/\binside the (\d{1,3})(?:[-\s]?(?:yard line|yards?))?\b/);
  if (m && !/\binside the \d{1,3}[-\s]?minute/.test(qText)) yardsMax = Number(m[1]);
  // Defensive-return boards. "pick six" next to "threw/thrown" is the
  // QB-side question (INTs thrown, returned by the OTHER team) — not this.
  const defKind = /\bdefensive (?:touchdowns?|tds?)\b/.test(qText)
    ? ("defense" as const)
    : new RegExp(`\\binterception[-\\s]return ${TD}\\b`).test(qText) ||
        (/\bpick[-\s]six(?:es)?\b/.test(qText) && !/\b(?:threw|thrown)\b/.test(qText))
      ? ("int_return" as const)
      : new RegExp(`\\bfumble[-\\s]return ${TD}\\b`).test(qText)
        ? ("fumble_return" as const)
        : null;
  const hasDistance = yardsMin != null || yardsMax != null;
  if (!defKind && !(hasDistance && new RegExp(`\\b${TD}\\b`).test(qText))) return null;
  const tdKind =
    defKind ??
    (new RegExp(`\\brushing ${TD}`).test(qText)
      ? ("rush" as const) // scoring_plays.td_kind: offensive rushing scores
      : new RegExp(`\\breceiving ${TD}`).test(qText) || /\btouchdown catch(?:es)?\b/.test(qText)
        ? ("pass" as const) // td_kind "pass" = the receiver scored
        : null);
  return { yardsMin, yardsMax, tdKind };
}

/** Game-result / margin filters: "in games his team lost" (a loss), "and
 * still won" (a win), "in one-score games/losses" (final margin <= 8).
 * "One-score losses" sets both — the executor combines them as AND
 * predicates via gamePreds, same idiom as every other GameWindow filter.
 * LOCKSTEP: the game-result/one-score vocabulary this function recognizes is
 * mirrored (independently, not shared code) by the "in games his team lost" /
 * "one-score" QUALIFIER_RULES entry in audit.ts — that guard's unmet() only
 * runs once its OWN regex matches, so it's a soft mirror (a narrower audit
 * regex just skips the refusal, it doesn't misfire), but keep the two
 * word lists in sync when either changes. */
function resultFilters(qText: string): { gameResult: "W" | "L" | null; oneScore: boolean } {
  const oneScore = /\bin (?:a |the )?(?:one-score|close) (?:games|losses)\b/.test(qText);
  const lostGame = /\bin (?:a |the )?games? (?:his|her|their) team lost\b/.test(qText);
  const oneScoreLoss = /\bin (?:a |the )?(?:one-score|close) losses\b/.test(qText);
  let gameResult: "W" | "L" | null = null;
  if (lostGame || oneScoreLoss) gameResult = "L";
  if (/\band still won\b/.test(qText)) gameResult = "W";
  return { gameResult, oneScore };
}

/** "Against teams with winning records" — the opponent-record board filter
 * (implemented via the opponent's FINAL season record; see gamePreds). */
const OPP_RECORD_RE = /\bagainst (?:teams with )?winning records?\b/;

/** "Against a/one single/specific opponent (or team)" — the best-single-
 * opponent leaderboard (perOpponent). Deliberately excludes "quarterback":
 * sacks/interceptions are recorded against the opposing TEAM in the
 * warehouse, never a specific opposing quarterback, so that phrasing stays a
 * tailored refusal (PER_QB_RE / the audit guard) instead of silently
 * building a team-level board that doesn't answer what was asked. */
const PER_OPPONENT_RE = /\bagainst (?:a|one) (?:single|specific) (?:opponent|team)\b/;

/** Compound same-game TD filters: "both a rushing and receiving touchdown",
 * "at least one passing and one rushing touchdown", or the plain paraphrase
 * with neither framing word ("a rushing touchdown and a receiving
 * touchdown") — no single numeric threshold; each named stat implicitly
 * needs >=1 in the same game. LOCKSTEP: this vocabulary is mirrored
 * (independently) by the compound-TD QUALIFIER_RULES entry in audit.ts. */
function compoundTdFilter(qText: string): { stat: string; andStat: string } | null {
  const KIND = "(rushing|receiving|passing)";
  let m = qText.match(new RegExp(`\\bboth an? ${KIND} and (?:an? )?${KIND} touchdowns?\\b`));
  if (!m) m = qText.match(new RegExp(`\\bat least one ${KIND} and one ${KIND} touchdowns?\\b`));
  if (!m) m = qText.match(new RegExp(`\\ban? ${KIND} touchdown and an? ${KIND} touchdowns?\\b`));
  if (!m) return null;
  return { stat: `${m[1]}_tds`, andStat: `${m[2]}_tds` };
}

// ---- Task 6: derived-negation ("without") boards ----

/** Which unit word ("yard"/"catch") a stat's own season total is measured
 * in — the withoutSeasonAtLeast() unit-match guard below. Only stats this
 * negation can legitimately apply to get an entry; anything else (and any
 * mismatched unit word, "receptions" against "-yard") returns null so the
 * caller refuses rather than silently ranking against the wrong column
 * ("most career receptions without a 1,000-YARD season" must never execute
 * catches < 1000). */
const SEASON_THRESHOLD_UNIT: Record<string, "yard" | "catch"> = {
  passing_yards: "yard", rushing_yards: "yard", receiving_yards: "yard", scrimmage_yards: "yard",
  receptions: "catch",
};

/** "without a 1,500-yard season" / "without a 100-catch season" — the
 * career-total board's own stat, excluded whenever a single season ever
 * reached this value ("most career rushing yards without a 1,500-yard
 * season"). The threshold is always about the SAME stat already selected
 * elsewhere in the question — no separate stat lookup needed, but the unit
 * word MUST match that stat's own family (yards vs. receptions), or the
 * question named a different stat's threshold than the one it's ranking. */
function withoutSeasonAtLeast(qText: string, stat: string): number | null {
  const m = qText.match(/\bwithout an? ([\d,]+)-(yard|catch)s? seasons?\b/);
  if (!m) return null;
  if (SEASON_THRESHOLD_UNIT[stat] !== m[2]) return null;
  return Number(m[1]!.replace(/,/g, ""));
}

/** "without (ever) leading the league/NFL (in X)" — excludes anyone who was
 * ever the outright-or-tied season leader in the ranked stat. */
const WITHOUT_LEAGUE_LEAD_RE = /\bwithout (?:ever )?leading the (?:league|nfl)\b/;

/** Explicit stat → touchdown-side map for "without scoring a touchdown".
 * Only plain volume stats whose side is unambiguous: never a
 * string-prefix guess ("receptions" doesn't start with "receiving", and a
 * rushing default would check SUM(rushing_tds)=0 for a receiver — a wrong
 * answer, the engine's worst bug class). A stat outside this map returns
 * null so the audit guard refuses instead. Ratio/formula/advanced stats are
 * deliberately absent: the executor's cross-stat branch carries no ratio
 * floor, and player_game_advanced lacks the *_tds columns the condition
 * reads. */
const TD_SIDE: Record<string, "rushing" | "receiving" | "passing"> = {
  carries: "rushing", rushing_yards: "rushing",
  receptions: "receiving", receiving_yards: "receiving",
  passing_yards: "passing",
};

/** "without scoring a touchdown" — a career cross-stat ZERO condition on the
 * touchdown stat matching the primary stat's side of the ball ("most rushing
 * attempts without scoring a touchdown" -> SUM(rushing_tds) = 0). Null (→
 * guard refusal) when the side can't be confidently determined. */
function withoutTdCrossStat(
  qText: string, stat: string,
): { crossStat: string; crossOp: "="; crossValue: number } | null {
  if (!/\bwithout scoring an? touchdowns?\b/.test(qText)) return null;
  const side = TD_SIDE[stat];
  return side ? { crossStat: `${side}_tds`, crossOp: "=", crossValue: 0 } : null;
}

/** "with fewer than N career <stat>" — a second career-sum bound on a
 * DIFFERENT stat than the one being ranked ("most rushing touchdowns with
 * fewer than 1,000 career rushing yards"). No "without" in this phrasing, so
 * it's a separate trigger from the without-family helpers above. Both halves
 * must be plain season-rollup columns — the executor sums them in one pass
 * over player_season_stats.
 * ponytail: a game-sourced pair (e.g. carries as the bound) would need the
 * executor's game-log path wired here too — add when a real question needs
 * it; until then the audit guard refuses honestly. */
function crossStatBelow(
  qText: string, stat: string,
): { crossStat: string; crossOp: "<"; crossValue: number } | null {
  const m = qText.match(/\bwith fewer than ([\d,]+) career ([a-z][a-z\s]*?)[?.]?$/);
  if (!m) return null;
  const crossStat = detectStat(m[2]!.trim());
  if (!crossStat || !isSeasonRollupStat(stat) || !isSeasonRollupStat(crossStat)) return null;
  return { crossStat, crossOp: "<", crossValue: Number(m[1]!.replace(/,/g, "")) };
}

/** Week-range filters: "week 5", "after week 10", "before/through week 8". */
function weekRange(qText: string): { weekMin?: number; weekMax?: number } {
  let m = qText.match(/\bafter week (\d{1,2})\b/);
  if (m) return { weekMin: Number(m[1]) + 1 };
  m = qText.match(/\bbefore week (\d{1,2})\b/);
  if (m) return { weekMax: Number(m[1]) - 1 };
  m = qText.match(/\bthrough week (\d{1,2})\b/);
  if (m) return { weekMax: Number(m[1]) };
  m = qText.match(/\b(?:in )?week (\d{1,2})\b/);
  if (m) return { weekMin: Number(m[1]), weekMax: Number(m[1]) };
  return {};
}

function venue(qText: string): "home" | "away" | null {
  if (/\bhome games?\b|\bat home\b/.test(qText)) return "home";
  if (/\baway games?\b|\bon the road\b|\broad games?\b/.test(qText)) return "away";
  return null;
}

/** Calendar-month split ("in December"). Only football months — "may" is a
 * modal verb and March-August have no REG/POST games. */
const MONTH_NUMS: Record<string, number> = {
  september: 9, october: 10, november: 11, december: 12, january: 1, february: 2,
};
function detectMonth(qText: string): number | null {
  const m = qText.match(/\b(september|october|november|december|january|february)\b/);
  return m ? MONTH_NUMS[m[1]!]! : null;
}

/** Numeric qualifying-game thresholds: "over 300", "above a 100", "100+",
 * "at least 3", "at least three", "two or more", "more than 10", "under 50",
 * "fewer than 2". Word numbers (WORD_NUMS) count as digits do. */
const TH_NUM = `\\d+|${Object.keys(WORD_NUMS).join("|")}`;
function threshold(qText: string): { op: ">" | ">=" | "<"; value: number } | null {
  let m = qText.match(new RegExp(`\\b(?:over|above|more than)\\s+(?:an?\\s+)?(${TH_NUM})\\b`));
  if (m) return { op: ">", value: numFrom(m[1]!) };
  m = qText.match(new RegExp(`\\bat least\\s+(?:an?\\s+)?(${TH_NUM})\\b`));
  if (m) return { op: ">=", value: numFrom(m[1]!) };
  m = qText.match(new RegExp(`\\b(${TH_NUM}) or more\\b`));
  if (m) return { op: ">=", value: numFrom(m[1]!) };
  m = qText.match(/\b(\d+)\s*\+/);
  if (m) return { op: ">=", value: Number(m[1]) };
  // "multiple" as a bare qualifier ("games with multiple rushing touchdowns")
  // means two-plus — same as "two or more" would.
  if (/\bmultiple\b/.test(qText)) return { op: ">=", value: 2 };
  m = qText.match(new RegExp(`\\b(?:under|below|fewer than|less than)\\s+(${TH_NUM})\\b`));
  if (m) return { op: "<", value: numFrom(m[1]!) };
  m = qText.match(/\bgames? with (\d+)\b/);
  if (m) return { op: ">=", value: Number(m[1]) };
  // "300 yard games", "throw for 300 yards", "1000 rushing yards": a count
  // before a yardage unit (optionally through a rushing/passing/receiving
  // adjective) is a threshold. Two-plus digits so a "5 yard" never trips it.
  // (?<!,): a digit run immediately after a comma is the TAIL of a larger
  // comma-grouped number ("1,500-yard" must never read as 500) — this
  // branch doesn't parse comma grouping at all, so it must refuse rather
  // than silently match the fragment.
  m = qText.match(/(?<!,)\b(\d{2,4})[-\s]?(?:(?:rushing|passing|receiving)\s+)?(?:yards?|yds?)\b/);
  if (m) return { op: ">=", value: Number(m[1]) };
  return null;
}

/** Which bio fact a question about a named player asks for. */
function bioFieldOf(
  qText: string,
): "team" | "teams" | "age" | "height" | "weight" | "college" | "experience" | "jersey" | "full" | null {
  // Plural/history phrasings before the singular current-team check.
  if (/\bjersey\b|\bwhat number (?:does|is|do)\b|\bnumber does\b/.test(qText)) return "jersey";
  if (/\bwhat teams\b|\bwhich teams\b|\bprevious teams\b|\bteam history\b|\bevery team\b|\ball the teams\b/.test(qText)) return "teams";
  if (/\bhow many (?:seasons|years)\b|\byears of experience\b|\bhow long has\b|\bseasons played\b|\bexperience\b/.test(qText)) return "experience";
  if (/\bhow old\b|\bwhat age\b|\bage\b|\bhow young\b|\bbirth\s?date\b|\bbirthday\b/.test(qText)) return "age";
  if (/\bhow tall\b|\bheight\b|\btall is\b/.test(qText)) return "height";
  if (/\bhow heavy\b|\bweigh(?:s|t|ing)?\b/.test(qText)) return "weight";
  if (/\b(?:college|university|what school|go to school|play(?:ed)? college)\b/.test(qText)) return "college";
  if (/\bwhat team\b|\bwhich team\b|\bteam (?:does|is|do)\b|\bplays? for\b|\bwho does\b.*\bplay\b|\bcurrent team\b/.test(qText)) return "team";
  if (/\b(?:bio|biography|profile|info(?:rmation)? (?:on|about)|tell me about|who is)\b/.test(qText)) return "full";
  return null;
}

/** Bio superlative ("tallest player", "oldest quarterback") -> metric + dir. */
function bioSuperlative(qText: string): { field: "height" | "weight" | "age"; dir: "desc" | "asc" } | null {
  // Note: "biggest"/"smallest" are deliberately excluded — they collide with
  // "biggest win", "biggest comeback", etc. Only unambiguous body words here.
  if (/\btallest\b/.test(qText)) return { field: "height", dir: "desc" };
  if (/\bshortest\b/.test(qText)) return { field: "height", dir: "asc" };
  if (/\bheaviest\b/.test(qText)) return { field: "weight", dir: "desc" };
  if (/\blightest\b/.test(qText)) return { field: "weight", dir: "asc" };
  if (/\boldest\b/.test(qText)) return { field: "age", dir: "desc" };
  if (/\byoungest\b/.test(qText)) return { field: "age", dir: "asc" };
  return null;
}

/** A looser threshold used only for league-wide counts: any "N <stat unit>"
 * (receptions, touchdowns, sacks, or a large career-yardage number). The
 * game-grain threshold() deliberately ignores these to avoid mis-routing a
 * plain player question into a game count. */
function countThreshold(qText: string): { op: ">="; value: number } | null {
  const m = qText.match(
    /\b(\d{2,6})\+?\s*(?:or more\s+)?(?:career\s+)?(?:(?:rushing|passing|receiving)\s+)?(?:yards?|yds?|receptions?|catches|touchdowns?|tds?|sacks?|tackles?|interceptions?)\b/,
  );
  return m ? { op: ">=", value: Number(m[1]) } : null;
}

/** Inclusive multi-season range: "from 2021 to 2023", "between 2019 and 2022",
 * "2020-2022", "since 2020", "last 3 seasons". */
function seasonRange(qText: string, latestSeason: number | null): { min: number; max: number } | null {
  let m =
    qText.match(/\bfrom\s+((?:19|20)\d{2})\s+(?:to|through|thru|and)\s+((?:19|20)\d{2})\b/) ??
    qText.match(/\bbetween\s+((?:19|20)\d{2})\s+and\s+((?:19|20)\d{2})\b/) ??
    qText.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  // "since 2020" runs from that season through the newest loaded one.
  m = qText.match(/\bsince\s+(?:the\s+)?((?:19|20)\d{2})\b/);
  if (m && latestSeason != null) return { min: Number(m[1]), max: latestSeason };
  m = qText.match(/\b(?:last|past)\s+(\d{1,2})\s+(?:seasons|years)\b/);
  if (m && latestSeason != null) {
    const n = Math.max(2, Number(m[1]));
    return { min: latestSeason - n + 1, max: latestSeason };
  }
  return null;
}

const CAREER_RE = /\b(career|all[- ]time|ever|in history|all time)\b/;

// ---- Super Bowl and playoff-round references ----

const ROMAN_VAL: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };

function fromRoman(s: string): number | null {
  let out = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN_VAL[s[i]!];
    if (!v) return null;
    const next = ROMAN_VAL[s[i + 1] ?? ""] ?? 0;
    out += next > v ? -v : v;
  }
  return out > 0 && out < 100 ? out : null;
}

interface SbRef {
  /** Super Bowl number (SB 50 = 50) when the question named one. */
  number?: number;
  /** NFL season the game concluded (number - 1965, or year rules). */
  season?: number;
  /** Calendar year the user gave, when it needed the played-year shift. */
  playedYear?: number;
}

/** Recognize Super Bowl references: numbers, Roman numerals, calendar years
 * ("2024 Super Bowl" = the game played in Feb 2024 = the 2023 season), and
 * season phrasings ("the 2018 season's Super Bowl"). */
function sbRef(qText: string): SbRef | null {
  if (!/\bsuper ?bowls?\b|\bsb\b/.test(qText)) return null;
  let m = qText.match(/\b(?:super ?bowl|sb) (\d{1,2})\b/);
  if (m) {
    const num = Number(m[1]);
    return { number: num, season: 1965 + num };
  }
  m = qText.match(/\b(?:super ?bowl|sb) ([ivxlc]+)\b/);
  if (m) {
    const num = fromRoman(m[1]!);
    if (num) return { number: num, season: 1965 + num };
  }
  // "the 2018 season's Super Bowl" names the season outright.
  m = qText.match(/\b((?:19|20)\d{2}) season'?s? super ?bowl\b/);
  if (m) return { season: Number(m[1]) };
  m = qText.match(/\bsuper ?bowl (?:of|for) the ((?:19|20)\d{2}) season\b/);
  if (m) return { season: Number(m[1]) };
  // A calendar year next to "Super Bowl" means the February the game was
  // played, which concludes the PREVIOUS season.
  m =
    qText.match(/\b((?:19|20)\d{2}) super ?bowl\b/) ??
    qText.match(/\bsuper ?bowl (?:in |of )?((?:19|20)\d{2})\b/);
  if (m) {
    const year = Number(m[1]);
    return { season: year - 1, playedYear: year };
  }
  return {};
}

/** Playoff round vocabulary, plus conference for championship games. */
function detectRound(qText: string): { round: "WC" | "DIV" | "CON" | "SB"; conf?: "AFC" | "NFC" } | null {
  if (/\bsuper ?bowls?\b|\bthe big game\b/.test(qText)) return { round: "SB" };
  if (/\bwild ?card\b/.test(qText)) return { round: "WC" };
  if (/\bdivisional\b/.test(qText)) return { round: "DIV" };
  const conf = /\bafc\b/.test(qText) ? "AFC" : /\bnfc\b/.test(qText) ? "NFC" : undefined;
  if (/\b(?:conference|afc|nfc) championship\b/.test(qText)) {
    return { round: "CON", ...(conf ? { conf } : {}) };
  }
  // Bare "championship game" reads as the Super Bowl (the NFL's title game).
  if (/\bchampionship game\b/.test(qText)) return { round: "SB" };
  return null;
}

const MONTH_NUM: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

/** "october 20, 2024" / "oct 20 2024" -> "2024-10-20". */
function detectDate(qText: string): string | null {
  const m = qText.match(
    new RegExp(`\\b(${Object.keys(MONTH_NUM).join("|")})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? ((?:19|20)\\d{2})\\b`),
  );
  if (!m) return null;
  const mo = MONTH_NUM[m[1]!]!;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}
const ASC_RE = /\b(fewest|least|lowest|worst|bottom)\b/;

// ---- Vocabulary the warehouse genuinely can't answer (tailored refusals) ----

const UNSUPPORTED: [RegExp, string][] = [
  [
    /\b(qb hits?|hurries|pressures?)\b/,
    "Pressure stats beyond sacks aren't tracked yet. Sacks, tackles, forced fumbles and passes defended are.",
  ],
  [
    // Advanced metrics needing play-by-play or proprietary models. Simple
    // rates (yards per carry/attempt/reception, catch rate, per-game) and
    // air yards ARE computed — see the ratio stats and perGame modifier.
    /\b(qbr|third down|red ?zone|time of possession|dvoa|win probability|turnovers? forced)\b/,
    "QBR, DVOA and win probability are proprietary models and aren't tracked. EPA, CPOE, success rate, passer rating and the standard rates ARE computed.",
  ],
  [
    /\b(offense|offensive|defense|defensive|which team)\b/,
    "Team-unit rankings aren't queryable yet. Every team page ranks offense and defense against the whole league.",
  ],
  [
    // MVP and Super Bowl MVP ARE answered (curated facts table); the rest
    // would risk invented honors, which is worse than a refusal.
    /\b(pro bowl|all[- ]pro|hall of fame|ring of honor|retired (?:number|jersey)|rookie of the year|player of the year|opoy|dpoy|roty)\b/,
    "Only MVP and Super Bowl MVP awards are loaded so far — try \"who won MVP in 2023\". Other honors aren't in the warehouse.",
  ],
  [
    /\b(traded?|trades?|free agen(?:cy|ts?)|waivers?|waived|signed with|re-?signed|transactions?)\b/,
    "Transactions (trades, signings, waivers) aren't tracked. Drafts are: try \"where was Bryce Young drafted\".",
  ],
  [
    /\b(injur(?:y|ies|ed)|questionable|doubtful|injured reserve|out for the season)\b/,
    "Injury reports aren't tracked — the warehouse is historical stats and results.",
  ],
  [
    /\b(depth charts?|starter at|starters at|backup)\b/,
    "Depth charts aren't tracked. Team rosters are: try \"Chiefs roster 2023\".",
  ],
  [
    /\b(play[- ]by[- ]play|drive summar|snap counts?|every play)\b/,
    "Play-by-play detail isn't stored — box-score totals plus a touchdown log are. Scores, box scores and TD timelines are queryable.",
  ],
  [
    /\b(schedule|next game|tomorrow|tonight|upcoming)\b/,
    "I answer historical stats and results. For week-by-week scores, head to the Scores page.",
  ],
  [
    // Primetime and cold-weather splits ARE computed now (weekday/gametime
    // and kickoff temperature); these remaining situations aren't.
    /\b(thanksgiving|against winning teams|after (the )?bye|overtime|comeback|record when)\b/,
    "That game-situation split isn't tracked yet. I can filter by season, playoffs, home/away, weeks, months, primetime and cold weather.",
  ],
  [
    // Play-level distance — not stored; the warehouse is box-score totals plus
    // a touchdown log, not full play-by-play. Scoped to a play noun so it
    // doesn't swallow "longest career" (a different, generic-fallback case).
    /\blongest\s+(?:play|run|rush|reception|catch|pass|completion|field goal|fg|drive)\b/,
    "Only touchdown lengths are stored from play-by-play — try \"longest touchdown of 2023\". Other play distances aren't tracked.",
  ],
  [
    // Counting touchdowns BY length for a NAMED player isn't wired yet; the
    // league-wide boards ARE (scoring_board) and parse before this scan.
    /\b\d{1,3}[-\s]?(?:yard|yd)s? (?:(?:rushing|receiving|defensive) )?(?:touchdowns?|tds?)\b/,
    "Touchdown counts by play length are only supported league-wide so far — try \"most 1-yard touchdowns\" — or a player's touchdown timeline (\"Ja'Marr Chase first touchdown\").",
  ],
  [
    // "youngest/oldest TO <milestone>" needs age-at-game; "fastest to X" IS
    // answered (milestone intent). Bio superlatives are handled earlier.
    /\b(?:youngest|oldest) (?:to|player to|ever to)\b|\bon pace\b/,
    'Age-at-milestone questions aren\'t supported yet, but "fastest to" is: try "fastest to 10000 passing yards".',
  ],
  // Note: player bio, per-game rates, season ranges, league-wide counts and
  // rank lookups ARE answered now — see the player_bio / qualifying_count /
  // player_rank branches and the perGame / seasonMin-Max modifiers below.
];

export interface ParseOpts {
  /** Newest season in the warehouse — resolves "this season" phrasings. */
  latestSeason?: number | null;
  /** Team nickname/name index — used to answer team questions honestly. */
  teams?: Map<string, IndexedTeam>;
}

export function parseRules(
  question: string,
  entities: ResolvedEntity[],
  index: Map<string, IndexedPlayer>,
  opts: ParseOpts = {},
): ParseResult {
  const qText = question
    .toLowerCase()
    .replace(/\bsuperb owl\b/g, "super bowl")
    .replace(/\bthe big game\b/g, "the super bowl");
  const season = detectSeason(qText, opts.latestSeason ?? null);
  const isCareer = CAREER_RE.test(qText);
  // "in a season" / "in a single season" / "in one season": an all-time
  // single-season record, not the latest season — season scope, every year.
  const isSeasonRecord = /\bin (?:a|one|any)(?: single)? (?:season|year)\b/.test(qText);
  // "average"/"avg" reads as a per-game rate; ratio stats (yards per carry)
  // are already rates, so the flag is cleared for them at spec construction.
  const perGameCue = /\bper[- ]game\b|\baverages?\b|\bavg\b|\b(?:rolling|moving) average\b/.test(qText);
  const median = /\bmedian\b/.test(qText);
  const month = detectMonth(qText);
  const primetime =
    /\b(primetime|prime time|monday night|sunday night|thursday night|snf|mnf|tnf|night games?)\b/.test(qText);
  const tempMax = /\b(freezing|below freezing|in the cold|cold[- ]weather)\b/.test(qText) ? 32 : null;
  const filters = {
    venue: venue(qText),
    ...weekRange(qText),
    firstN: firstN(qText),
    lastN: lastN(qText),
    rookie: /\brookies?\b/.test(qText),
  };
  // "5-game rolling average" is a per-game rate over the last N games.
  const rollM = qText.match(/\b(\d{1,2})[- ]game (?:rolling|moving) average\b/);
  if (rollM || /\b(?:rolling|moving) average\b/.test(qText)) {
    filters.lastN = filters.lastN ?? (rollM ? Number(rollM[1]) : 5);
  }
  // Weeks past 18 only exist in the playoffs — asking about them IS asking
  // about the postseason. "Super Bowl" narrows further to the final game;
  // named rounds (wild card, divisional, championships) narrow to one week.
  const sb = sbRef(qText);
  const roundInfo = detectRound(qText);
  const sbOnly = roundInfo?.round === "SB" || /\bsuper ?bowls?\b/.test(qText);
  // A numbered/dated Super Bowl pins the season exactly.
  const sbSeason = sb?.season ?? null;
  const effSeason = sbSeason ?? season;
  const playerRound = roundInfo && roundInfo.round !== "SB" ? roundInfo.round : null;
  const seasonType =
    sbOnly || roundInfo != null || POST_KEYS.some((k) => qText.includes(k)) ||
    (filters.weekMin ?? 0) > 18
      ? "POST"
      : "REG";

  // "X versus Y" / "X and Y": head-to-head over the same scope.
  const halves = qText.split(VS_RE);
  if (halves.length === 2) {
    const p1 = playerHit(halves[0]!, index, opts.teams);
    const p2 = playerHit(halves[1]!, index, opts.teams);
    if (p1 && p2 && p1.playerId !== p2.playerId) {
      const stat = detectStat(qText) ?? primaryFor(PRIMARY_STAT, p1, p2);
      // Advanced pbp stats (EPA, air yards, success rate, CPOE) can't be summed
      // from the box-score aggregate COMPARE uses — refuse honestly rather than
      // silently answer with the wrong stat.
      if (!isComparableStat(stat)) {
        return {
          refusal:
            `I can't compare ${STATS[stat]?.label ?? stat} head-to-head yet — try a ` +
            `box-score stat like yards, touchdowns, completion percentage, or passer rating.`,
        };
      }
      return {
        intent: "compare",
        stat,
        player: p1.name,
        playerId: p1.playerId,
        player2: p2.name,
        player2Id: p2.playerId,
        season: effSeason,
        seasonType,
        sbOnly,
        firstN: firstN(halves[0]!) ?? firstN(halves[1]!),
        scope: "season",
        limit: 10,
      };
    }
  }

  // Three or more players ("compare Allen Mahomes Burrow") — be honest about
  // the two-at-a-time limit rather than silently dropping someone.
  const mentioned = allPlayerHits(qText, index, opts.teams);
  if (mentioned.length >= 3) {
    return {
      refusal:
        `I can compare two players at a time. Try "${mentioned[0]!.name} vs ` +
        `${mentioned[1]!.name}" first.`,
    };
  }

  // Prefer a resolved entity (works for any player in the DB); fall back to
  // the whole-word index hit.
  let player: IndexedPlayer | null = null;
  const resolved = entities.find((e) => e.entity_type === "player");
  if (resolved) {
    player = {
      playerId: resolved.canonical_id,
      name: resolved.display_name,
      position: index.get(resolved.display_name.toLowerCase())?.position ?? null,
    };
  } else {
    player = playerHit(qText, index, opts.teams) ?? (mentioned.length > 0 ? mentioned[0]! : null);
  }

  // ---- Teammate combos ("Josh Allen passer rating with Stefon Diggs") ----
  // Split on with/alongside; when BOTH halves name distinct players, the
  // first half's player is the subject (never the more-prominent teammate)
  // and the second becomes the with-window. Threshold phrasings ("games with
  // at least 3 TDs") are unaffected — their second half names no player.
  let withMate: IndexedPlayer | null = null;
  let pairingApprox = false;
  // Targeting words — shared by the with-branch (a teammate that rode a
  // targeting word inside a with-clause still needs the disclosure) and the
  // standalone targeting branch below.
  const TO_RE = /\s+(?:targeting|thrown to|throwing to|passes to|to|from)\s+/;
  {
    // The teammate rides the LAST with-clause ("games with 3 TDs with Chase"
    // has a threshold "with" first) — everything before it is the subject.
    const halves = qText.split(/\s+(?:with|alongside)\s+/);
    if (halves.length >= 2) {
      const p2 = playerHit(halves.at(-1)!, index, opts.teams);
      if (p2) {
        const p1 = playerHit(halves.slice(0, -1).join(" with "), index, opts.teams);
        if (p1 && p1.playerId !== p2.playerId) {
          player = p1;
          withMate = p2;
          // "games with 2 passing touchdowns TO chase": the teammate sits
          // behind a targeting word inside the with-half — that's still a
          // targeting ask, so the approximation must be disclosed.
          const tail = halves.at(-1)!.split(TO_RE);
          if (
            tail.length >= 2 &&
            playerHit(tail.slice(1).join(" to "), index, opts.teams)?.playerId === p2.playerId
          ) {
            pairingApprox = true;
          }
        } else if (!p1) {
          return {
            refusal:
              `Teammate splits only work on a named player's stats so far — ` +
              `try "Patrick Mahomes passing yards with ${p2.name}".`,
          };
        }
      }
    }
    // Targeting phrasings ("Burrow passing yards to Chase", "Chase yards
    // from Burrow"): true passer→receiver pairing needs play-by-play the
    // warehouse doesn't carry. Deterministic stand-in: the subject's stats
    // in games the named partner also appeared in — the same with-window,
    // with the approximation disclosed in narration via pairingApprox.
    // ponytail: appeared-together, not target-paired — upgrade to exact
    // splits when pbp lands.
    const toHalves = qText.split(TO_RE);
    if (!withMate && toHalves.length >= 2) {
      const target = playerHit(toHalves.slice(1).join(" to "), index, opts.teams);
      const subject = playerHit(toHalves[0]!, index, opts.teams);
      if (target && subject && target.playerId !== subject.playerId) {
        player = subject;
        withMate = target;
        pairingApprox = true;
      } else if (target && !subject && /\b(?:who|most|top|leaders?)\b/.test(toHalves[0]!)) {
        // "Who threw the most touchdowns TO Kelce" — a passer board keyed on
        // the target. Without pass-target pairing the played-together
        // stand-in has no subject to attach to, and letting the fallback
        // make the TARGET the subject answers a different question with a
        // confident wrong number. Refuse by name instead.
        return {
          refusal:
            `Ranking passers by their production to ${target.name} needs pass-target ` +
            `pairing the warehouse doesn't carry. Try a named passer instead — ` +
            `"Patrick Mahomes touchdowns with ${target.name}".`,
        };
      }
    }
  }

  // ---- Opponent splits ("Mahomes passer rating vs the Bills") ----
  // The opponent rides a vs/versus/against clause naming a team. The
  // executor predicate (gamePreds opponentId) predates this; the parser just
  // never fed it outside game logs. Player-vs-player already returned above
  // as a compare, so a surviving vs-clause here names a team or nothing.
  // Lockstep: audit.ts vs-team qualifier rule.
  let vsOpp: IndexedTeam | null = null;
  if (player && opts.teams) {
    const oppHalves = qText.split(/\s+(?:vs\.?|versus|against)\s+/);
    if (oppHalves.length >= 2) {
      vsOpp = teamHit(oppHalves.slice(1).join(" "), opts.teams);
    }
  }

  // ---- Draft questions ("who was the first pick 2025", "when was X drafted",
  // "who did the chiefs draft in round 1") ----
  const draftCue =
    /\bdraft(?:ed|s)?\b/.test(qText) ||
    /\b(?:first|second|third|\d{1,2}(?:st|nd|rd|th)) round picks?\b/.test(qText);
  const overallPick = ((): number | null => {
    let m = qText.match(/\b(\d{1,3})(?:st|nd|rd|th) (?:overall )?pick\b/);
    if (m) return Number(m[1]);
    m = qText.match(/\bpick (\d{1,3})\b/);
    if (m && draftCue) return Number(m[1]);
    if (/\b(?:first|1st|#\s?1|number one) (?:overall )?pick\b(?! six)/.test(qText)) return 1;
    if (/\b(?:first|1st) overall\b/.test(qText)) return 1;
    if (/\bsecond (?:overall )?pick\b/.test(qText)) return 2;
    if (/\bthird (?:overall )?pick\b/.test(qText)) return 3;
    return null;
  })();
  if (draftCue || overallPick != null) {
    const roundM = qText.match(/\b(?:round (\d{1,2})|(\d{1,2})(?:st|nd|rd|th) round|first round)\b/);
    const draftRound = roundM ? Number(roundM[1] ?? roundM[2] ?? 1) : null;
    const draftTeam = opts.teams ? teamHit(qText, opts.teams) : null;
    if (player && draftCue) {
      return {
        intent: "draft_pick", stat: "total_tds", player: player.name,
        playerId: player.playerId, seasonType: "REG", scope: "career", limit: 1,
      };
    }
    if (overallPick != null || (draftTeam && draftCue) || (draftCue && season != null)) {
      return {
        intent: "draft_pick", stat: "total_tds", seasonType: "REG", scope: "season",
        season, draftPick: overallPick, draftRound,
        teamId: draftTeam?.teamId ?? null, teamName: draftTeam?.name ?? null,
        limit: overallPick != null ? 1 : 40,
      };
    }
  }

  // ---- Player bio / roster ("what team does X play for", "how old is X") —
  // answered straight from the players dimension. Runs before the team-unit
  // refusal so "what team does <player> play for" resolves to the player. ----
  const bioField = bioFieldOf(qText);
  if (player && bioField) {
    return {
      intent: "player_bio", stat: "total_tds", bioField,
      player: player.name, playerId: player.playerId,
      seasonType: "REG", scope: "career", limit: 1,
    };
  }

  // ---- Game results and game logs (teams and Super Bowls) ----
  const teams = opts.teams;
  const resultCue =
    /\b(result|results|score|final|who won|won|winners?|beat|defeated?|happened|played|decided by)\b/.test(qText);
  const logCue =
    /\b(game ?log|game[- ]by[- ]game|results|appearances?|history|record|games)\b/.test(qText);
  const gameDate = detectDate(qText);

  // Single-game superlatives ("most passing yards in a game vs the bills")
  // must not read "game vs" as a game-log ask — hoisted here so the log
  // branch below can defer to the single_game branch. The "in a … game"
  // regex allows up to two adjectives ("in a playoff game", "in a road
  // game") — a literal "in a game" match silently answered career TOTALS
  // for best-single-game asks. "In a super bowl" is a single game too;
  // "in THE super bowl" stays a career window (sbOnly).
  const isSingleGame =
    (qText.includes("game") &&
      (qText.includes("single") ||
        qText.includes("one game") ||
        /\bin an? (?:[\w-]+ ){0,2}game\b/.test(qText))) ||
    /\bin a super ?bowl\b/.test(qText);

  // Player game log: "mahomes super bowl game log", "jefferson games against
  // green bay". Generic words like "record" never route a player here.
  if (player && !isSingleGame &&
      (/\bgame ?log\b/.test(qText) || /\bgames? (?:against|vs\.?)\b/.test(qText))) {
    const opp = teams ? teamHit(qText, teams) : null;
    return {
      intent: "game_log", stat: "total_tds",
      player: player.name, playerId: player.playerId, position: player.position,
      season: effSeason, seasonType, sbOnly, round: playerRound, month, primetime, tempMax,
      opponentId: opp?.teamId ?? null, team2Name: opp?.name ?? null,
      venue: filters.venue, weekMin: filters.weekMin ?? null, weekMax: filters.weekMax ?? null,
      firstN: filters.firstN, lastN: filters.lastN,
      scope: effSeason != null ? "season" : "career", limit: 50,
    };
  }

  // No team needed: "who won Super Bowl 50?", "Super Bowl winners",
  // "what happened in the AFC championship?", "all Super Bowls decided by 3".
  if (
    !player && roundInfo &&
    (resultCue || sb?.number != null || sbSeason != null) &&
    detectStat(qText) === null && genericCue(qText) === null &&
    !/\bmvps?\b/.test(qText) // "super bowl MVP" is an award, not a result
  ) {
    const marginM = qText.match(/\bdecided by (\d{1,2})(?: points)?(?: or (?:fewer|less))?\b/);
    const wantsAll =
      /\b(all|every|each) super ?bowls?\b/.test(qText) ||
      /\bwinners\b/.test(qText) ||
      marginM != null;
    const anchoredTeam = teams ? teamHit(qText, teams) : null;
    if (!anchoredTeam) {
      return {
        intent: "game_result", stat: "total_tds",
        round: roundInfo.round, conf: roundInfo.conf ?? null,
        season: wantsAll ? null : (effSeason ?? null),
        seasonType: "POST",
        marginMax: marginM ? Number(marginM[1]) : null,
        scope: "season", limit: wantsAll ? 30 : 1,
      };
    }
  }

  // Awards: MVP / Super Bowl MVP from the curated facts table.
  if (/\bmvps?\b/.test(qText)) {
    const award = /\bsuper ?bowl mvp\b|\bsb mvp\b/.test(qText) ? ("SBMVP" as const) : ("MVP" as const);
    return {
      intent: "award", award, stat: "total_tds",
      season: player ? null : effSeason,
      player: player?.name ?? null, playerId: player?.playerId ?? null,
      seasonType: "REG", scope: "career", limit: 30,
    };
  }

  // ---- Scoring boards over the touchdown log: counts by TD distance
  // ("most 1-yard touchdowns", "of 50 or more yards", "inside the 5") and
  // the defensive-return boards (pick sixes, fumble returns). League-wide
  // only — player-scoped distance counts stay honest refusals, and a team
  // mention falls through to the team shapes. Must run before the
  // UNSUPPORTED scan, which still refuses this vocabulary elsewhere. ----
  if (!player && !(opts.teams && teamHit(qText, opts.teams))) {
    const board = scoringBoardFilters(qText);
    if (board) {
      const range = seasonRange(qText, opts.latestSeason ?? null);
      return {
        intent: "scoring_board", stat: "total_tds", ...board,
        season: range ? null : effSeason,
        seasonMin: range?.min ?? null, seasonMax: range?.max ?? null,
        seasonType, sbOnly, round: playerRound, month, primetime, tempMax,
        venue: filters.venue,
        weekMin: filters.weekMin ?? null, weekMax: filters.weekMax ?? null,
        scope: range || effSeason == null ? "career" : "season",
        limit: topN(qText) ?? 10,
      };
    }
  }

  // Vocabulary we recognize but genuinely can't answer — say so, usefully.
  // A captured vs-team opponent legitimizes "vs the bills defense": the unit
  // word names the opponent, not a team-unit ranking ask, so it's dropped
  // from the scan.
  const scanText = vsOpp
    ? qText.replace(/\b(?:offense|offensive|defense|defensive)\b/g, " ")
    : qText;
  for (const [re, message] of UNSUPPORTED) {
    if (re.test(scanText)) return { refusal: message };
  }

  if (!player && teams) {
    // Two teams in one question: a matchup result, from the perspective of
    // the first team mentioned.
    const [t1, t2] = teamHits(qText, teams);
    const single =
      /\b(last|latest|most recent|who won|final score|score of|result)\b/.test(qText) &&
      !/\b(all|every|each)\b/.test(qText);
    // Team-info phrasings ("where do the packers play", "who played for the
    // bills", "how many points did the chiefs score") must reach the
    // team_bio/team_roster/team_stat branches below, not a game lookup —
    // even though they contain result/log vocabulary ("play", "score").
    const infoCue =
      /\bstadium\b|\bhome field\b|\bwhere do(?:es)?\b.*\bplay\b|\bplay (?:their )?home games\b|\broster\b|\bwho play(?:s|ed) for\b|\bplayers on\b|\bhow many points\b|\bpoints? (?:did|scored|allowed|for|against|per game)\b/.test(
        qText,
      );

    if (t1 && t2 && t2.teamId !== t1.teamId && (resultCue || logCue || sbOnly || roundInfo)) {
      return {
        intent: "game_result", stat: "total_tds",
        teamId: t1.teamId, teamName: t1.name, team2Id: t2.teamId, team2Name: t2.name,
        season: effSeason, seasonType, round: roundInfo?.round ?? null,
        conf: roundInfo?.conf ?? null,
        weekMin: filters.weekMin ?? null, weekMax: filters.weekMax ?? null,
        gameDate, scope: "season", limit: single ? 1 : 10,
      };
    }

    if (t1) {
      // One team + Super Bowl: their whole Super Bowl history.
      if (sbOnly) {
        return {
          intent: "team_game_log", stat: "total_tds",
          teamId: t1.teamId, teamName: t1.name, round: "SB",
          season: sbSeason, seasonType: "POST", scope: "career", limit: 20,
        };
      }
      // "ravens last game", "packers game on october 20, 2024",
      // "what was the score of the eagles game".
      if (/\blast game\b/.test(qText) || gameDate || (resultCue && !logCue && !infoCue)) {
        return {
          intent: "game_result", stat: "total_tds",
          teamId: t1.teamId, teamName: t1.name,
          season: effSeason, seasonType, round: roundInfo?.round ?? null,
          conf: roundInfo?.conf ?? null, gameDate,
          weekMin: filters.weekMin ?? null, weekMax: filters.weekMax ?? null,
          scope: "season", limit: 1,
        };
      }
      // Team game log: "bills 2024 game log", "chiefs playoff results",
      // "lions last ten games", "chiefs games decided by 7 or less".
      const marginM = qText.match(/\bdecided by (\d{1,2})(?: points)?(?: or (?:fewer|less))?\b/);
      if ((logCue || filters.lastN || marginM) && !infoCue) {
        const post = seasonType === "POST";
        return {
          intent: "team_game_log", stat: "total_tds",
          teamId: t1.teamId, teamName: t1.name, lastN: filters.lastN,
          round: roundInfo?.round ?? null, conf: roundInfo?.conf ?? null,
          marginMax: marginM ? Number(marginM[1]) : null,
          season:
            effSeason ??
            (isCareer || post || filters.lastN || marginM ? null : (opts.latestSeason ?? null)),
          seasonType, venue: filters.venue,
          weekMin: filters.weekMin ?? null, weekMax: filters.weekMax ?? null,
          scope: isCareer ? "career" : "season",
          limit: filters.lastN ?? (marginM ? 60 : 30),
        };
      }
    }

  }

  // Team questions answered from the warehouse: identity (division /
  // conference / stadium), roster, team leaders, and team stat totals.
  // Anything else team-shaped points to the team page by name.
  if (!player && opts.teams) {
    const team = teamHit(qText, opts.teams);
    if (team) {
      const tStat = detectStat(qText);
      const tRange = seasonRange(qText, opts.latestSeason ?? null);
      // Identity: "what division are the chiefs in", "chiefs stadium".
      // Round mentions ("AFC conference championship") are game questions.
      const teamField =
        !roundInfo && /\bdivisions?\b/.test(qText) ? ("division" as const)
          : !roundInfo && /\bconference\b/.test(qText) ? ("conference" as const)
            : /\bstadium\b|\bplay (?:their )?home games\b|\bhome field\b/.test(qText)
              ? ("stadium" as const)
              : /\bcoach(?:ed|es)?\b|\bhead coach\b/.test(qText) ? ("coach" as const)
                : /\bcolors?\b/.test(qText) ? ("colors" as const)
                  : /\bfounded\b|\bestablished\b/.test(qText) ? ("founded" as const)
                    : /\brelocat|\brenamed?\b|\bname change\b|\bfranchise history\b|\bused to be\b/.test(qText)
                      ? ("history" as const)
                      : null;
      if (teamField) {
        return {
          intent: "team_bio", stat: "total_tds", teamField,
          teamId: team.teamId, teamName: team.name,
          seasonType: "REG", scope: "career", limit: 1,
        };
      }
      // Streaks: "chiefs winning streak", "how long is the jets losing streak".
      if (/\bstreaks?\b/.test(qText)) {
        return {
          intent: "team_streak", stat: "total_tds",
          teamId: team.teamId, teamName: team.name,
          kind: /\blos(?:s|ing|t)\b/.test(qText) ? "loss" : "win",
          seasonType: "REG", scope: "career", limit: 400,
        };
      }
      // Roster: "chiefs roster 2023", "who played for the chiefs in 2023".
      if (/\broster\b|\bwho play(?:s|ed) for\b|\bplayers on\b/.test(qText)) {
        return {
          intent: "team_roster", stat: "total_tds",
          teamId: team.teamId, teamName: team.name,
          season: effSeason ?? opts.latestSeason ?? null,
          position: detectPosition(qText),
          seasonType: "REG", scope: "season", limit: 60,
        };
      }
      // Team leaders: "who led the chiefs in receiving yards in 2023".
      if (tStat && /\b(led|leads|leader|leaders|most|top|best)\b/.test(qText)) {
        return {
          intent: "leaders", stat: tStat,
          teamId: team.teamId, teamName: team.name,
          season: tRange ? null : (effSeason ?? (isCareer || isSeasonRecord ? null : (opts.latestSeason ?? null))),
          seasonMin: tRange?.min ?? null, seasonMax: tRange?.max ?? null,
          seasonType, sbOnly, month,
          position: detectPosition(qText),
          perGame: perGameCue && !STATS[tStat]?.ratio,
          dir: ASC_RE.test(qText) ? "asc" : "desc",
          scope: tRange || isCareer ? "career" : "season",
          limit: topN(qText) ?? 5,
        };
      }
      // Team totals: "how many points did the chiefs score in 2023",
      // "chiefs passing yards in 2023", "chiefs points allowed per game".
      const pointsCue = !tStat && /\bpoints?\b/.test(qText);
      if (tStat || pointsCue) {
        const metric = pointsCue
          ? /\ballowed\b|\bgiven? up\b|\bgave up\b|\bconceded\b|\bagainst\b/.test(qText)
            ? ("points_against" as const)
            : ("points_for" as const)
          : null;
        return {
          intent: "team_stat", stat: tStat ?? "total_tds", metric,
          teamId: team.teamId, teamName: team.name,
          season: tRange ? null : effSeason,
          seasonMin: tRange?.min ?? null, seasonMax: tRange?.max ?? null,
          seasonType, perGame: perGameCue,
          perDrive: /\bper drive\b/.test(qText),
          scope: tRange || isCareer || effSeason == null ? "career" : "season",
          limit: 1,
        };
      }
      return {
        refusal:
          `That team question isn't queryable yet. The ${team.name} page has ` +
          `their record, rankings and leaders; I can answer their points, ` +
          `yards, roster, division and stadium here.`,
      };
    }
  }

  // Scoring events: "Henry's first touchdown", "when did Adams last score".
  // A touchdown cue plus a timeline word (or "when did...") asks WHICH GAME
  // it happened in, not for a count. "last season"/"last year"/"last N games"
  // stay scope phrasings, not timeline words.
  if (player) {
    const tdCue = /\b(touchdowns?|tds?|scored?|scoring)\b/.test(qText);
    const edge = /\b(?:latest|most recent)\b|\blast\b(?! (?:season|year|\d|game))/.test(qText)
      ? ("last" as const)
      : /\bfirst\b/.test(qText) && filters.firstN === null
        ? ("first" as const)
        : null;
    const wantsWhen = /\bwhen did\b|\bwhat (?:day|date|game)\b/.test(qText);
    if (tdCue && (edge !== null || wantsWhen)) {
      return {
        intent: "scoring",
        stat: "total_tds",
        player: player.name,
        playerId: player.playerId,
        season: effSeason,
        seasonType,
        sbOnly,
        edge,
        scope: "career",
        limit: edge ? 1 : 10,
      };
    }
  }

  // Position filter: "best qb", "top 10 WRs", "best rushing QB this season".
  let position: string | null = null;
  for (const [re, pos] of POSITION_WORDS) {
    if (re.test(qText)) {
      position = pos;
      break;
    }
  }

  // Bio superlative ("tallest player", "oldest quarterback") — no stat, so it
  // must resolve before the stat-required shapes below.
  const bioSup = bioSuperlative(qText);
  if (!player && bioSup) {
    return {
      intent: "player_bio", stat: "total_tds", bioField: bioSup.field,
      dir: bioSup.dir, position, seasonType: "REG", scope: "career",
      limit: topN(qText) ?? 5,
    };
  }

  // Stat: specific vocabulary first, then generic cues resolved by context,
  // then the player's (or position's) primary stat.
  let stat = detectStat(qText);
  // Bare "air yards" picks a side of the ball from the player/position —
  // before the generic "yards" cue would swallow it as regular yardage.
  if (stat === null && /\bair yards\b/.test(qText)) {
    stat = (player?.position ?? position) === "QB" ? "passing_air_yards" : "receiving_air_yards";
  }
  // Same for the pbp-derived metrics: role picked by position.
  if (stat === null && /\bepa\b|\bexpected points( added)?\b/.test(qText)) {
    const pos = player?.position ?? position;
    stat = pos === "QB" ? "passing_epa" : pos === "RB" ? "rushing_epa" : pos ? "receiving_epa" : "passing_epa";
  }
  if (stat === null && /\bsuccess rate\b/.test(qText)) {
    const pos = player?.position ?? position;
    stat = pos === "QB" ? "pass_success_rate" : pos === "RB" ? "rush_success_rate" : pos ? "recv_success_rate" : "pass_success_rate";
  }
  if (stat === null) {
    const cue = genericCue(qText);
    const pos = player?.position ?? position ?? "";
    if (cue === "tds") stat = PRIMARY_TD[pos] ?? "total_tds";
    else if (cue === "yards") stat = PRIMARY_STAT[pos] ?? "scrimmage_yards";
  }
  // A QB asked about "sacks" means sacks TAKEN, not defensive sacks.
  if (stat === "def_sacks" && player?.position === "QB") stat = "sacks_taken";
  // A truly bare player mention ("Patrick Mahomes", "show me mahomes stats")
  // asks about the player, not one number: show the season-by-season line.
  // Any leftover token (a year, "career", "playoffs", a stat word…) falls
  // through to the existing shapes.
  if (stat === null && player) {
    // Fold punctuation the way users type names: "A.J." matches "aj",
    // "Amon-Ra St. Brown" matches "amon ra st brown".
    const nameTokens = new Set(
      player.name.toLowerCase().replace(/[.'’]/g, "").replace(/-/g, " ").split(/\s+/),
    );
    const pid = player.playerId;
    const leftover = qText
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter(
        (w) =>
          !nameTokens.has(w) && !BARE_FILLER.has(w) &&
          index.get(w)?.playerId !== pid,
      );
    if (leftover.length === 0) {
      return {
        intent: "player_seasons",
        stat: PRIMARY_STAT[player.position ?? ""] ?? "scrimmage_yards",
        player: player.name,
        playerId: player.playerId,
        position: player.position,
        seasonType: "REG",
        scope: "career",
        limit: 30,
      };
    }
  }

  // A player plus stat vocabulary elsewhere in the question keeps the
  // primary-production-stat fallback.
  if (stat === null && player) {
    stat = PRIMARY_STAT[player.position ?? ""] ?? "scrimmage_yards";
  }
  // A bare position ("best qb", "top wr") ranks by its primary stat.
  if (stat === null && position) {
    stat = PRIMARY_STAT[position]!;
  }
  if (stat === null) return null;

  const limit = topN(qText);
  const th = threshold(qText);
  // pbp-derived stats live in a separate table; threshold/single-game/streak
  // shapes stay off it (their SQL targets player_game_stats).
  const advStat = STATS[stat]?.table === "advanced";
  const perGame = perGameCue && !STATS[stat]?.ratio;
  const range = seasonRange(qText, opts.latestSeason ?? null);

  // League rank of one player ("where does Mahomes rank in career passing yards").
  const rankCue =
    /\bwhere (?:do|does|did)\b[^?]*\brank\b|\brank(?:s|ed|ing)?\b|\bwhat (?:number|place)\b/.test(qText);
  if (player && rankCue) {
    return {
      intent: "player_rank", stat, player: player.name, playerId: player.playerId,
      season: range ? null : effSeason, seasonMin: range?.min ?? null, seasonMax: range?.max ?? null,
      seasonType, position,
      scope: isCareer || (effSeason == null && !range) ? "career" : "season",
      limit: 1,
    };
  }

  // League-wide qualifying count ("how many players had 1000 rushing yards in 2023").
  const leagueCountCue =
    /\bhow many (?:players|guys|quarterbacks|qbs|running backs|rbs|receivers|wrs|tes|tight ends)\b/.test(qText);
  const lcThreshold = th ?? countThreshold(qText);
  if (!player && leagueCountCue && lcThreshold && !advStat) {
    return {
      intent: "qualifying_count", stat, threshold: lcThreshold,
      season: effSeason, seasonType, position,
      scope: isCareer || effSeason == null ? "career" : "season", limit: 1,
    };
  }

  // Longest touchdowns by play length ("longest touchdown of 2023").
  if (/\blongest\b.*\b(?:touchdowns?|tds?)\b|\b(?:touchdowns?|tds?)\b.*\blongest\b/.test(qText)) {
    return {
      intent: "scoring", stat: "total_tds", longest: true,
      player: player?.name ?? null, playerId: player?.playerId ?? null,
      season: effSeason, seasonType, scope: "season", limit: limit ?? 5,
    };
  }

  // Streaks: "games in a row with a touchdown", "consecutive 100-yard games".
  if (!advStat && /\bin a row\b|\bconsecutive\b|\bstreaks?\b/.test(qText)) {
    if (player) {
      return {
        intent: "player_streak", stat,
        player: player.name, playerId: player.playerId,
        threshold: th, season: effSeason, seasonType,
        scope: isCareer || effSeason === null ? "career" : "season", limit: 500,
      };
    }
    return {
      refusal:
        'League-wide streak boards aren\'t supported yet. Ask one player\'s streak ' +
        '("Henry games in a row with a rushing TD") or a team\'s winning streak.',
    };
  }

  // Milestone races: "fastest to 10000 passing yards".
  const fastM = qText.match(/\bfastest to ([\d,]+)\b/);
  if (fastM && !player) {
    return {
      intent: "milestone", stat, target: Number(fastM[1]!.replace(/,/g, "")),
      season: null, seasonType, scope: "career", limit: limit ?? 5,
    };
  }

  // League-wide medians would need a population definition; player medians work.
  if (median && !player) {
    return {
      refusal:
        'League-wide medians aren\'t supported yet. Ask one player\'s median game, ' +
        'like "Derrick Henry median rushing yards in 2023".',
    };
  }

  // Qualifying-game count leaderboard: "who has the most games with over 300
  // passing yards", "which QB had the most games with a passer rating over
  // 100", "most 100-yard rushing games after turning 30".
  const ageM = qText.match(/\bafter turning (\d{2})\b/);
  // Max-age filters ("before turning 25", "before age 25") have no spec
  // field anywhere — refuse before any shape can silently drop the
  // qualifier (the audit guard backstops paths that return earlier).
  if (/\bbefore (?:turning|age) \d{1,2}\b/.test(qText)) {
    return {
      refusal:
        'Maximum-age filters ("before turning 25") aren\'t supported yet — ' +
        'age splits only work as "after turning N".',
    };
  }
  // Single source for every "before his Nth season" / "first N seasons"
  // phrasing — consumed by game_count_leaders and the leaders window below.
  const beforeSeasonN = seasonWindowN(qText);
  // "and still won" / compound same-game TD filters ride the same
  // qualifying-games board: a numeric threshold on one stat (th), or an
  // implicit >=1-each pair from compoundTdFilter (no digit in the question
  // at all, e.g. "both a rushing and receiving touchdown").
  const rf = resultFilters(qText);
  const compoundTd = compoundTdFilter(qText);
  if (!player && (th || compoundTd) && !advStat && /\bmost\b[^.?]*\bgames\b/.test(qText)) {
    return {
      intent: "game_count_leaders",
      stat: compoundTd?.stat ?? stat,
      threshold: compoundTd ? { op: ">=", value: 1 } : th!,
      andStat: compoundTd?.andStat ?? null,
      andThreshold: compoundTd ? { op: ">=", value: 1 } : null,
      position,
      season: range ? null : effSeason,
      seasonMin: range?.min ?? null,
      seasonMax: range?.max ?? null,
      seasonType,
      sbOnly,
      month,
      primetime,
      tempMax,
      venue: filters.venue,
      weekMin: filters.weekMin ?? null,
      weekMax: filters.weekMax ?? null,
      minAgeYears: ageM ? Number(ageM[1]) : null,
      beforeSeasonN,
      gameResult: rf.gameResult,
      oneScore: rf.oneScore,
      scope: isCareer || range || effSeason == null ? "career" : "season",
      limit: limit ?? 10,
    };
  }
  // Cumulative-window leaderboards, no named player: "who scored the most
  // touchdowns through his first 50 career games", "most rushing yards in
  // his first three NFL seasons", "which QB had the most rushing yards in
  // his first five seasons", "first 10 playoff games", "most rushing yards
  // after turning 30", "in games his team lost", "in one-score games",
  // "against teams with winning records", "against a single opponent",
  // "without a 1,500-yard season", "without ever leading the league",
  // "without scoring a touchdown", "with fewer than N career X". The windows
  // combine as AND filters in the executor, so every phrase present lands
  // on the spec — never first-match-wins. Same forced-career idiom as the
  // age/season windows: a single-season snapshot isn't what any of these
  // ask for.
  const oppWinningRecord = OPP_RECORD_RE.test(qText);
  const perOpponent = PER_OPPONENT_RE.test(qText);
  // The season-exclusion negations aggregate player_season_stats directly
  // (MAX/per-season league max of the stat's own expr), so they only exist
  // for plain season-rollup stats — for anything else (ratio, formula,
  // game-only like carries) the field stays null and the audit guard
  // refuses instead of emitting SQL over a column the rollup doesn't have.
  const withoutSeason = isSeasonRollupStat(stat) ? withoutSeasonAtLeast(qText, stat) : null;
  const withoutLead = WITHOUT_LEAGUE_LEAD_RE.test(qText) && isSeasonRollupStat(stat);
  const cross = withoutTdCrossStat(qText, stat) ?? crossStatBelow(qText, stat);
  if (!player) {
    const gamesWin = firstNGamesWindow(qText);
    if (
      gamesWin || beforeSeasonN != null || ageM ||
      rf.gameResult != null || rf.oneScore || oppWinningRecord || perOpponent ||
      withoutSeason != null || withoutLead || cross != null
    ) {
      return {
        intent: "leaders",
        stat,
        firstN: gamesWin?.n ?? null,
        startsPhrase: gamesWin?.starts ?? false,
        beforeSeasonN,
        minAgeYears: ageM ? Number(ageM[1]) : null,
        gameResult: rf.gameResult,
        oneScore: rf.oneScore,
        oppWinningRecord,
        perOpponent,
        withoutSeasonAtLeast: withoutSeason,
        withoutLeagueLead: withoutLead,
        crossStat: cross?.crossStat ?? null,
        crossOp: cross?.crossOp ?? null,
        crossValue: cross?.crossValue ?? null,
        position,
        seasonType,
        sbOnly,
        // These windows all reach the game log via gamePreds() in the
        // executor (leadersSql calls it on every branch below the ones this
        // shape can trigger), so every one of them must land on the spec too
        // — dropping any here would mean the executor silently narrows the
        // question further than the narration says ("in 2019" answered
        // all-time). Same season/range convention as the plain leaders
        // fallback: a bare range widens to career, a pinned season narrows.
        season: range ? null : effSeason,
        seasonMin: range?.min ?? null,
        seasonMax: range?.max ?? null,
        month,
        venue: filters.venue,
        weekMin: filters.weekMin ?? null,
        weekMax: filters.weekMax ?? null,
        primetime,
        tempMax,
        dir: ASC_RE.test(qText) ? "asc" : "desc",
        scope: "career",
        limit: limit ?? 25,
      };
    }
  }

  // Age/experience splits on a NAMED player's totals aren't wired yet —
  // refuse rather than silently ignoring the filter (the league-wide
  // leaderboard and qualifying-game-board forms above are the supported
  // shapes).
  if (ageM || beforeSeasonN != null) {
    return {
      refusal:
        'Age and experience splits on a named player\'s totals aren\'t supported yet ' +
        '— try the leaderboard form instead, like "most rushing yards after turning 30" ' +
        'or "most 100-yard rushing games after turning 30" (a qualifying-game board).',
    };
  }

  // Qualifying-game counts: "Lamar games over 300 passing yards",
  // "Derrick Henry 100+ rushing yard games".
  if (player && th && !isSingleGame && !advStat) {
    return {
      intent: "game_count",
      stat,
      withPlayerId: withMate?.playerId ?? null,
      withPlayer: withMate?.name ?? null,
      pairingApprox,
      opponentId: vsOpp?.teamId ?? null,
      opponentName: vsOpp?.name ?? null,
      player: player.name,
      playerId: player.playerId,
      season: range ? null : effSeason,
      seasonMin: range?.min ?? null,
      seasonMax: range?.max ?? null,
      seasonType,
      sbOnly,
      month,
      primetime,
      tempMax,
      threshold: th,
      venue: filters.venue,
      weekMin: filters.weekMin ?? null,
      weekMax: filters.weekMax ?? null,
      scope: isCareer || range || effSeason === null ? "career" : "season",
      limit: 25,
    };
  }

  if (isSingleGame && !advStat) {
    // Scope to the named player when the question named one ("Derrick Henry
    // most rushing yards in a game"); otherwise a league-wide single-game
    // board. The executor composes every game window via gamePreds, so the
    // teammate/opponent/venue filters ride along instead of refusing.
    return {
      intent: "single_game", stat, seasonType, limit: limit ?? 5,
      scope: "season", season: effSeason,
      player: player?.name ?? null,
      playerId: player?.playerId ?? null,
      withPlayerId: withMate?.playerId ?? null,
      withPlayer: withMate?.name ?? null,
      pairingApprox,
      opponentId: vsOpp?.teamId ?? null,
      opponentName: vsOpp?.name ?? null,
      sbOnly, round: playerRound, month, primetime, tempMax,
      venue: filters.venue,
      weekMin: filters.weekMin ?? null,
      weekMax: filters.weekMax ?? null,
    };
  }

  if (player) {
    return {
      intent: "player_total",
      stat,
      withPlayerId: withMate?.playerId ?? null,
      withPlayer: withMate?.name ?? null,
      pairingApprox,
      opponentId: vsOpp?.teamId ?? null,
      opponentName: vsOpp?.name ?? null,
      player: player.name,
      playerId: player.playerId,
      season: range ? null : effSeason,
      seasonMin: range?.min ?? null,
      seasonMax: range?.max ?? null,
      perGame,
      median,
      month,
      primetime,
      tempMax,
      round: playerRound,
      seasonType,
      sbOnly,
      firstN: filters.firstN,
      lastN: filters.lastN,
      venue: filters.venue,
      weekMin: filters.weekMin ?? null,
      weekMax: filters.weekMax ?? null,
      rookie: filters.rookie,
      // A named player's total honors the same result/margin/opponent-record
      // filters as the league-wide boards — gamePreds and needsGameLog
      // already consume them, so a question like "Henry rushing yards in
      // games his team lost" answers, not just the leaderless leaderboard
      // form (q17-style).
      gameResult: rf.gameResult,
      oneScore: rf.oneScore,
      oppWinningRecord,
      scope:
        range || isCareer || effSeason === null
          ? "career"
          : filters.rookie || effSeason !== null
            ? "season"
            : "career",
      limit: 10,
    };
  }

  return {
    intent: "leaders",
    stat,
    venue: filters.venue,
    weekMin: filters.weekMin ?? null,
    weekMax: filters.weekMax ?? null,
    sbOnly,
    perGame,
    month,
    primetime,
    tempMax,
    seasonMin: range?.min ?? null,
    seasonMax: range?.max ?? null,
    // Default a leaderboard question to the most recent loaded season, not all
    // of history: "most passing yards" means last season's leader, the same as
    // "best qb" does. Only "career"/"all-time" (isCareer), an explicit season
    // range, or single-season-record phrasing ("in a season", isSeasonRecord —
    // season scope ranked across every year) widens it; a generic name search
    // and a comparison are different intents (player_seasons / compare) and
    // keep their own career default.
    round: playerRound,
    season: range
      ? null
      : isCareer
        ? null
        : (effSeason ?? (isSeasonRecord ? null : (opts.latestSeason ?? null))),
    seasonType,
    limit: limit ?? 25,
    position,
    dir: ASC_RE.test(qText) ? "asc" : "desc",
    rookie: /\brookies?\b/.test(qText),
    // A range aggregates across its seasons like a career total does —
    // unless the question asked for a single-season record ("most rushing
    // yards in a season since 2015"), which ranks season rows WITHIN the range.
    scope: (range && !isSeasonRecord) || isCareer ? "career" : "season",
  };
}

function primaryFor(
  map: Record<string, string>,
  ...players: (IndexedPlayer | null)[]
): string {
  for (const pos of ["QB", "RB"]) { // a QB in the matchup means passing frames it
    if (players.some((p) => p?.position === pos)) return map[pos]!;
  }
  // Any known position (including defensive ones) beats the WR fallback.
  for (const pl of players) {
    const stat = map[pl?.position ?? ""];
    if (stat) return stat;
  }
  return "receiving_yards";
}
