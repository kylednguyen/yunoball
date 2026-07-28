/** Shared SQL machinery for the intent executors.
 *
 * Because the SQL is generated here (not from free text), it is inherently
 * safe: stat expressions come from the validated STATS allowlist and all
 * user-derived values (season, player, limit, thresholds) are bound
 * parameters.
 *
 * Two data grains:
 *   - season rollups (player_season_stats) for plain totals and leaders
 *   - the game log (player_game_stats + games) whenever a question needs
 *     game-level filters (home/away, week ranges, first/last N, thresholds)
 *     or a game-sourced stat (completion percentage)
 */

import { STATS } from "../spec.js";
import type { GameLogSpec, GameWindow, PlayerTotalSpec, StatDef } from "../spec.js";

// Every stat column, for COMPARE's full-line output (allowlisted names only).
export const ALL_STAT_COLS = [
  "completions", "attempts", "passing_yards", "passing_tds", "interceptions",
  "rushing_yards", "rushing_tds", "receptions", "receiving_yards",
  "receiving_tds", "tackles", "def_sacks", "def_interceptions",
  "forced_fumbles", "passes_defended", "sacks", "fantasy_points_ppr",
] as const;

// Columns COMPARE aggregates per side. Superset of the display line: carries
// and targets are summed too so ratio stats (yards per carry, catch rate) can
// be computed head-to-head, even though they aren't shown as their own row.
export const COMPARE_SUM_COLS = [...ALL_STAT_COLS, "carries", "targets"] as const;
const COMPARE_COL_SET = new Set<string>(COMPARE_SUM_COLS);

export class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

export function statDef(spec: { stat: string }): StatDef {
  return STATS[spec.stat]!;
}

/** The game-grain table a stat lives in. */
export function gameTable(def: StatDef): string {
  return def.table === "advanced" ? "player_game_advanced" : "player_game_stats";
}

/** "× 100" for percentage ratios (completion %), nothing for plain rates
 * (yards per carry). The spacing matters: it must reproduce the historical
 * SQL byte-for-byte for percentage stats. */
function pctFactor(def: StatDef): string {
  return def.ratio?.pct ? " * 100" : "";
}

/** Volume floor (summed denominator) qualifying a ratio stat for boards and
 * ranks, so tiny samples can't top a list. */
export function ratioFloor(def: StatDef, scope: string): number {
  return scope === "career"
    ? def.ratio?.floorCareer ?? 1000
    : def.ratio?.floorSeason ?? 150;
}

/** One clamped term of the NFL passer-rating formula. */
function prTerm(expr: string): string {
  return `LEAST(GREATEST(${expr}, 0), 2.375)`;
}

/** NFL passer rating over aggregated sums (agg=true) or one game's columns.
 * rating = (a + b + c + d) / 6 * 100 with each term clamped to [0, 2.375]:
 *   a = (CMP/ATT - 0.3) * 5      b = (YDS/ATT - 3) * 0.25
 *   c = TD/ATT * 20              d = 2.375 - INT/ATT * 25   */
export function passerRatingExpr(agg: boolean): string {
  const col = (c: string) => (agg ? `SUM(COALESCE(s.${c}, 0))` : `COALESCE(s.${c}, 0)`);
  const att = `NULLIF(${col("attempts")}, 0)`;
  const a = prTerm(`(${col("completions")}::numeric / ${att} - 0.3) * 5`);
  const b = prTerm(`(${col("passing_yards")}::numeric / ${att} - 3) * 0.25`);
  const c = prTerm(`${col("passing_tds")}::numeric / ${att} * 20`);
  const d = prTerm(`2.375 - ${col("interceptions")}::numeric / ${att} * 25`);
  return `ROUND((${a} + ${b} + ${c} + ${d}) / 6 * 100, 1)`;
}

/** Per-row ratio expression over the game log (one game's rate). */
export function ratioRowExpr(def: StatDef): string {
  return (
    `ROUND(COALESCE(s.${def.ratio!.num}, 0)::numeric / ` +
    `NULLIF(COALESCE(s.${def.ratio!.den}, 0), 0)${pctFactor(def)}, 1)`
  );
}

/** Whether two players can be compared head-to-head on this stat. */
export function isComparableStat(stat: string): boolean {
  return compareValueExpr({ stat }) !== null;
}

/** One game's value for a stat: rating formula, per-game rate, or raw column. */
export function perGameValueExpr(def: StatDef): string {
  return def.formula === "passer_rating"
    ? passerRatingExpr(false)
    : def.ratio ? ratioRowExpr(def) : def.expr;
}

/** Aggregate SELECT expression for a stat over the game log: plain SUM, or
 * the summed ratio for ratio stats (completion %, yards per carry). */
export function aggExpr(spec: { stat: string }): string {
  const def = statDef(spec);
  if (def.formula === "passer_rating") return passerRatingExpr(true);
  if (def.ratio) {
    return (
      `ROUND(SUM(COALESCE(s.${def.ratio.num}, 0))::numeric / ` +
      `NULLIF(SUM(COALESCE(s.${def.ratio.den}, 0)), 0)${pctFactor(def)}, 1)`
    );
  }
  return `SUM(${def.expr})`;
}

/** Summed value of a stat, honoring ratio stats which sum the numerator and
 * denominator separately rather than the empty `expr`. */
export function sumValueExpr(def: StatDef): string {
  if (def.formula === "passer_rating") return passerRatingExpr(true);
  return def.ratio
    ? `ROUND(SUM(COALESCE(s.${def.ratio.num}, 0))::numeric / NULLIF(SUM(COALESCE(s.${def.ratio.den}, 0)), 0)${pctFactor(def)}, 1)`
    : `SUM(${def.expr})`;
}

/** Window-aggregated ratio over already-scoped rows (see playerGameRowsSql). */
function ratioWindowExpr(def: StatDef): string {
  return `ROUND(SUM(ts._num) OVER ()::numeric / NULLIF(SUM(ts._den) OVER (), 0)${pctFactor(def)}, 1)`;
}

/** True when the question needs the game log instead of season rollups. */
export function needsGameLog(spec: PlayerTotalSpec): boolean {
  return Boolean(
    statDef(spec).source === "game" ||
      spec.venue ||
      spec.weekMin != null ||
      spec.weekMax != null ||
      spec.month != null ||
      spec.primetime ||
      spec.tempMax != null ||
      spec.firstN ||
      spec.lastN ||
      spec.sbOnly ||
      spec.gameResult != null ||
      spec.oneScore ||
      spec.oppWinningRecord ||
      spec.withPlayerId != null ||
      spec.opponentId != null,
  );
}

/** Playoff rounds are identified by ranking each postseason's weeks from the
 * end: the Super Bowl is the max week, the conference championships one week
 * earlier, and so on. Robust across every era's week numbering. */
const POST_MAX_WEEK =
  "(SELECT MAX(g2.week) FROM games g2 " +
  "WHERE g2.season = g.season AND g2.season_type = 'POST')";
const ROUND_OFFSET: Record<string, number> = { SB: 0, CON: 1, DIV: 2, WC: 3 };

export function roundPred(round: string): string {
  return `g.week = ${POST_MAX_WEEK} - ${ROUND_OFFSET[round] ?? 0}`;
}

/** Round name for display, derived the same way. */
export const ROUND_NAME_SQL =
  "CASE WHEN g.season_type <> 'POST' THEN 'REG' " +
  `WHEN g.week = ${POST_MAX_WEEK} THEN 'SB' ` +
  `WHEN g.week = ${POST_MAX_WEEK} - 1 THEN 'CON' ` +
  `WHEN g.week = ${POST_MAX_WEEK} - 2 THEN 'DIV' ` +
  "ELSE 'WC' END";

/** Any node that can be scoped to the game grain. */
export type GameScoped = GameWindow & { seasonType: string; season?: number | null };

/** The opponent's team_id for a stat row: the OTHER side of the joined
 * game. Same expression as the game-context `opponent` column (below),
 * reusable in predicates and per-opponent GROUP BYs. */
export const OPP_TEAM_EXPR = "CASE WHEN s.team_id = g.home_team THEN g.away_team ELSE g.home_team END";
const TEAM_SCORE_EXPR = "CASE WHEN s.team_id = g.home_team THEN g.home_score ELSE g.away_score END";
const OPP_SCORE_EXPR = "CASE WHEN s.team_id = g.home_team THEN g.away_score ELSE g.home_score END";

/** Shared game-log predicates (bound params). */
export function gamePreds(spec: GameScoped, p: Params): string[] {
  const preds = [`g.season_type = ${p.add(spec.seasonType)}`];
  if (spec.seasonMin != null && spec.seasonMax != null) {
    preds.push(`g.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`);
  } else if (spec.season != null) {
    preds.push(`g.season = ${p.add(spec.season)}`);
  }
  if (spec.venue === "home") preds.push("s.team_id = g.home_team");
  if (spec.venue === "away") preds.push("s.team_id = g.away_team");
  if (spec.weekMin != null) preds.push(`g.week >= ${p.add(spec.weekMin)}`);
  if (spec.weekMax != null) preds.push(`g.week <= ${p.add(spec.weekMax)}`);
  if (spec.month != null) {
    preds.push(`EXTRACT(MONTH FROM g.game_date) = ${p.add(spec.month)}`);
  }
  if (spec.primetime) {
    preds.push(
      "(g.weekday IN ('Monday', 'Thursday') OR " +
      "(g.weekday IN ('Sunday', 'Saturday') AND g.gametime >= '20:00'))",
    );
  }
  if (spec.tempMax != null) preds.push(`g.temp <= ${p.add(spec.tempMax)}`);
  if (spec.sbOnly || spec.round) preds.push(roundPred(spec.round ?? "SB"));
  if (spec.opponentId) {
    const opp = p.add(spec.opponentId);
    preds.push(`(g.home_team = ${opp} OR g.away_team = ${opp}) AND s.team_id <> ${opp}`);
  }
  if (spec.gameResult === "W") preds.push(`${TEAM_SCORE_EXPR} > ${OPP_SCORE_EXPR}`);
  if (spec.gameResult === "L") preds.push(`${TEAM_SCORE_EXPR} < ${OPP_SCORE_EXPR}`);
  if (spec.oneScore) preds.push("ABS(g.home_score - g.away_score) <= 8");
  if (spec.withPlayerId) {
    // "Played together" = the teammate has a stat row in the same game for
    // the same team. ponytail: appeared-in-game, not snaps-overlapped —
    // snap-level overlap needs data the warehouse doesn't carry.
    preds.push(
      `EXISTS (SELECT 1 FROM player_game_stats w WHERE w.game_id = s.game_id ` +
      `AND w.team_id = s.team_id AND w.player_id = ${p.add(spec.withPlayerId)})`,
    );
  }
  if (spec.oppWinningRecord) {
    // Deliberately an UNCORRELATED (team_id, season) IN-subquery, not a
    // per-outer-row correlated scalar subquery: the inner SELECT names no
    // outer column, so Postgres computes the small (~team-seasons) winning-
    // record set ONCE and hash-probes it per row, instead of re-scanning
    // team_game_stats/games for every game in the outer (up to ~475k-row)
    // game log — the earlier correlated version measurably timed out at
    // that scale. Same team_game_stats.result-based "final season record"
    // simplification named in the field's doc comment either way.
    preds.push(
      `(${OPP_TEAM_EXPR}, g.season) IN (` +
      "SELECT tgs.team_id, g2.season FROM team_game_stats tgs " +
      "JOIN games g2 ON g2.game_id = tgs.game_id " +
      "WHERE g2.season_type = 'REG' " +
      "GROUP BY tgs.team_id, g2.season " +
      "HAVING SUM(CASE WHEN tgs.result = 'W' THEN 1 WHEN tgs.result = 'T' THEN 0.5 ELSE 0 END) / " +
      "NULLIF(COUNT(*), 0) > 0.5)",
    );
  }
  return preds;
}

/** Games on/after the player's Nth birthday ("after turning 30").
 * ponytail: players with no birth_date on file (~15%) are excluded, not
 * guessed — an honest smaller board beats a wrong one. */
export function minAgePred(minAgeYears: number, p: Params): string {
  return `p.birth_date IS NOT NULL AND g.game_date >= p.birth_date + ${p.add(minAgeYears)} * INTERVAL '1 year'`;
}

/** Games before the player's Nth season ("before their fifth season" =
 * seasons 1..4; rookie_season is season 1). Players with no rookie_season
 * on file are excluded — same honest-smaller-board call as minAgePred. */
export function beforeSeasonPred(beforeSeasonN: number, p: Params): string {
  return `p.rookie_season IS NOT NULL AND g.season < p.rookie_season + ${p.add(beforeSeasonN - 1)}`;
}

/** Season-rollup stat block by position — the season-by-season view shows the
 * whole line. Aliases double as display labels. (No carries column in the
 * season table, unlike the game log.) */
export function seasonStatCols(position: string | null | undefined): string[] {
  if (position === "QB") {
    return [
      "s.completions AS cmp", "s.attempts AS att", "s.passing_yards AS pass_yds",
      "s.passing_tds AS pass_td", "s.interceptions AS int",
      "s.rushing_yards AS rush_yds", "s.rushing_tds AS rush_td",
    ];
  }
  if (["DL", "DE", "DT", "NT", "LB", "ILB", "OLB", "MLB", "CB", "S", "FS", "SS", "DB", "EDGE"].includes(position ?? "")) {
    return [
      "s.tackles AS tkl", "s.def_sacks AS sck", "s.def_interceptions AS int",
      "s.forced_fumbles AS ff", "s.passes_defended AS pd",
    ];
  }
  return [
    "s.rushing_yards AS rush_yds", "s.rushing_tds AS rush_td",
    "s.receptions AS rec", "s.receiving_yards AS rec_yds", "s.receiving_tds AS rec_td",
  ];
}

/** Predicate scoping a season-rollup row to the player's rookie season. */
export const ROOKIE_PRED =
  "s.season = (SELECT MIN(s2.season) FROM player_season_stats s2 " +
  "WHERE s2.player_id = s.player_id AND s2.season_type = 'REG')";

/** Per-game stat block by position — a game log shows the whole line, not
 * one number. Column names double as display labels. */
function gameLogStatCols(position: string | null | undefined): string[] {
  if (position === "QB") {
    return [
      "s.completions AS cmp", "s.attempts AS att", "s.passing_yards AS pass_yds",
      "s.passing_tds AS pass_td", "s.interceptions AS int",
      "s.rushing_yards AS rush_yds", "s.rushing_tds AS rush_td",
    ];
  }
  if (["DL", "DE", "DT", "NT", "LB", "ILB", "OLB", "MLB", "CB", "S", "FS", "SS", "DB", "EDGE"].includes(position ?? "")) {
    return [
      "s.tackles AS tkl", "s.def_sacks AS sck", "s.def_interceptions AS int",
      "s.forced_fumbles AS ff", "s.passes_defended AS pd",
    ];
  }
  return [
    "s.carries AS car", "s.rushing_yards AS rush_yds", "s.rushing_tds AS rush_td",
    "s.receptions AS rec", "s.receiving_yards AS rec_yds", "s.receiving_tds AS rec_td",
  ];
}

/** Game context columns shared by every game-shaped row. */
const GAME_CTX_COLS =
  "g.game_id, g.season, g.week, g.game_date, " +
  "CASE WHEN s.team_id = g.home_team THEN g.away_team ELSE g.home_team END AS opponent, " +
  "CASE WHEN s.team_id = g.home_team THEN g.home_score ELSE g.away_score END AS team_score, " +
  "CASE WHEN s.team_id = g.home_team THEN g.away_score ELSE g.home_score END AS opp_score";

export const RESULT_COL =
  "CASE WHEN ts.team_score > ts.opp_score THEN 'W' " +
  "WHEN ts.team_score < ts.opp_score THEN 'L' ELSE 'T' END AS result";

/** Player game rows (windowed to first/last N) with per-game stat value plus
 * window totals the narration reads. Serves widened player_total and the
 * explicit game_log intent. */
export function playerGameRowsSql(
  spec: PlayerTotalSpec | GameLogSpec,
  p: Params,
  playerPred: string,
): string {
  const def = statDef(spec);
  const n = spec.firstN ?? spec.lastN;
  const dir = spec.lastN ? "DESC" : "ASC";
  const statCols =
    spec.intent === "game_log"
      ? gameLogStatCols(spec.position).join(", ")
      : def.ratio
        ? `${ratioRowExpr(def)} AS value`
        : `${def.expr} AS value`;
  // Ratio totals need the raw numerator/denominator per row so the window can
  // re-derive the percentage; _num/_den are stripped from the response.
  const ratioHelpers =
    spec.intent !== "game_log" && def.ratio
      ? `, COALESCE(s.${def.ratio.num}, 0) AS _num, COALESCE(s.${def.ratio.den}, 0) AS _den`
      : "";
  const innerWhere = [playerPred, ...gamePreds(spec, p)];
  let scoped =
    `SELECT ${GAME_CTX_COLS}, ${statCols}${ratioHelpers}, ${ROUND_NAME_SQL} AS round ` +
    "FROM player_game_stats s " +
    "JOIN games g ON g.game_id = s.game_id " +
    `WHERE ${innerWhere.join(" AND ")} ` +
    `ORDER BY g.season ${dir}, g.week ${dir}`;
  // LIMIT must apply BEFORE the window totals: a first/last-N window reports
  // the window's own total, not the whole career. So aggregate in an outer
  // layer over the already-limited rows.
  if (n) scoped += ` LIMIT ${p.add(n)}`;
  const totalExpr =
    spec.intent === "game_log"
      ? "NULL"
      : def.ratio
        ? ratioWindowExpr(def)
        : spec.perGame
          ? "ROUND(SUM(ts.value) OVER ()::numeric / NULLIF(COUNT(*) OVER (), 0), 1)"
          : "SUM(ts.value) OVER ()";
  // Display order is always most recent first, whatever the window direction.
  return (
    `SELECT ts.*, ${totalExpr} AS total, COUNT(*) OVER () AS games, ${RESULT_COL} ` +
    `FROM (${scoped}) ts ORDER BY ts.season DESC, ts.week DESC`
  );
}

/** NFL passer rating over already-summed columns on `alias` (COMPARE's agg
 * subquery), rather than SUM(s.col) as passerRatingExpr does. */
function passerRatingAggExpr(alias: string): string {
  const att = `NULLIF(${alias}.attempts, 0)`;
  const a = prTerm(`(${alias}.completions::numeric / ${att} - 0.3) * 5`);
  const b = prTerm(`(${alias}.passing_yards::numeric / ${att} - 3) * 0.25`);
  const c = prTerm(`${alias}.passing_tds::numeric / ${att} * 20`);
  const d = prTerm(`2.375 - ${alias}.interceptions::numeric / ${att} * 25`);
  return `ROUND((${a} + ${b} + ${c} + ${d}) / 6 * 100, 1)`;
}

/** The value COMPARE ranks and narrates on, computed from the aggregated
 * columns of the `agg` subquery — the actual requested stat (ratio, formula, or
 * sum), never a silent fantasy-points substitution. Returns null when the stat
 * can't be computed from COMPARE's aggregate (advanced pbp stats that live in
 * player_game_advanced), so the parser can refuse instead of emitting bad SQL. */
export function compareValueExpr(spec: { stat: string }): string | null {
  const def = statDef(spec);
  if (def.formula === "passer_rating") return passerRatingAggExpr("agg");
  if (def.ratio) {
    const { num, den, pct } = def.ratio;
    if (!COMPARE_COL_SET.has(num) || !COMPARE_COL_SET.has(den)) return null;
    return `ROUND(agg.${num}::numeric / NULLIF(agg.${den}, 0)${pct ? " * 100" : ""}, 1)`;
  }
  // Simple ("s.passing_yards") or computed ("COALESCE(s.passing_tds,0)+...").
  // Comparable only if every column it references is in the aggregate.
  const cols = [...def.expr.matchAll(/\bs\.(\w+)/g)].map((m) => m[1]!);
  if (cols.length === 0 || !cols.every((c) => COMPARE_COL_SET.has(c))) return null;
  return def.expr.replace(/\bs\./g, "agg.");
}


// ---- Capability: which stats each grain of storage can compute ----
//
// A stat is only answerable by an executor whose table holds every column it
// references. player_season_stats is the rollup (no per-game-only columns);
// player_game_stats adds carries/targets/air yards; pbp aggregates
// (EPA, success rate, CPOE) live in player_game_advanced. Executors that route
// by grain (leaders, player_total, game_log, and player_rank's advanced branch)
// handle all of them; the ones below aggregate a single fixed table and must
// refuse what that table can't compute — see statComputableFor.

const SEASON_COLS = new Set([
  "passing_yards", "passing_tds", "interceptions", "rushing_yards", "rushing_tds",
  "receptions", "receiving_yards", "receiving_tds", "fantasy_points_ppr",
  "completions", "attempts", "sacks", "sack_yards", "fumbles", "fumbles_lost",
  "tackles", "def_sacks", "def_interceptions", "forced_fumbles", "passes_defended",
]);
const GAME_COLS = new Set([
  ...SEASON_COLS, "carries", "targets", "passing_air_yards", "receiving_air_yards",
]);
const ADVANCED_COLS = new Set([
  "pass_plays", "pass_epa", "pass_success", "cpoe_sum", "cpoe_n",
  "rush_plays", "rush_epa", "rush_success", "recv_plays", "recv_epa", "recv_success",
]);

/** Every stat column a StatDef references (ratio num/den, passer-rating inputs,
 * or the `s.<col>` columns in its expr). */
export function statColumns(def: StatDef): string[] {
  if (def.formula === "passer_rating") {
    return ["completions", "attempts", "passing_yards", "passing_tds", "interceptions"];
  }
  const cols: string[] = [];
  if (def.ratio) cols.push(def.ratio.num, def.ratio.den);
  for (const m of def.expr.matchAll(/\bs\.(\w+)/g)) cols.push(m[1]!);
  return cols;
}

function isAdvancedStat(def: StatDef): boolean {
  return def.table === "advanced" || statColumns(def).some((c) => ADVANCED_COLS.has(c));
}

/** Plain season-rollup stats: a non-empty single expression over
 * player_season_stats columns. The Task-6 negation fields
 * (withoutSeasonAtLeast / withoutLeagueLead / crossStatBelow pairs) may only
 * name these — ratio/formula stats have no per-row expr to MAX(), and
 * game-only columns (carries, air yards, EPA) don't exist in the season
 * rollup at all, so an ungated stat here is a live 500, not a wrong number. */
export function isSeasonRollupStat(stat: string): boolean {
  const def = STATS[stat];
  if (!def || def.ratio || def.formula || def.source === "game") return false;
  return statColumns(def).every((c) => SEASON_COLS.has(c));
}

/** Whether the executor for `intent` can compute `stat` from its storage grain.
 * The gate that keeps a mis-routed stat an honest refusal instead of invalid
 * SQL (SUM() over an empty ratio expr, or a column the table doesn't have). */
export function statComputableFor(intent: string, stat: string): boolean {
  const def = STATS[stat];
  if (!def) return false;
  const cols = statColumns(def);
  const inSeason = cols.every((c) => SEASON_COLS.has(c));
  const inGame = cols.every((c) => GAME_COLS.has(c));
  const advanced = isAdvancedStat(def);
  switch (intent) {
    case "qualifying_count":
      return inSeason;
    case "player_rank":
      // Season rollup, or the dedicated advanced-table branch for pbp stats.
      return inSeason || advanced;
    case "team_stat":
    case "game_count":
    case "game_count_leaders":
    case "single_game":
      return inGame && !advanced;
    case "player_streak":
      return inGame && !advanced;
    case "milestone":
      // Cumulative running total — additive stats only (a running ratio is
      // meaningless).
      return inGame && !advanced && !def.ratio && !def.formula;
    default:
      // leaders, player_total, game_log, compare route/guard themselves.
      return true;
  }
}
