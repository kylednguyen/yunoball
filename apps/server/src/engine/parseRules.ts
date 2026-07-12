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
const NUM_ALT = `\\d{1,2}|${Object.keys(WORD_NUMS).join("|")}`;

// "X versus Y" / "X vs Y" / "X and Y" splits the question into two halves;
// compare only fires when BOTH halves resolve to (different) players.
const VS_RE = /\s+(?:versus|vs\.?|and|&)\s+/;

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
  const m = qText.match(/\b(19|20)\d{2}\b/);
  if (m) return Number(m[0]);
  if (latestSeason == null) return null;
  if (/\b(this|current) (season|year)\b/.test(qText)) return latestSeason;
  if (/\blast (season|year)\b/.test(qText)) return latestSeason - 1;
  if (/\b(this year|last year)\b/.test(qText)) return latestSeason;
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

/** Numeric qualifying-game thresholds: "over 300", "100+", "at least 3",
 * "more than 10", "under 50", "fewer than 2". */
function threshold(qText: string): { op: ">" | ">=" | "<"; value: number } | null {
  let m = qText.match(/\b(?:over|more than)\s+(\d+)/);
  if (m) return { op: ">", value: Number(m[1]) };
  m = qText.match(/\b(?:at least)\s+(\d+)/);
  if (m) return { op: ">=", value: Number(m[1]) };
  m = qText.match(/\b(\d+)\s*\+/);
  if (m) return { op: ">=", value: Number(m[1]) };
  m = qText.match(/\b(?:under|fewer than|less than)\s+(\d+)/);
  if (m) return { op: "<", value: Number(m[1]) };
  m = qText.match(/\bgames? with (\d+)\b/);
  if (m) return { op: ">=", value: Number(m[1]) };
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

export interface SbRef {
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
export function sbRef(qText: string): SbRef | null {
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
    /\b(qbr|passer rating|third down|red ?zone|time of possession|epa|dvoa|turnovers? forced|averages?|avg|ypc|per carry)\b/,
    "Rate and efficiency metrics beyond completion percentage aren't tracked yet. Try production stats: yards, touchdowns, receptions, interceptions thrown.",
  ],
  [
    /\b(offense|offensive|defense|defensive|which team|what team|gives? up|allowed)\b/,
    "Team-unit stats aren't queryable yet. Every team page ranks offense and defense against the whole league.",
  ],
  [
    /\b(schedule|next game|tomorrow|tonight|upcoming)\b/,
    "I answer historical stats and results. For week-by-week scores, head to the Scores page.",
  ],
  [
    /\b(primetime|prime time|monday night|sunday night|thursday night|snf|mnf|tnf|thanksgiving|against winning teams|after (the )?bye|overtime|comeback|record when)\b/,
    "That game-situation split isn't tracked yet. I can filter by season, playoffs, home/away, week ranges and stat thresholds.",
  ],
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
  const filters = {
    venue: venue(qText),
    ...weekRange(qText),
    firstN: firstN(qText),
    lastN: lastN(qText),
    rookie: /\brookies?\b/.test(qText),
  };
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
      return {
        intent: "compare",
        stat: detectStat(qText) ?? primaryFor(PRIMARY_STAT, p1, p2),
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

  // ---- Game results and game logs (teams and Super Bowls) ----
  const teams = opts.teams;
  const resultCue =
    /\b(result|results|score|final|who won|won|winners?|beat|defeated?|happened|played|decided by)\b/.test(qText);
  const logCue =
    /\b(game ?log|game[- ]by[- ]game|results|appearances?|history|record|games)\b/.test(qText);
  const gameDate = detectDate(qText);

  // Player game log: "mahomes super bowl game log", "jefferson games against
  // green bay". Generic words like "record" never route a player here.
  if (player && (/\bgame ?log\b/.test(qText) || /\bgames? (?:against|vs\.?)\b/.test(qText))) {
    const opp = teams ? teamHit(qText, teams) : null;
    return {
      intent: "game_log", stat: "total_tds",
      player: player.name, playerId: player.playerId, position: player.position,
      season: effSeason, seasonType, sbOnly, round: playerRound,
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
    detectStat(qText) === null && genericCue(qText) === null
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

  // Vocabulary we recognize but genuinely can't answer — say so, usefully.
  for (const [re, message] of UNSUPPORTED) {
    if (re.test(qText)) return { refusal: message };
  }

  if (!player && teams) {
    // Two teams in one question: a matchup result, from the perspective of
    // the first team mentioned.
    const [t1, t2] = teamHits(qText, teams);
    const single =
      /\b(last|latest|most recent|who won|final score|score of|result)\b/.test(qText) &&
      !/\b(all|every|each)\b/.test(qText);

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
      if (/\blast game\b/.test(qText) || gameDate || (resultCue && !logCue)) {
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
      if (logCue || filters.lastN || marginM) {
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

  // Team questions: the warehouse can't rank team units yet, but the team
  // pages compute record, rankings and leaders — point there by name.
  if (!player && opts.teams) {
    const team = teamHit(qText, opts.teams);
    if (team) {
      return {
        refusal:
          `Team-level stat questions are coming. Meanwhile the ${team.name} ` +
          `page has their record, offense/defense rankings and stat leaders.`,
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

  // Stat: specific vocabulary first, then generic cues resolved by context,
  // then the player's (or position's) primary stat.
  let stat = detectStat(qText);
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
    const nameTokens = new Set(player.name.toLowerCase().split(/\s+/));
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
  const isSingleGame =
    qText.includes("game") &&
    (qText.includes("single") || qText.includes("in a game") || qText.includes("one game"));

  // Qualifying-game counts: "Lamar games over 300 passing yards",
  // "Derrick Henry 100+ rushing yard games".
  if (player && th && !isSingleGame) {
    return {
      intent: "game_count",
      stat,
      player: player.name,
      playerId: player.playerId,
      season: effSeason,
      seasonType,
      sbOnly,
      threshold: th,
      venue: filters.venue,
      weekMin: filters.weekMin ?? null,
      weekMax: filters.weekMax ?? null,
      scope: isCareer || effSeason === null ? "career" : "season",
      limit: 25,
    };
  }

  if (isSingleGame) {
    // Scope to the named player when the question named one ("Derrick Henry
    // most rushing yards in a game"); otherwise a league-wide single-game board.
    return {
      intent: "single_game", stat, seasonType, limit: limit ?? 5,
      scope: "season", season: effSeason,
      player: player?.name ?? null,
      playerId: player?.playerId ?? null,
    };
  }

  if (player) {
    return {
      intent: "player_total",
      stat,
      player: player.name,
      playerId: player.playerId,
      season: effSeason,
      round: playerRound,
      seasonType,
      sbOnly,
      firstN: filters.firstN,
      lastN: filters.lastN,
      venue: filters.venue,
      weekMin: filters.weekMin ?? null,
      weekMax: filters.weekMax ?? null,
      rookie: filters.rookie,
      scope:
        filters.rookie || (!isCareer && effSeason !== null) ? "season" : "career",
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
    // "most career passing yards" ranks all-time totals; a bare position
    // question ("best qb") means the newest season, not all of history.
    round: playerRound,
    season: isCareer
      ? null
      : (effSeason ?? (position && !CAREER_RE.test(qText) ? (opts.latestSeason ?? null) : null)),
    seasonType,
    limit: limit ?? 10,
    position,
    dir: ASC_RE.test(qText) ? "asc" : "desc",
    rookie: /\brookies?\b/.test(qText),
    scope: isCareer ? "career" : "season",
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
