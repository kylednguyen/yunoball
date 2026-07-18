/** Second-layer query auditor.
 *
 * Runs AFTER the deterministic parser and BEFORE SQL generation. It never
 * invents data — it validates the structured query candidate against what the
 * warehouse actually holds, normalizes what it can, asks for clarification
 * when a name is genuinely ambiguous, and rejects contradictions with an
 * honest sentence. Every decision is structured (status + warnings +
 * per-field confidence), and the pipeline logs one audit record per question.
 */

import type { ResolvedEntity } from "@yunoball/types";
import { pool, q } from "../db/pool.js";
import { sbName } from "./build.js";
import { fields, STATS } from "./spec.js";
import type { FieldedSpec, QuerySpec } from "./spec.js";

type AuditStatus =
  | "validated"
  | "validated_with_warnings"
  | "needs_clarification"
  | "no_matching_data"
  | "invalid";

export interface AuditConfidence {
  overall: number;
  entity: number;
  season: number;
  gameType: number;
  metric: number;
}

export interface AuditOutcome {
  status: AuditStatus;
  spec: QuerySpec;
  warnings: string[];
  /** Human sentence for non-validated statuses. */
  reason?: string;
  /** needs_clarification: the candidate entities, ready to render. */
  options?: Record<string, unknown>[];
  confidence: AuditConfidence;
}

export interface AuditCtx {
  question: string;
  entities: ResolvedEntity[];
  latestSeason: number | null;
}

/** Warehouse stats coverage starts here (draft history reaches back further). */
const STATS_MIN_SEASON = 1999;
const DRAFT_MIN_SEASON = 1980;

// Cheap probes cached for the process lifetime of a few minutes.
const PROBE_TTL_MS = 10 * 60 * 1000;
let draftMax: { value: number | null; at: number } | null = null;
const seasonComplete = new Map<number, { value: boolean; at: number }>();

async function draftMaxSeason(): Promise<number | null> {
  if (draftMax && Date.now() - draftMax.at < PROBE_TTL_MS) return draftMax.value;
  try {
    const rows = await q<{ max: number | null }>("SELECT MAX(season) AS max FROM draft_picks");
    draftMax = { value: rows[0]?.max ?? null, at: Date.now() };
  } catch {
    draftMax = { value: null, at: Date.now() };
  }
  return draftMax.value;
}

/** A season counts as complete once its Super Bowl (max POST week) has a
 * final score — never describe an in-progress season as settled. */
async function isSeasonComplete(season: number): Promise<boolean> {
  const hit = seasonComplete.get(season);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.value;
  let value = false;
  try {
    const rows = await q<{ done: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM games g
         WHERE g.season = $1 AND g.season_type = 'POST' AND g.home_score IS NOT NULL
           AND g.week = (SELECT MAX(g2.week) FROM games g2
                         WHERE g2.season = $1 AND g2.season_type = 'POST')
       ) AS done`,
      [season],
    );
    value = Boolean(rows[0]?.done);
  } catch {
    value = true; // never block an answer on a failed probe
  }
  seasonComplete.set(season, { value, at: Date.now() });
  return value;
}

/** Position families a stat implies — used to auto-disambiguate surnames
 * ("allen passing stats" means the QB, not the WR). */
const STAT_POSITIONS: Record<string, Set<string>> = {
  passing_yards: new Set(["QB"]),
  passing_tds: new Set(["QB"]),
  interceptions: new Set(["QB"]),
  completion_pct: new Set(["QB"]),
  yards_per_attempt: new Set(["QB"]),
  sacks_taken: new Set(["QB"]),
  yards_per_carry: new Set(["RB", "QB", "FB"]),
  yards_per_reception: new Set(["WR", "TE", "RB"]),
  catch_rate: new Set(["WR", "TE", "RB"]),
  rushing_yards: new Set(["RB", "QB", "FB"]),
  rushing_tds: new Set(["RB", "QB", "FB"]),
  receiving_yards: new Set(["WR", "TE", "RB"]),
  receiving_tds: new Set(["WR", "TE", "RB"]),
  receptions: new Set(["WR", "TE", "RB"]),
  tackles: new Set(["LB", "ILB", "OLB", "MLB", "DL", "DE", "DT", "NT", "CB", "S", "FS", "SS", "DB", "EDGE"]),
  def_sacks: new Set(["LB", "ILB", "OLB", "MLB", "DL", "DE", "DT", "NT", "EDGE", "DB", "CB", "S"]),
  forced_fumbles: new Set(["LB", "DL", "DE", "DT", "DB", "CB", "S", "EDGE"]),
  passes_defended: new Set(["CB", "S", "FS", "SS", "DB", "LB"]),
};

interface SurnameCandidate {
  player_id: string;
  full_name: string;
  position: string | null;
  last_season: number;
  prod: number;
}

/** The question named only a surname: find every plausible owner. */
async function surnameCandidates(surname: string): Promise<SurnameCandidate[]> {
  return q<SurnameCandidate>(
    `SELECT p.player_id, p.full_name, p.position,
            MAX(s.season) AS last_season,
            COALESCE(SUM(COALESCE(s.fantasy_points_ppr, 0) + COALESCE(s.tackles, 0) + 6 * COALESCE(s.def_sacks, 0)), 0) AS prod
     FROM players p
     JOIN player_season_stats s ON s.player_id = p.player_id
     WHERE lower(p.full_name) LIKE $1
     GROUP BY p.player_id, p.full_name, p.position
     ORDER BY prod DESC
     LIMIT 8`,
    [`% ${surname.toLowerCase()}`],
  );
}

const PLAYER_INTENTS = new Set(["player_total", "player_seasons", "game_log", "game_count", "scoring"]);

// ---- Unconsumed-qualifier guardrail ----
//
// The parser sometimes recognizes a question's SHAPE (a leaderboard, a
// player total) but has no field yet for one of its qualifiers — and
// silently drops it instead of refusing. That is the engine's worst bug
// class: "touchdowns from inside the 5-yard line" quietly became a plain
// touchdown leaderboard, "in games his team lost" a plain career total.
// Never a wrong number — so every qualifier phrase below is paired with the
// spec field that proves the engine actually honored it. `unmet` returns
// true (refuse) when the phrase is present but nothing consumed it; once a
// later task teaches an executor to fill that field, `unmet` stops firing on
// its own and the refusal retires without touching this table again.
interface QualifierRule {
  re: RegExp;
  unmet: (spec: FieldedSpec, qText: string) => boolean;
  message: string;
}

const always = () => true;

const QUALIFIER_RULES: QualifierRule[] = [
  {
    re: /\bthrough (?:(?:his|her|their)\s+)?first (?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten) (?:career )?(?:games|starts)\b/,
    unmet: (spec) => spec.firstN == null,
    message:
      'First-N-games windows are only supported on a named player\'s totals so far — ' +
      'try "Patrick Mahomes passing yards through his first 50 games".',
  },
  {
    // "before beginning his fifth season" / "in his first three seasons" /
    // "before his fifth season" (the last already works on qualifying-game
    // boards — beforeSeasonN set there — so this only fires when unconsumed).
    re: /\b(?:before|in) (?:(?:his|her|their)\s+)?first (?:\w+|\d+) seasons?\b|\bbefore beginning\b/,
    unmet: (spec) => spec.beforeSeasonN == null,
    message:
      'Season-window splits ("his first N seasons") are only supported on qualifying-game ' +
      'boards so far — try "most 100-yard rushing games before his fifth season".',
  },
  {
    // "before turning/age N" (a max-age filter) has no spec field anywhere,
    // so minAgeYears is never set for it and this rule always refuses it;
    // "after turning/age N" retires wherever minAgeYears gets consumed.
    re: /\b(?:after|before) (?:turning|age) \d+\b/,
    unmet: (spec) => spec.minAgeYears == null,
    message:
      'Age splits ("after turning 30") are only supported on qualifying-game boards so far ' +
      '— try "most 100-yard rushing games after turning 30".',
  },
  {
    // "without a 1,500-yard season" / "without a 100-catch season" — the
    // Task 6 season-threshold negation. Retires once the SAME-stat season
    // exclusion landed on the spec (withoutSeasonAtLeast — the parser only
    // sets it for plain season-rollup stats; anything else refuses here).
    re: /\bwithout an? [\d,]+-(?:yard|catch)s? seasons?\b/,
    unmet: (spec) => spec.withoutSeasonAtLeast == null,
    message:
      '"Without a [N]-yard/catch season" negations are only supported when the threshold ' +
      'names the SAME stat being ranked — try the plain career leaderboard for that stat.',
  },
  {
    // "without (ever) leading the league/NFL (in X)" — Task 6's
    // ever-led-the-league negation. Retires once withoutLeagueLead landed
    // (season-rollup stats only, same parser gate as above).
    re: /\bwithout (?:ever )?leading the (?:league|nfl)\b/,
    unmet: (spec) => !spec.withoutLeagueLead,
    message:
      'League-leadership negations ("without ever leading the league") aren\'t supported for ' +
      'every stat yet — try the plain career leaderboard for that stat.',
  },
  {
    // "without scoring a touchdown" — Task 6's cross-stat zero condition
    // ("most rushing attempts without scoring a touchdown"). Retires once
    // crossStat landed; stats whose TD side isn't confidently mappable
    // (tackles, fantasy points...) never set it and refuse here.
    re: /\bwithout scoring an? touchdowns?\b/,
    unmet: (spec) => spec.crossStat == null,
    message: '"...without scoring a touchdown" boards aren\'t supported for every stat yet.',
  },
  {
    // "with fewer than N career X" — Task 6's cross-stat bound ("most
    // rushing touchdowns with fewer than 1,000 career rushing yards"). No
    // "without" in this phrasing, so it's a separate rule from the
    // without-family above; still retires on the same crossStat field.
    re: /\bwith fewer than [\d,]+ career [a-z]+(?: [a-z]+)*\b/,
    unmet: (spec) => spec.crossStat == null,
    message: '"...with fewer than N career X" boards aren\'t supported for every stat combination yet.',
  },
  {
    // Catch-all: ANY "without" the three specific rules above didn't claim
    // — awards-dependent negations (MVP, playoff win, conference
    // championship, Super Bowl; Pro Bowl already refuses earlier via the
    // UNSUPPORTED scan in parseRules) and anything else this table doesn't
    // yet name a field for. It strips the CLAIMED phrasings (each strip
    // regex is exactly its specific rule's vocabulary, kept in lockstep)
    // and refuses if any "without" remains — spec state alone can't do
    // this: a COMPOUND negation ("without a 1,500-yard season and without
    // winning a playoff game") sets one field and would sail through a
    // fields-only check while the executor silently ignores the other
    // clause.
    re: /\bwithout\b/,
    unmet: (_spec, qText) =>
      /\bwithout\b/.test(
        qText
          .replace(/\bwithout an? [\d,]+-(?:yard|catch)s? seasons?\b/g, "")
          .replace(/\bwithout (?:ever )?leading the (?:league|nfl)\b/g, "")
          .replace(/\bwithout scoring an? touchdowns?\b/g, ""),
      ),
    message:
      '"Without" boards (a career total minus some condition) aren\'t supported yet — try ' +
      'the plain career leaderboard for that stat instead.',
  },
  {
    // LOCKSTEP: mirrors (independently — not shared code) the vocabulary in
    // parseRules.ts's resultFilters(); keep the two word lists in sync.
    re: /\bin (?:a |the )?games? (?:his|her|their) team lost\b|\bin (?:one-score|close) (?:games|losses)\b/,
    // The phrase is either a result split (team lost) or a margin split
    // (one-score) — refuse only when NEITHER field the parser can set for it
    // ended up on the spec.
    unmet: (spec) => spec.gameResult == null && !spec.oneScore,
    message:
      'Filtering by game result (wins/losses, margin) isn\'t supported yet — try the plain ' +
      'career or season leaderboard for that stat.',
  },
  {
    re: /\bagainst (?:teams with )?winning records?\b/,
    unmet: (spec) => !spec.oppWinningRecord,
    message: 'Opponent-record filters ("against teams with winning records") aren\'t supported yet.',
  },
  {
    // "vs/against the <team>" — retires wherever opponentId (player shapes)
    // or team2Id (team matchup shapes) got consumed. The nickname list is a
    // static snapshot of the 32 franchises (nicknames are stable; audit has
    // no team index). LOCKSTEP: parseRules.ts vs-opponent capture.
    re: /\b(?:vs\.?|versus|against)\s+(?:the\s+)?(?:bills|dolphins|patriots|jets|ravens|bengals|browns|steelers|texans|colts|jaguars|titans|broncos|chiefs|raiders|chargers|cowboys|giants|eagles|commanders|redskins|bears|lions|packers|vikings|falcons|panthers|saints|buccaneers|bucs|cardinals|rams|niners|49ers|seahawks)\b/,
    unmet: (spec) => spec.opponentId == null && spec.team2Id == null,
    message:
      'Opponent splits ("vs the Bills") are supported on a player\'s season or career ' +
      'totals, qualifying-game counts, single-game bests and game logs — try ' +
      '"Patrick Mahomes passing yards vs the Bills".',
  },
  {
    // Distance phrasing alone is too generic ("100-yard rushing games" is a
    // real qualifying-game board) — both lookaheads must hold, so only a
    // touchdown-distance question (not a plain yardage threshold) refuses.
    // Retired wherever a scoring_board spec consumed the distance bounds.
    re: /(?=.*\b(?:touchdowns?|tds?)\b)(?=.*\b(?:inside the \d+|from exactly \d+ yards?|of \d+ or more yards|\d+[-\s]?yard line)\b)/,
    unmet: (spec) => spec.yardsMin == null && spec.yardsMax == null,
    message:
      'Touchdown-distance filters are only supported on league-wide scoring boards so far — ' +
      'try "most touchdowns of 50 or more yards", or a player\'s touchdown timeline.',
  },
  {
    // A season the QUESTION names consumed the phrase's intent ("most
    // touchdowns in 2015, Peyton Manning's final NFL season" IS answerable
    // as 2015) — only the unanchored per-player split refuses. Checking
    // spec.season alone is not enough: the parser defaults bare
    // leaderboards to the latest season, so the bare split would sail
    // through with a defaulted season and answer the wrong question.
    re: /\bfinal (?:nfl )?season\b/,
    unmet: (spec, qText) =>
      spec.season == null ||
      !/\b(?:19|20)\d{2}\b|\b(?:this|current|last) (?:season|year)\b/.test(qText),
    message:
      'Final-season splits aren\'t supported yet — try the player\'s full career or a ' +
      'specific season.',
  },
  {
    // NOT "led the league in X in <year>" alone — that's already a plain
    // single-season leaders lookup (the top of that year's board IS the
    // league leader) and must keep answering. "Without leading the league"
    // is the actually-unsupported career negation, and is already caught by
    // the "without" rule above. Plurals included: "most Pro Bowls" /
    // "most rushing titles" are the count-the-honor phrasings.
    re: /\bpro bowls?\b|\brushing titles?\b/,
    unmet: always,
    message: 'Award-based filters ("Pro Bowl", "rushing title") aren\'t supported yet.',
  },
  {
    re: /\bagainst (?:a|one) (?:single|specific) (?:opponent|team)\b/,
    unmet: (spec) => spec.opponentId == null && !spec.perOpponent,
    message:
      'Best-single-opponent boards ("against a single opponent") aren\'t supported yet — ' +
      'name the opponent instead, e.g. "Mahomes passing yards vs the Broncos".',
  },
  {
    // Sacks/interceptions are recorded against the OPPOSING TEAM, never a
    // specific opposing quarterback — there's no per-opponent-QB attribution
    // to compute even with one named, unlike the team-level board above.
    // Never retires: this capability is deliberately not implemented.
    re: /\bagainst (?:a|one) (?:single|specific) quarterback\b/,
    unmet: always,
    message:
      'Stats aren\'t attributed to a specific opposing quarterback in the warehouse — only to ' +
      'the opposing team. Try "against a single opponent" for the team-level version instead.',
  },
  {
    re: /\band still won\b/,
    unmet: (spec) => spec.gameResult !== "W",
    message: 'Result-conditioned filters ("...and still won") aren\'t supported yet.',
  },
  {
    // "both a rushing and receiving touchdown" / "at least one passing and
    // one rushing touchdown" / the plain "a rushing touchdown and a
    // receiving touchdown" paraphrase — a compound same-game AND-list
    // threshold. LOCKSTEP: mirrors (independently) compoundTdFilter() in
    // parseRules.ts; keep the two word lists in sync.
    re: /\b(?:both (?:an? )?[a-z]+ and [a-z]+|at least one [a-z]+ and one [a-z]+|an? [a-z]+ touchdown and an? [a-z]+) touchdowns?\b/,
    unmet: (spec) => spec.andStat == null,
    message:
      'Compound same-game filters ("both a rushing and receiving touchdown") aren\'t ' +
      'supported yet — try one stat\'s qualifying-game count instead.',
  },
  {
    // A "percentage" question the parser routed to a plain (non-percentage)
    // leaderboard: the percentage stats we DO compute (completion %, catch
    // rate) already carry "percentage"/"pct" in their own vocabulary, so
    // they select themselves and never hit this rule.
    re: /\bpercentage\b/,
    unmet: (spec) =>
      spec.intent === "leaders" &&
      !(STATS[spec.stat]?.phrases.some((p) => p.includes("percent") || p.includes("pct")) ?? false),
    message:
      'Percentage-of-career splits ("what percentage of his yards came after age 30") ' +
      'aren\'t supported yet — the percentage stats I can answer are completion ' +
      'percentage and catch rate.',
  },
];

/** Scan the question for qualifier vocabulary the built spec didn't consume.
 * Returns the first matching refusal, or null when every recognized
 * qualifier is either absent or already reflected in the spec. */
function qualifierGuard(question: string, spec: FieldedSpec): string | null {
  const qText = question.toLowerCase();
  for (const rule of QUALIFIER_RULES) {
    if (rule.re.test(qText) && rule.unmet(spec, qText)) return rule.message;
  }
  return null;
}

export async function audit(spec0: QuerySpec, ctx: AuditCtx): Promise<AuditOutcome> {
  // The auditor legitimately validates fields across every intent, so it uses
  // the fields() reader view (same object; executors keep the narrow types).
  const spec = fields(spec0);
  const warnings: string[] = [];
  const confidence: AuditConfidence = {
    overall: 1,
    entity: ctx.entities[0]?.confidence ?? (spec.playerId || spec.teamId ? 0.99 : 1),
    season: 1,
    gameType: 1,
    metric: 1,
  };
  const done = (status: AuditStatus, extra: Partial<AuditOutcome> = {}): AuditOutcome => {
    confidence.overall = Math.min(
      confidence.entity, confidence.season, confidence.gameType, confidence.metric,
    );
    return { status, spec: spec0, warnings, confidence, ...extra };
  };

  // ---- Unconsumed qualifiers: the question named a filter the built spec
  // has no field for — refuse by name rather than silently answer a
  // different, narrower question. ----
  const qualifierMsg = qualifierGuard(ctx.question, spec);
  if (qualifierMsg) {
    return done("invalid", { reason: qualifierMsg });
  }

  // ---- Contradictions: reject before any SQL exists ----
  if (spec.weekMin != null && spec.weekMax != null && spec.weekMin > spec.weekMax) {
    return done("invalid", {
      reason: `That week range is contradictory (from Week ${spec.weekMin} through Week ${spec.weekMax}).`,
    });
  }
  if ((spec.weekMin ?? 0) > 22 || (spec.weekMax ?? 1) < 1) {
    return done("invalid", { reason: "No NFL week matches that filter (weeks run 1-22 including playoffs)." });
  }
  if (spec.firstN && spec.lastN) {
    return done("invalid", {
      reason: "First-N and last-N game windows can't combine; pick one.",
    });
  }
  // The negation executor branches are first-match-wins — two set fields
  // would silently drop one from the SQL and the narration, so a compound
  // negation refuses here instead (mirrors the firstN/lastN check above).
  if (
    [spec.withoutSeasonAtLeast != null, Boolean(spec.withoutLeagueLead), spec.crossStat != null]
      .filter(Boolean).length > 1
  ) {
    return done("invalid", {
      reason: 'Multiple "without" conditions can\'t combine yet; pick one.',
    });
  }
  // Every leaders() branch below the top is first-match-wins too, checked in
  // a fixed order (firstN/minAgeYears/beforeSeasonN, then gameResult/
  // oneScore/oppWinningRecord/perOpponent, then the negation fields) — a
  // question that sets fields from two different branches silently answers
  // whichever branch the executor happens to check first, dropping the
  // other qualifier from both the SQL and the narration. Refuse instead of
  // guessing which one the user meant honored.
  const isNegation = spec.withoutSeasonAtLeast != null || Boolean(spec.withoutLeagueLead) || spec.crossStat != null;
  const isWindow = spec.firstN != null || spec.beforeSeasonN != null || spec.minAgeYears != null;
  if (isNegation && (isWindow || spec.gameResult != null || spec.oneScore || spec.oppWinningRecord || spec.perOpponent)) {
    return done("invalid", {
      reason:
        'A "without" condition can\'t combine with an age window, season window, game-result ' +
        'filter, or single-opponent board yet; pick one.',
    });
  }
  // perOpponent's own branch composes gameResult/oneScore/oppWinningRecord
  // genuinely (it builds its WHERE from the same gamePreds() call as every
  // other game-grain board), so those three are deliberately NOT refused
  // here — only the window fields, which perOpponent's branch is never
  // reached for (firstN/minAgeYears/beforeSeasonN short-circuit first).
  if (spec.perOpponent && isWindow) {
    return done("invalid", {
      reason: 'A single-opponent board can\'t combine with an age or season window yet; pick one.',
    });
  }
  // The season-rollup negation branches never call gamePreds() — a
  // co-occurring season/venue/month/week/primetime/weather/SB filter would
  // be silently dropped from the SQL while the question (and narration)
  // implies it applied. spec.season alone can't gate the season clause: the
  // parser defaults bare leaderboards to the latest season, so require the
  // question to have actually named a year — same idiom as the
  // final-season qualifier rule above.
  if (
    isNegation &&
    (spec.seasonMin != null || spec.seasonMax != null || spec.month != null ||
      spec.venue != null || spec.weekMin != null || spec.weekMax != null ||
      Boolean(spec.primetime) || spec.tempMax != null || Boolean(spec.sbOnly) ||
      (spec.season != null &&
        /\b(?:19|20)\d{2}\b|\b(?:this|current|last) (?:season|year)\b/.test(ctx.question.toLowerCase())))
  ) {
    return done("invalid", {
      reason:
        '"Without" boards are career-wide only so far — they can\'t combine with a season, ' +
        'venue, month, week, primetime, weather, or Super Bowl filter yet.',
    });
  }
  if (spec.threshold && spec.threshold.value < 0) {
    return done("invalid", { reason: "Stat thresholds can't be negative." });
  }

  // ---- Draft coverage ----
  if (spec.intent === "draft_pick") {
    const max = await draftMaxSeason();
    if (spec.season != null && spec.season < DRAFT_MIN_SEASON) {
      confidence.season = 0.9;
      return done("no_matching_data", {
        reason: `Draft history starts with the ${DRAFT_MIN_SEASON} draft; ${spec.season} is before coverage.`,
      });
    }
    if (spec.season != null && max != null && spec.season > max) {
      confidence.season = 0.9;
      return done("no_matching_data", {
        reason: `The ${spec.season} draft hasn't happened yet; drafts through ${max} are loaded.`,
      });
    }
    return done("validated");
  }

  // ---- Season coverage for stats and games ----
  if (spec.season != null) {
    if (spec.season < STATS_MIN_SEASON) {
      confidence.season = 0.9;
      const sbNote =
        spec.sbOnly || spec.round === "SB"
          ? ` That's ${sbName(STATS_MIN_SEASON)} (the ${STATS_MIN_SEASON} season) onward.`
          : "";
      return done("no_matching_data", {
        reason: `Warehouse coverage starts with the ${STATS_MIN_SEASON} season.${sbNote}`,
      });
    }
    if (ctx.latestSeason != null && spec.season > ctx.latestSeason) {
      confidence.season = 0.9;
      return done("no_matching_data", {
        reason:
          `The ${spec.season} season isn't in the warehouse yet; ` +
          `the newest loaded season is ${ctx.latestSeason}.`,
      });
    }
  }

  // ---- Super Bowl played-year normalization is worth saying out loud ----
  const yearBeforeSb = ctx.question
    .toLowerCase()
    .match(/\b((?:19|20)\d{2}) super ?bowl\b|\bsuper ?bowl (?:in |of )((?:19|20)\d{2})\b/);
  const playedYear = yearBeforeSb ? Number(yearBeforeSb[1] ?? yearBeforeSb[2]) : null;
  if (playedYear != null && spec.season === playedYear - 1) {
    warnings.push(
      `Read ${playedYear} as the calendar year of the game: ${sbName(spec.season)}, ` +
      `capping the ${spec.season} season.`,
    );
    confidence.season = 0.85;
  }

  // ---- Surname-only mentions: clarify or auto-disambiguate ----
  if (spec.playerId && spec.player && PLAYER_INTENTS.has(spec.intent)) {
    // Compare punctuation-folded tokens ("A.J." -> "aj", "Amon-Ra" ->
    // "amon ra") against the folded question, on word boundaries — users type
    // names without punctuation, and "aj brown" names the player fully.
    const fold = (s: string) => s.toLowerCase().replace(/[.'’]/g, "").replace(/-/g, " ");
    const qLower = fold(ctx.question);
    const parts = fold(spec.player).split(/\s+/);
    const surname = parts.at(-1)!;
    const namedMoreThanSurname = parts
      .slice(0, -1)
      .some((tok) => tok.length >= 2 && new RegExp(`\\b${tok}\\b`).test(qLower));
    // The guard only applies to a literal bare-surname mention. A player
    // reached through an alias ("jjettas", "cj2k") never typed the surname,
    // so there is nothing to disambiguate.
    const surnameTyped = new RegExp(`\\b${surname}\\b`).test(qLower);
    if (!namedMoreThanSurname && surnameTyped && parts.length > 1) {
      try {
        const cands = await surnameCandidates(surname);
        const posFilter = STAT_POSITIONS[spec.stat];
        const fits = posFilter
          ? cands.filter((c) => posFilter.has(c.position ?? ""))
          : cands;
        const pool = fits.length > 0 ? fits : cands;
        const [first, second] = pool;
        if (first && second && Number(second.prod) >= 0.25 * Number(first.prod)) {
          confidence.entity = 0.6;
          return done("needs_clarification", {
            reason: `Multiple players match "${surname}". Which one?`,
            options: pool.slice(0, 3).map((c) => ({
              player_id: c.player_id,
              full_name: c.full_name,
              position: c.position,
              last_season: c.last_season,
            })),
          });
        }
        if (first && first.player_id !== spec.playerId) {
          // The stat's position family points at a different owner of the
          // surname than raw prominence did — follow the stat.
          spec.playerId = first.player_id;
          spec.player = first.full_name;
          warnings.push(`Read "${surname}" as ${first.full_name}.`);
          confidence.entity = 0.85;
        }
      } catch {
        // Probes are best-effort; parsing already produced a sane spec.
      }
    }
  }

  // ---- The player must have been active in the requested season ----
  if (spec.playerId && spec.season != null && PLAYER_INTENTS.has(spec.intent)) {
    try {
      const rows = await q<{ ok: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM player_season_stats WHERE player_id = $1 AND season = $2) AS ok",
        [spec.playerId, spec.season],
      );
      if (!rows[0]?.ok) {
        confidence.season = 0.9;
        return done("no_matching_data", {
          reason: `${spec.player ?? "That player"} has no ${spec.season} games in the warehouse.`,
        });
      }
    } catch {
      // best-effort
    }
  }

  // ---- Never present an in-progress season as settled ----
  if (
    spec.season != null &&
    ctx.latestSeason != null &&
    spec.season === ctx.latestSeason &&
    !(await isSeasonComplete(spec.season))
  ) {
    warnings.push(`The ${spec.season} season is still in progress; this covers games loaded so far.`);
  }

  return done(warnings.length ? "validated_with_warnings" : "validated");
}

/** Best-effort structured audit record — decisions only, never reasoning. */
export function logAudit(entry: {
  question: string;
  spec: QuerySpec | null;
  status: string;
  warnings: string[];
  confidence: AuditConfidence | null;
  rowCount: number;
  durationMs: number;
}): void {
  void pool().query(
    `INSERT INTO query_audit (question, spec, status, warnings, confidence, row_count, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.question,
      entry.spec ? JSON.stringify(entry.spec) : null,
      entry.status,
      JSON.stringify(entry.warnings),
      entry.confidence ? JSON.stringify(entry.confidence) : null,
      entry.rowCount,
      entry.durationMs,
    ],
  ).catch(() => {});
}
