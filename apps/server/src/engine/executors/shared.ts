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

import { STATS, specExpr } from "../spec.js";
import type { GameLogSpec, GameWindow, PlayerTotalSpec, StatDef } from "../spec.js";

// Every stat column, for COMPARE's full-line output (allowlisted names only).
export const ALL_STAT_COLS = [
  "completions", "attempts", "passing_yards", "passing_tds", "interceptions",
  "rushing_yards", "rushing_tds", "receptions", "receiving_yards",
  "receiving_tds", "tackles", "def_sacks", "def_interceptions",
  "forced_fumbles", "passes_defended", "sacks", "fantasy_points_ppr",
] as const;

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
export function ratioWindowExpr(def: StatDef): string {
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
      spec.sbOnly,
  );
}

/** Playoff rounds are identified by ranking each postseason's weeks from the
 * end: the Super Bowl is the max week, the conference championships one week
 * earlier, and so on. Robust across every era's week numbering. */
export const POST_MAX_WEEK =
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
  return preds;
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
export function gameLogStatCols(position: string | null | undefined): string[] {
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
export const GAME_CTX_COLS =
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

/** The stat column COMPARE ranks and narrates on. */
export function compareOrderCol(spec: { stat: string }): string {
  const expr = specExpr(spec);
  return /^s\.\w+$/.test(expr) ? expr.slice(2) : "fantasy_points_ppr";
}
