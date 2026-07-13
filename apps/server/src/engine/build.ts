/** Deterministic SQL builder + narration for a QuerySpec.
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

import { STATS, specExpr, specLabel } from "./spec.js";
import type { QuerySpec } from "./spec.js";

// Every stat column, for COMPARE's full-line output (allowlisted names only).
const ALL_STAT_COLS = [
  "completions", "attempts", "passing_yards", "passing_tds", "interceptions",
  "rushing_yards", "rushing_tds", "receptions", "receiving_yards",
  "receiving_tds", "tackles", "def_sacks", "def_interceptions",
  "forced_fumbles", "passes_defended", "sacks", "fantasy_points_ppr",
] as const;

class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

function statDef(spec: QuerySpec) {
  return STATS[spec.stat]!;
}

/** Aggregate SELECT expression for a stat over the game log: plain SUM, or
 * the summed ratio for ratio stats (completion %). */
function aggExpr(spec: QuerySpec): string {
  const def = statDef(spec);
  if (def.ratio) {
    return (
      `ROUND(SUM(COALESCE(s.${def.ratio.num}, 0))::numeric / ` +
      `NULLIF(SUM(COALESCE(s.${def.ratio.den}, 0)), 0) * 100, 1)`
    );
  }
  return `SUM(${def.expr})`;
}

/** True when the question needs the game log instead of season rollups. */
function needsGameLog(spec: QuerySpec): boolean {
  return Boolean(
    statDef(spec).source === "game" ||
      spec.venue ||
      spec.weekMin != null ||
      spec.weekMax != null ||
      spec.firstN ||
      spec.lastN ||
      spec.sbOnly,
  );
}

/** Playoff rounds are identified by ranking each postseason's weeks from the
 * end: the Super Bowl is the max week, the conference championships one week
 * earlier, and so on. Robust across every era's week numbering. */
const POST_MAX_WEEK =
  "(SELECT MAX(g2.week) FROM games g2 " +
  "WHERE g2.season = g.season AND g2.season_type = 'POST')";
const ROUND_OFFSET: Record<string, number> = { SB: 0, CON: 1, DIV: 2, WC: 3 };

function roundPred(round: string): string {
  return `g.week = ${POST_MAX_WEEK} - ${ROUND_OFFSET[round] ?? 0}`;
}

/** Round name for display, derived the same way. */
const ROUND_NAME_SQL =
  "CASE WHEN g.season_type <> 'POST' THEN 'REG' " +
  `WHEN g.week = ${POST_MAX_WEEK} THEN 'SB' ` +
  `WHEN g.week = ${POST_MAX_WEEK} - 1 THEN 'CON' ` +
  `WHEN g.week = ${POST_MAX_WEEK} - 2 THEN 'DIV' ` +
  "ELSE 'WC' END";

/** Shared game-log predicates (bound params). */
function gamePreds(spec: QuerySpec, p: Params): string[] {
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
  if (spec.sbOnly || spec.round) preds.push(roundPred(spec.round ?? "SB"));
  if (spec.opponentId) {
    const opp = p.add(spec.opponentId);
    preds.push(`(g.home_team = ${opp} OR g.away_team = ${opp}) AND s.team_id <> ${opp}`);
  }
  return preds;
}

/** One player's aggregate over the scoped games (season type, optional
 * season, optional first-N career games). */
function compareSide(pidPh: string, spec: QuerySpec, p: Params): string {
  const where = [`s.player_id = ${pidPh}`, ...gamePreds(spec, p)];
  let inner =
    `SELECT ${ALL_STAT_COLS.map((c) => `s.${c}`).join(", ")} ` +
    "FROM player_game_stats s JOIN games g ON g.game_id = s.game_id " +
    `WHERE ${where.join(" AND ")} ` +
    "ORDER BY g.season, g.week";
  if (spec.firstN) inner += ` LIMIT ${p.add(spec.firstN)}`;
  const sums = ALL_STAT_COLS.map((c) => `COALESCE(SUM(${c}), 0) AS ${c}`).join(", ");
  return `SELECT ${pidPh} AS pid, COUNT(*) AS games, ${sums} FROM (${inner}) scoped`;
}

/** Season-rollup stat block by position — the season-by-season view shows the
 * whole line. Aliases double as display labels. (No carries column in the
 * season table, unlike the game log.) */
function seasonStatCols(position: string | null | undefined): string[] {
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
const ROOKIE_PRED =
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

const RESULT_COL =
  "CASE WHEN ts.team_score > ts.opp_score THEN 'W' " +
  "WHEN ts.team_score < ts.opp_score THEN 'L' ELSE 'T' END AS result";

/** Player game rows (windowed to first/last N) with per-game stat value plus
 * window totals the narration reads. Serves widened player_total and the
 * explicit game_log intent. */
function playerGameRowsSql(spec: QuerySpec, p: Params, playerPred: string): string {
  const def = statDef(spec);
  const n = spec.firstN ?? spec.lastN;
  const dir = spec.lastN ? "DESC" : "ASC";
  const isGameLog = spec.intent === "game_log";
  const statCols = isGameLog
    ? gameLogStatCols(spec.position).join(", ")
    : def.ratio
      ? `ROUND(COALESCE(s.${def.ratio.num}, 0)::numeric / NULLIF(COALESCE(s.${def.ratio.den}, 0), 0) * 100, 1) AS value`
      : `${def.expr} AS value`;
  // Ratio totals need the raw numerator/denominator per row so the window can
  // re-derive the percentage; _num/_den are stripped from the response.
  const ratioHelpers =
    !isGameLog && def.ratio
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
  const totalExpr = isGameLog
    ? "NULL"
    : def.ratio
      ? "ROUND(SUM(ts._num) OVER ()::numeric / NULLIF(SUM(ts._den) OVER (), 0) * 100, 1)"
      : spec.perGame
        ? "ROUND(SUM(ts.value) OVER ()::numeric / NULLIF(COUNT(*) OVER (), 0), 1)"
        : "SUM(ts.value) OVER ()";
  // Display order is always most recent first, whatever the window direction.
  return (
    `SELECT ts.*, ${totalExpr} AS total, COUNT(*) OVER () AS games, ${RESULT_COL} ` +
    `FROM (${scoped}) ts ORDER BY ts.season DESC, ts.week DESC`
  );
}

/** Game rows from one team's perspective (team_game_log / game_result), or
 * neutral home/away rows when no team anchors the question. */
function gameRowsSql(spec: QuerySpec, p: Params): string {
  const preds: string[] = ["g.home_score IS NOT NULL"]; // completed games only
  if (spec.season != null) preds.push(`g.season = ${p.add(spec.season)}`);
  if (spec.round) {
    preds.push("g.season_type = 'POST'", roundPred(spec.round));
  } else if (spec.seasonType === "POST") {
    preds.push("g.season_type = 'POST'");
  } else if (spec.season != null || spec.weekMin != null) {
    preds.push("g.season_type = 'REG'");
  }
  if (spec.weekMin != null) preds.push(`g.week >= ${p.add(spec.weekMin)}`);
  if (spec.weekMax != null) preds.push(`g.week <= ${p.add(spec.weekMax)}`);
  if (spec.gameDate) preds.push(`g.game_date = ${p.add(spec.gameDate)}`);
  if (spec.marginMax != null) {
    preds.push(`ABS(g.home_score - g.away_score) <= ${p.add(spec.marginMax)}`);
  }
  if (spec.conf) {
    const conf = p.add(spec.conf);
    preds.push(
      `EXISTS (SELECT 1 FROM teams tc WHERE tc.team_id = g.home_team AND tc.conference = ${conf})`,
    );
  }

  if (spec.teamId) {
    const tid = p.add(spec.teamId);
    preds.push(`(g.home_team = ${tid} OR g.away_team = ${tid})`);
    if (spec.team2Id) {
      const t2 = p.add(spec.team2Id);
      preds.push(`(g.home_team = ${t2} OR g.away_team = ${t2})`);
    }
    if (spec.venue === "home") preds.push(`g.home_team = ${tid}`);
    if (spec.venue === "away") preds.push(`g.away_team = ${tid}`);
    const inner =
      "SELECT g.game_id, g.season, g.week, g.game_date, " +
      `${ROUND_NAME_SQL} AS round, ` +
      `CASE WHEN g.home_team = ${tid} THEN g.away_team ELSE g.home_team END AS opponent, ` +
      `CASE WHEN g.home_team = ${tid} THEN 'home' ELSE 'away' END AS venue, ` +
      `CASE WHEN g.home_team = ${tid} THEN g.home_score ELSE g.away_score END AS team_score, ` +
      `CASE WHEN g.home_team = ${tid} THEN g.away_score ELSE g.home_score END AS opp_score ` +
      "FROM games g " +
      `WHERE ${preds.join(" AND ")}`;
    return (
      `SELECT ts.*, ${RESULT_COL} FROM (${inner}) ts ` +
      "ORDER BY ts.season DESC, ts.week DESC " +
      `LIMIT ${p.add(spec.limit)}`
    );
  }

  // Neutral rows ("who won Super Bowl 50"): both teams by name, winner first
  // in narration; most recent matching game first.
  return (
    "SELECT g.game_id, g.season, g.week, g.game_date, " +
    `${ROUND_NAME_SQL} AS round, ` +
    "ht.name AS home_name, g.home_team, g.home_score, " +
    "at.name AS away_name, g.away_team, g.away_score, g.stadium " +
    "FROM games g " +
    "JOIN teams ht ON ht.team_id = g.home_team " +
    "JOIN teams at ON at.team_id = g.away_team " +
    `WHERE ${preds.join(" AND ")} ` +
    "ORDER BY g.season DESC, g.week DESC " +
    `LIMIT ${p.add(spec.limit)}`
  );
}

/** Draft lookups: by overall pick, by team, by round, or by player name. */
function draftSql(spec: QuerySpec, p: Params): string {
  const preds: string[] = [];
  if (spec.playerId) {
    preds.push(`d.player_id = ${p.add(spec.playerId)}`);
  } else if (spec.player) {
    preds.push(`lower(d.player_name) = ${p.add(spec.player.toLowerCase())}`);
  }
  if (spec.season != null) {
    preds.push(`d.season = ${p.add(spec.season)}`);
  } else if (spec.draftPick != null && !spec.playerId && !spec.player) {
    // "the first pick" with no year means the most recent draft.
    preds.push("d.season = (SELECT MAX(season) FROM draft_picks)");
  }
  if (spec.draftPick != null) preds.push(`d.pick = ${p.add(spec.draftPick)}`);
  if (spec.draftRound != null) preds.push(`d.round = ${p.add(spec.draftRound)}`);
  if (spec.teamId) preds.push(`d.team_id = ${p.add(spec.teamId)}`);
  return (
    "SELECT d.season, d.round, d.pick, d.team_id AS team, t.name AS team_name, " +
    "d.player_name, d.position, d.college, d.player_id " +
    "FROM draft_picks d LEFT JOIN teams t ON t.team_id = d.team_id " +
    (preds.length ? `WHERE ${preds.join(" AND ")} ` : "") +
    `ORDER BY d.season DESC, d.pick LIMIT ${p.add(spec.limit)}`
  );
}

/** Player bio / roster: one player's card, or a bio-superlative board. */
function bioSql(spec: QuerySpec, p: Params): string {
  const bioCols =
    "p.player_id, p.full_name, p.position, p.birth_date, p.height_inches, " +
    "p.weight_lbs, p.college, EXTRACT(YEAR FROM age(p.birth_date))::int AS age";
  if (spec.playerId) {
    return (
      `SELECT ${bioCols}, latest.team_id AS team, t.name AS team_name ` +
      "FROM players p " +
      "LEFT JOIN LATERAL (SELECT team_id FROM player_season_stats s " +
      "WHERE s.player_id = p.player_id AND s.team_id IS NOT NULL " +
      "ORDER BY s.season DESC LIMIT 1) latest ON true " +
      "LEFT JOIN teams t ON t.team_id = latest.team_id " +
      `WHERE p.player_id = ${p.add(spec.playerId)}`
    );
  }
  // Superlative board. Age ranks by birth_date (oldest = earliest), so the
  // requested direction inverts relative to the raw column.
  const col =
    spec.bioField === "weight" ? "p.weight_lbs"
      : spec.bioField === "age" ? "p.birth_date"
        : "p.height_inches";
  const dir =
    spec.bioField === "age"
      ? spec.dir === "desc" ? "ASC" : "DESC"
      : spec.dir === "asc" ? "ASC" : "DESC";
  const preds = [
    `${col} IS NOT NULL`,
    "EXISTS (SELECT 1 FROM player_season_stats s WHERE s.player_id = p.player_id)",
  ];
  // Physical-plausibility bounds so a corrupt roster row (e.g. a 6'11", 173 lb
  // DB whose height is mis-entered) can't win a superlative board.
  if (spec.bioField === "height") preds.push("p.height_inches BETWEEN 63 AND 82");
  else if (spec.bioField === "weight") preds.push("p.weight_lbs BETWEEN 150 AND 400");
  else if (spec.bioField === "age") preds.push("p.birth_date >= DATE '1970-01-01'");
  if (spec.position) preds.push(`p.position = ${p.add(spec.position)}`);
  return (
    `SELECT ${bioCols} FROM players p WHERE ${preds.join(" AND ")} ` +
    `ORDER BY ${col} ${dir}, p.full_name LIMIT ${p.add(spec.limit)}`
  );
}

/** Summed value of a stat, honoring ratio stats (completion %) which sum the
 * numerator/denominator separately rather than the empty `expr`. */
function sumValueExpr(def: { expr: string; ratio?: { num: string; den: string } }): string {
  return def.ratio
    ? `ROUND(SUM(COALESCE(s.${def.ratio.num}, 0))::numeric / NULLIF(SUM(COALESCE(s.${def.ratio.den}, 0)), 0) * 100, 1)`
    : `SUM(${def.expr})`;
}

/** How many players cleared a season (or career) stat threshold. */
function qualifyingCountSql(spec: QuerySpec, p: Params): string {
  const def = statDef(spec);
  const op = { ">": ">", ">=": ">=", "<": "<" }[spec.threshold!.op];
  const join = spec.position ? "JOIN players p ON p.player_id = s.player_id " : "";
  const posPred = spec.position ? ` AND p.position = ${p.add(spec.position)}` : "";
  if (spec.scope === "career") {
    // Ratio stats need a volume floor so tiny samples don't clear the bar.
    const having = def.ratio
      ? `HAVING ${sumValueExpr(def)} ${op} ${p.add(spec.threshold!.value)} ` +
        `AND SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(1000)}`
      : `HAVING SUM(${def.expr}) ${op} ${p.add(spec.threshold!.value)}`;
    return (
      "SELECT COUNT(*) AS qualifying_players FROM (" +
      "SELECT s.player_id FROM player_season_stats s " + join +
      `WHERE s.season_type = ${p.add(spec.seasonType)}${posPred} ` +
      `GROUP BY s.player_id ${having}) x`
    );
  }
  const preds = [`s.season_type = ${p.add(spec.seasonType)}`];
  if (spec.season != null) preds.push(`s.season = ${p.add(spec.season)}`);
  const valuePred = def.ratio
    ? `ROUND(COALESCE(s.${def.ratio.num}, 0)::numeric / NULLIF(COALESCE(s.${def.ratio.den}, 0), 0) * 100, 1) ${op} ${p.add(spec.threshold!.value)} ` +
      `AND COALESCE(s.${def.ratio.den}, 0) >= ${p.add(150)}`
    : `${def.expr} ${op} ${p.add(spec.threshold!.value)}`;
  return (
    "SELECT COUNT(*) AS qualifying_players FROM player_season_stats s " + join +
    `WHERE ${preds.join(" AND ")}${posPred} AND ${valuePred}`
  );
}

/** One player's league rank on a stat over a scope (career / season / range). */
function rankSql(spec: QuerySpec, p: Params): string {
  const def = statDef(spec);
  const valueExpr = sumValueExpr(def);
  const preds = [`s.season_type = ${p.add(spec.seasonType)}`];
  if (spec.seasonMin != null && spec.seasonMax != null) {
    preds.push(`s.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`);
  } else if (spec.scope !== "career" && spec.season != null) {
    preds.push(`s.season = ${p.add(spec.season)}`);
  }
  const posPred = spec.position ? ` AND p.position = ${p.add(spec.position)}` : "";
  // Ratio ranks need a volume floor; counted denominators exclude non-producers
  // so "1st of N" reflects players who actually recorded the stat.
  const having = def.ratio
    ? ` HAVING SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(spec.scope === "career" ? 1000 : 150)}`
    : ` HAVING SUM(${def.expr}) > 0`;
  return (
    "WITH ranked AS (" +
    `SELECT p.player_id, p.full_name, ${valueExpr} AS value, ` +
    `RANK() OVER (ORDER BY ${valueExpr} DESC) AS rk, ` +
    "COUNT(*) OVER () AS total_players " +
    "FROM player_season_stats s JOIN players p ON p.player_id = s.player_id " +
    `WHERE ${preds.join(" AND ")}${posPred} ` +
    `GROUP BY p.player_id, p.full_name${having}) ` +
    `SELECT * FROM ranked WHERE player_id = ${p.add(spec.playerId)}`
  );
}

export function buildSql(spec: QuerySpec): { sql: string; params: unknown[] } {
  const p = new Params();

  if (spec.intent === "player_bio") return { sql: bioSql(spec, p), params: p.values };
  if (spec.intent === "qualifying_count") {
    return { sql: qualifyingCountSql(spec, p), params: p.values };
  }
  if (spec.intent === "player_rank") return { sql: rankSql(spec, p), params: p.values };

  if (spec.intent === "game_log" && spec.playerId) {
    const pred = `s.player_id = ${p.add(spec.playerId)}`;
    return { sql: playerGameRowsSql(spec, p, pred), params: p.values };
  }
  if (spec.intent === "player_seasons") {
    // No name column: the answer's player card already identifies him, and
    // narration reads the name from spec.player.
    const sql =
      "SELECT s.season, s.team_id AS team, " +
      `COALESCE(s.games_played, 0) AS gp, ${seasonStatCols(spec.position).join(", ")} ` +
      "FROM player_season_stats s " +
      `WHERE s.player_id = ${p.add(spec.playerId)} AND s.season_type = 'REG' ` +
      "ORDER BY s.season DESC";
    return { sql, params: p.values };
  }
  if (spec.intent === "team_game_log" || spec.intent === "game_result") {
    return { sql: gameRowsSql(spec, p), params: p.values };
  }
  if (spec.intent === "draft_pick") {
    return { sql: draftSql(spec, p), params: p.values };
  }

  if (spec.intent === "compare") {
    const p1 = p.add(spec.playerId);
    const p2 = p.add(spec.player2Id);
    const side1 = compareSide(p1, spec, p);
    const side2 = compareSide(p2, spec, p);
    const statCols = ALL_STAT_COLS.map((c) => `agg.${c}`).join(", ");
    const orderCol = compareOrderCol(spec);
    const sql =
      `SELECT p.player_id, p.full_name, agg.games, ${statCols} ` +
      `FROM (${side1} UNION ALL ${side2}) agg ` +
      "JOIN players p ON p.player_id = agg.pid " +
      `ORDER BY agg.${orderCol} DESC`;
    return { sql, params: p.values };
  }

  if (spec.intent === "scoring") {
    const where = [
      `sp.player_id = ${p.add(spec.playerId)}`,
      `g.season_type = ${p.add(spec.seasonType)}`,
    ];
    if (spec.season != null) where.push(`g.season = ${p.add(spec.season)}`);
    if (spec.sbOnly || spec.round) where.push(roundPred(spec.round ?? "SB"));
    const dir = spec.edge === "first" ? "ASC" : "DESC";
    const sql =
      "SELECT p.player_id, p.full_name, g.season, g.week, g.game_date, " +
      "CASE WHEN sp.team_id = g.home_team THEN g.away_team " +
      "ELSE g.home_team END AS opponent, " +
      "sp.qtr, sp.play_type, sp.description " +
      "FROM scoring_plays sp " +
      "JOIN games g ON g.game_id = sp.game_id " +
      "JOIN players p ON p.player_id = sp.player_id " +
      `WHERE ${where.join(" AND ")} ` +
      `ORDER BY g.season ${dir}, g.week ${dir}, sp.play_id ${dir} ` +
      `LIMIT ${p.add(spec.edge ? 1 : spec.limit)}`;
    return { sql, params: p.values };
  }

  if (spec.intent === "game_count") {
    // Qualifying games: list them and window-count the full set.
    const def = statDef(spec);
    const valueExpr = def.ratio ? `COALESCE(s.${def.ratio.num}, 0)` : def.expr;
    const opSql = { ">": ">", ">=": ">=", "<": "<" }[spec.threshold!.op];
    const where = [
      `s.player_id = ${p.add(spec.playerId)}`,
      ...gamePreds(spec, p),
      `${valueExpr} ${opSql} ${p.add(spec.threshold!.value)}`,
    ];
    const sql =
      "SELECT p.player_id, p.full_name, g.season, g.week, " +
      "CASE WHEN s.team_id = g.home_team THEN g.away_team " +
      "ELSE g.home_team END AS opponent, " +
      `${valueExpr} AS value, COUNT(*) OVER () AS qualifying_games ` +
      "FROM player_game_stats s " +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")} ` +
      `ORDER BY value DESC, g.season DESC, g.week LIMIT ${p.add(spec.limit)}`;
    return { sql, params: p.values };
  }

  if (spec.intent === "leaders") {
    const def = statDef(spec);
    // Week/venue-filtered leaders can't use season rollups — aggregate the
    // game log instead ("most touchdowns in week 22", "at home").
    if (
      def.source !== "game" &&
      (spec.venue || spec.weekMin != null || spec.weekMax != null || spec.sbOnly)
    ) {
      const where = gamePreds(spec, p);
      const sql =
        `SELECT p.player_id, p.full_name, COUNT(*) AS games, SUM(${def.expr}) AS value ` +
        "FROM player_game_stats s " +
        "JOIN games g ON g.game_id = s.game_id " +
        "JOIN players p ON p.player_id = s.player_id " +
        `WHERE ${where.join(" AND ")}` +
        (spec.position ? ` AND p.position = ${p.add(spec.position)}` : "") +
        " GROUP BY p.player_id, p.full_name " +
        `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"}, p.full_name ` +
        `LIMIT ${p.add(spec.limit)}`;
      return { sql, params: p.values };
    }
    if (def.source === "game") {
      // Game-sourced leaders (completion %): aggregate the game log, with a
      // volume qualifier so tiny samples can't top the board.
      const where = gamePreds(spec, p);
      const minDen = spec.scope === "career" ? 1000 : 150;
      const sql =
        `SELECT p.player_id, p.full_name, ${aggExpr(spec)} AS value ` +
        "FROM player_game_stats s " +
        "JOIN games g ON g.game_id = s.game_id " +
        "JOIN players p ON p.player_id = s.player_id " +
        `WHERE ${where.join(" AND ")}` +
        (spec.position ? ` AND p.position = ${p.add(spec.position)}` : "") +
        " GROUP BY p.player_id, p.full_name " +
        `HAVING SUM(COALESCE(s.${def.ratio?.den ?? "attempts"}, 0)) >= ${p.add(minDen)} ` +
        `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
        `LIMIT ${p.add(spec.limit)}`;
      return { sql, params: p.values };
    }
    if (spec.scope === "career") {
      const stype = p.add(spec.seasonType);
      // A season range ("receiving yards from 2021 to 2023") bounds the sum.
      const rangePred =
        spec.seasonMin != null && spec.seasonMax != null
          ? ` AND s.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`
          : "";
      // Per-game career board divides career total by career games, with a
      // volume floor so a one-game cameo can't top the list.
      const valueSel = spec.perGame
        ? `ROUND(SUM(${def.expr})::numeric / NULLIF(SUM(COALESCE(s.games_played, 0)), 0), 1)`
        : `SUM(${def.expr})`;
      const perGameFloor = spec.perGame
        ? `HAVING SUM(COALESCE(s.games_played, 0)) >= ${p.add(16)} `
        : "";
      const sql =
        `SELECT p.player_id, p.full_name, COUNT(*) AS seasons, ${valueSel} AS value ` +
        "FROM player_season_stats s " +
        "JOIN players p ON p.player_id = s.player_id " +
        `WHERE s.season_type = ${stype}${rangePred}` +
        (spec.position ? ` AND p.position = ${p.add(spec.position)}` : "") +
        " GROUP BY p.player_id, p.full_name " + perGameFloor +
        `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"}, p.full_name ` +
        `LIMIT ${p.add(spec.limit)}`;
      return { sql, params: p.values };
    }
    const where = [`s.season_type = ${p.add(spec.seasonType)}`];
    if (spec.season != null) where.push(`s.season = ${p.add(spec.season)}`);
    if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
    if (spec.rookie) where.push(ROOKIE_PRED);
    // Ascending boards need a floor, or benchwarmers sweep "fewest X".
    if (spec.dir === "asc") where.push("COALESCE(s.games_played, 0) >= 8");
    // A per-game board is a rate, with the same games floor.
    if (spec.perGame) where.push("COALESCE(s.games_played, 0) >= 8");
    const valueSel = spec.perGame
      ? `ROUND(${def.expr}::numeric / NULLIF(COALESCE(s.games_played, 0), 0), 1)`
      : `${def.expr}`;
    const sql =
      `SELECT p.player_id, p.full_name, s.season, ${valueSel} AS value ` +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")} ` +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"}, s.season DESC, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`;
    return { sql, params: p.values };
  }

  if (spec.intent === "player_total") {
    const def = statDef(spec);
    const playerPred = spec.playerId
      ? `s.player_id = ${p.add(spec.playerId)}`
      : `lower(p.full_name) LIKE ${p.add(`%${(spec.player ?? "").toLowerCase()}%`)}`;

    if (needsGameLog(spec) && spec.playerId) {
      // Per-game rows plus a window total: the answer narrates the total and
      // the table shows the games behind it.
      return { sql: playerGameRowsSql(spec, p, playerPred), params: p.values };
    }

    const stype = p.add(spec.seasonType);
    if (spec.rookie) {
      const sql =
        `SELECT p.player_id, p.full_name, s.season, ${def.expr} AS value ` +
        "FROM player_season_stats s " +
        "JOIN players p ON p.player_id = s.player_id " +
        `WHERE ${playerPred} AND s.season_type = ${stype} AND ${ROOKIE_PRED}`;
      return { sql, params: p.values };
    }
    if (spec.scope === "career") {
      // A season range ("from 2021 to 2023") bounds the career sum.
      const rangePred =
        spec.seasonMin != null && spec.seasonMax != null
          ? ` AND s.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`
          : "";
      const totalExpr = spec.perGame
        ? `ROUND(SUM(${def.expr})::numeric / NULLIF(SUM(COALESCE(s.games_played, 0)), 0), 1)`
        : `SUM(${def.expr})`;
      const sql =
        `SELECT p.player_id, p.full_name, ${totalExpr} AS total ` +
        "FROM player_season_stats s " +
        "JOIN players p ON p.player_id = s.player_id " +
        `WHERE ${playerPred} AND s.season_type = ${stype}${rangePred} ` +
        "GROUP BY p.player_id, p.full_name";
      return { sql, params: p.values };
    }
    const where = [playerPred, `s.season_type = ${stype}`];
    if (spec.season != null) where.push(`s.season = ${p.add(spec.season)}`);
    const valueExpr = spec.perGame
      ? `ROUND(${def.expr}::numeric / NULLIF(COALESCE(s.games_played, 0), 0), 1) AS value`
      : `${def.expr} AS value`;
    const sql =
      `SELECT p.player_id, p.full_name, s.season, ${valueExpr} ` +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")} ` +
      "ORDER BY s.season";
    return { sql, params: p.values };
  }

  // single_game
  const def = statDef(spec);
  const sgExpr = def.ratio
    ? `ROUND(COALESCE(s.${def.ratio.num}, 0)::numeric / NULLIF(COALESCE(s.${def.ratio.den}, 0), 0) * 100, 1)`
    : def.expr;
  const stype = p.add(spec.seasonType);
  const preds = [`${sgExpr} > 0`, `g.season_type = ${stype}`];
  if (spec.playerId) preds.push(`s.player_id = ${p.add(spec.playerId)}`);
  if (spec.season != null) preds.push(`g.season = ${p.add(spec.season)}`);
  const sql =
    "SELECT p.player_id, p.full_name, g.season, g.week, " +
    "CASE WHEN s.team_id = g.home_team THEN g.away_team " +
    "ELSE g.home_team END AS opponent, " +
    `${sgExpr} AS value ` +
    "FROM player_game_stats s " +
    "JOIN players p ON p.player_id = s.player_id " +
    "JOIN games g ON g.game_id = s.game_id " +
    `WHERE ${preds.join(" AND ")} ` +
    `ORDER BY value DESC, g.season DESC, g.week, p.full_name LIMIT ${p.add(spec.limit)}`;
  return { sql, params: p.values };
}

function compareOrderCol(spec: QuerySpec): string {
  const expr = specExpr(spec);
  return /^s\.\w+$/.test(expr) ? expr.slice(2) : "fantasy_points_ppr";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** '2016-09-24' -> 'Sep 24, 2016' — string math, no timezone surprises. */
function fmtDate(v: unknown): string | null {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** How a touchdown was scored, for narration. */
function tdHow(playType: unknown): string {
  const map: Record<string, string> = {
    pass: "receiving", run: "rushing", kickoff: "kick-return", punt: "punt-return",
  };
  return map[String(playType ?? "")] ?? "";
}

/** 1459 -> '1,459'; 112.3 stays '112.3'. */
function fmt(v: unknown): string {
  const n = Number(v ?? 0);
  return n % 1
    ? n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : Math.trunc(n).toLocaleString("en-US");
}

/** Human phrasing for the game-level qualifiers on a spec. */
function qualifiers(spec: QuerySpec): string {
  const parts: string[] = [];
  if (spec.sbOnly) parts.push("in the Super Bowl");
  if (spec.venue === "home") parts.push("at home");
  if (spec.venue === "away") parts.push("on the road");
  if (spec.weekMin != null && spec.weekMax != null && spec.weekMin === spec.weekMax) {
    parts.push(`in Week ${spec.weekMin}`);
  } else {
    if (spec.weekMin != null) parts.push(`from Week ${spec.weekMin} on`);
    if (spec.weekMax != null) parts.push(`through Week ${spec.weekMax}`);
  }
  return parts.length ? ` ${parts.join(", ")}` : "";
}

type Row = Record<string, unknown>;

const ROMAN: [number, string][] = [
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"],
  [5, "V"], [4, "IV"], [1, "I"],
];
export function roman(n: number): string {
  let out = "";
  for (const [v, sym] of ROMAN) {
    while (n >= v) {
      out += sym;
      n -= v;
    }
  }
  return out;
}

/** "Super Bowl LIX" for the 2024 season; NFL kept "50" arabic. */
export function sbName(season: number): string {
  const num = season - 1965;
  return `Super Bowl ${num === 50 ? "50" : roman(num)}`;
}

/** Human phrase for a playoff round in a given season. */
function roundPhrase(round: string | null | undefined, season: unknown, conf?: string | null): string {
  const s = Number(season);
  if (round === "SB") return Number.isFinite(s) ? sbName(s) : "the Super Bowl";
  if (round === "CON") return `the ${conf ?? ""}${conf ? " " : ""}championship game`.replace("  ", " ");
  if (round === "DIV") return "the divisional round";
  if (round === "WC") return "the wild-card round";
  return "";
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th". */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** 75 -> `6'3"`; null/0 -> null. */
function fmtHeight(inches: unknown): string | null {
  const n = Number(inches);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.floor(n / 12)}'${n % 12}"`;
}

/** Bio narration: a player's card, or a bio-superlative headline. */
function narrateBio(spec: QuerySpec, top: Row, name: string): string {
  // Superlative board (no playerId): the top row is the answer.
  if (!spec.playerId) {
    const posText = spec.position ? ` ${spec.position}` : " player";
    if (spec.bioField === "height") {
      const which = spec.dir === "asc" ? "shortest" : "tallest";
      return `${top.full_name} is the ${which}${posText} at ${fmtHeight(top.height_inches)}${top.weight_lbs ? ` (${top.weight_lbs} lbs)` : ""}.`;
    }
    if (spec.bioField === "weight") {
      const which = spec.dir === "asc" ? "lightest" : "heaviest";
      return `${top.full_name} is the ${which}${posText} at ${top.weight_lbs} lbs${fmtHeight(top.height_inches) ? ` (${fmtHeight(top.height_inches)})` : ""}.`;
    }
    const which = spec.dir === "asc" ? "youngest" : "oldest";
    return `${top.full_name} is the ${which}${posText} at ${top.age} years old.`;
  }
  // Named player.
  const team = top.team_name ?? top.team;
  const h = fmtHeight(top.height_inches);
  switch (spec.bioField) {
    case "team":
      return team ? `${name} most recently played for the ${team}.` : `${name}'s team isn't in the warehouse.`;
    case "age": {
      const d = fmtDate(top.birth_date);
      return top.age != null ? `${name} is ${top.age} years old${d ? ` (born ${d})` : ""}.` : `${name}'s birth date isn't on file.`;
    }
    case "height":
      return h ? `${name} is ${h}${top.weight_lbs ? `, ${top.weight_lbs} lbs` : ""}.` : `${name}'s height isn't on file.`;
    case "weight":
      return top.weight_lbs ? `${name} weighs ${top.weight_lbs} lbs${h ? ` (${h})` : ""}.` : `${name}'s weight isn't on file.`;
    case "college":
      return top.college ? `${name} played college football at ${top.college}.` : `${name}'s college isn't on file.`;
    default: {
      const bits: string[] = [];
      if (top.position) bits.push(String(top.position));
      if (h) bits.push(`${h}${top.weight_lbs ? `, ${top.weight_lbs} lbs` : ""}`);
      if (top.college) bits.push(String(top.college));
      if (top.age != null) bits.push(`${top.age} yrs`);
      return `${name}${team ? `, ${team}` : ""}${bits.length ? ` — ${bits.join(", ")}` : ""}.`;
    }
  }
}

/** W-L(-T) line over game rows that carry a `result` column. */
function recordOf(rows: Row[]): string {
  const w = rows.filter((r) => r.result === "W").length;
  const l = rows.filter((r) => r.result === "L").length;
  const ties = rows.filter((r) => r.result === "T").length;
  return `${w}-${l}${ties ? `-${ties}` : ""}`;
}

/** Templated headline — deterministic. Falls back gracefully on empty. */
export function narrate(spec: QuerySpec, rows: Row[]): string {
  if (rows.length === 0) {
    if (spec.intent === "game_result" || spec.intent === "team_game_log") {
      return "No completed games match that.";
    }
    if (spec.intent === "draft_pick") return "No draft pick matches that.";
    return "No matching results found.";
  }
  const top = rows[0]!;
  const label = specLabel(spec);
  const unit = statDef(spec).unit ?? "";
  const name = String(top.full_name ?? spec.player ?? "");

  if (spec.intent === "player_bio") return narrateBio(spec, top, name);

  if (spec.intent === "qualifying_count") {
    const n = Number(top.qualifying_players ?? 0);
    const opText = { ">": "over", ">=": "at least", "<": "under" }[spec.threshold!.op];
    const posText = spec.position ? ` ${spec.position}s` : " players";
    const when =
      spec.scope === "career" ? "in their career"
        : spec.season != null ? `in ${spec.season}` : "in a season";
    return `${fmt(n)}${posText} had ${opText} ${fmt(spec.threshold!.value)} ${label} ${when}.`;
  }

  if (spec.intent === "player_rank") {
    const rk = Number(top.rk);
    const tot = Number(top.total_players);
    const post = spec.seasonType === "POST" ? " postseason" : "";
    const scope =
      spec.seasonMin != null ? `from ${spec.seasonMin} to ${spec.seasonMax}`
        : spec.scope === "career" ? "all-time"
          : `in ${spec.season}`;
    return (
      `${name} ranks ${ordinal(rk)} ${scope}${post} in ${label} with ` +
      `${fmt(top.value)}${unit}${Number.isFinite(tot) && tot ? ` (of ${fmt(tot)} players)` : ""}.`
    );
  }

  if (spec.intent === "draft_pick") {
    const who = String(top.player_name);
    const where = `${top.position ? `${top.position}, ` : ""}${top.college ?? ""}`.replace(/, $/, "");
    if (spec.draftPick === 1) {
      return `${who} went first overall in the ${top.season} NFL draft, to the ${top.team_name ?? top.team}${where ? ` (${where})` : ""}.`;
    }
    if (spec.playerId || spec.player) {
      return `${who} was drafted by the ${top.team_name ?? top.team} at pick ${top.pick} overall (round ${top.round}) in ${top.season}${where ? ` (${where})` : ""}.`;
    }
    if (spec.teamId) {
      return `The ${top.team_name ?? top.team} made ${rows.length} pick${rows.length === 1 ? "" : "s"} in the ${top.season} draft, starting with ${who} at ${top.pick} overall.`;
    }
    return `${who} went ${top.pick} overall to the ${top.team_name ?? top.team} in ${top.season}.`;
  }

  if (spec.intent === "game_result") {
    // Neutral rows carry home/away names; team-perspective rows carry
    // opponent/result relative to the asked-about team.
    if (top.home_name !== undefined) {
      const hs = Number(top.home_score), as_ = Number(top.away_score);
      const [wn, ws, ln, ls] =
        hs >= as_
          ? [top.home_name, hs, top.away_name, as_]
          : [top.away_name, as_, top.home_name, hs];
      const where =
        roundPhrase(String(top.round), top.season, spec.conf) ||
        `Week ${top.week}, ${top.season}`;
      const when = fmtDate(top.game_date);
      const tail = rows.length > 1 ? ` Showing all ${rows.length} matching games.` : "";
      if (hs === as_) {
        return `The ${wn} and the ${ln} tied ${ws}-${ls} in ${where}${when ? ` (${when})` : ""}.${tail}`;
      }
      return `The ${wn} beat the ${ln} ${ws}-${ls} in ${where}${when ? ` (${when})` : ""}.${tail}`;
    }
    const teamName = spec.teamName ?? "They";
    const where =
      String(top.round) !== "REG"
        ? roundPhrase(String(top.round), top.season, spec.conf)
        : `Week ${top.week}, ${top.season}`;
    const when = fmtDate(top.game_date);
    const verb = top.result === "W" ? "beat" : top.result === "L" ? "lost to" : "tied";
    const line =
      `The ${teamName} ${verb} ${top.opponent} ${top.team_score}-${top.opp_score} ` +
      `in ${where}${when ? ` (${when})` : ""}.`;
    if (rows.length > 1) {
      return `${line} Showing the last ${rows.length} matchups (${recordOf(rows)} for the ${teamName}).`;
    }
    return line;
  }

  if (spec.intent === "team_game_log") {
    const teamName = spec.teamName ?? "They";
    let scope = spec.round
      ? spec.round === "SB"
        ? "in the Super Bowl"
        : `in ${roundPhrase(spec.round, null, spec.conf) || "the playoffs"}s`.replace("the ", "")
      : spec.seasonType === "POST"
        ? spec.season != null ? `in the ${spec.season} playoffs` : "in the playoffs"
        : spec.season != null
          ? `in the ${spec.season} regular season`
          : "since 1999";
    if (spec.marginMax != null) {
      scope = `in games decided by ${spec.marginMax} points or fewer ${spec.season != null ? `in ${spec.season}` : "since 1999"}`;
    }
    if (spec.lastN) scope = `over their last ${spec.lastN} games`;
    const latest = top;
    const verb = latest.result === "W" ? "beating" : latest.result === "L" ? "losing to" : "tying";
    const when = fmtDate(latest.game_date);
    return (
      `The ${teamName} are ${recordOf(rows)} ${scope}, most recently ` +
      `${verb} ${latest.opponent} ${latest.team_score}-${latest.opp_score}` +
      `${when ? ` (${when})` : ""}.`
    );
  }

  if (spec.intent === "player_seasons") {
    const poss = name.endsWith("s") ? `${name}'` : `${name}'s`;
    const first = Number(rows[rows.length - 1]!.season);
    const last = Number(top.season);
    return rows.length === 1
      ? `${poss} ${last} regular-season stats.`
      : `${poss} regular-season stats, season by season (${first}–${last}).`;
  }

  if (spec.intent === "game_log") {
    const post = spec.seasonType === "POST" && !spec.sbOnly && !spec.round ? " postseason" : "";
    const scope = spec.sbOnly || spec.round === "SB"
      ? " Super Bowl"
      : spec.round
        ? ` ${roundPhrase(spec.round, null, spec.conf).replace(/^the /, "")}`
        : post;
    const window = spec.lastN
      ? `last ${spec.lastN} games`
      : spec.firstN
        ? `first ${spec.firstN} games`
        : `${spec.season != null ? `${spec.season} ` : ""}game log`;
    const n = Number(top.games ?? rows.length);
    const poss = name.endsWith("s") ? `${name}'` : `${name}'s`;
    const quals = qualifiers({ ...spec, sbOnly: false }); // scope already says it
    const vsOpp = spec.opponentId ? ` against the ${spec.team2Name ?? spec.opponentId}` : "";
    return `${poss}${scope} ${window}${vsOpp}: ${n} game${n === 1 ? "" : "s"}${quals}.`;
  }
  // sbOnly already says "in the Super Bowl" via qualifiers.
  const post = spec.seasonType === "POST" && !spec.sbOnly ? " postseason" : "";
  const quals = qualifiers(spec);

  if (spec.intent === "compare") {
    const col = compareOrderCol(spec);
    const scope = spec.firstN
      ? `their first ${spec.firstN}${post} games`
      : spec.season
        ? `the ${spec.season}${post} season`
        : `their${post} careers`;
    const other = rows[1];
    if (!other || !other.games) {
      const missing = other ? other.full_name : spec.player2;
      return (
        `Over ${scope}, ${name} has ${fmt(top[col])} ${label} ` +
        `(${top.games} games); ${missing} has no${post} games in the warehouse.`
      );
    }
    if (Number(top[col] ?? 0) === Number(other[col] ?? 0)) {
      return `Dead even over ${scope}: both at ${fmt(top[col])} ${label}.`;
    }
    return (
      `Over ${scope}, ${name} leads ${other.full_name} in ${label}, ` +
      `${fmt(top[col])} to ${fmt(other[col])}.`
    );
  }

  if (spec.intent === "scoring") {
    const when = fmtDate(top.game_date);
    const at = when
      ? `on ${when} (Week ${top.week}, ${top.season})`
      : `in Week ${top.week}, ${top.season}`;
    const how = tdHow(top.play_type);
    const kind = `${how ? `${how} ` : ""}touchdown`;
    if (spec.edge === "first") {
      return `${name} scored his first${post} ${kind} ${at}, against ${top.opponent}.`;
    }
    if (spec.edge === "last") {
      return `${name}'s most recent${post} ${kind} came ${at}, against ${top.opponent}.`;
    }
    return (
      `${name}'s most recent${post} ${kind} came ${at}, against ${top.opponent}. ` +
      `Showing his last ${rows.length}.`
    );
  }

  if (spec.intent === "game_count") {
    const opText = { ">": "over", ">=": "at least", "<": "under" }[spec.threshold!.op];
    const n = Number(top.qualifying_games ?? rows.length);
    const scope = spec.season ? `${spec.season}${post}` : `career${post}`;
    return (
      `${name} has ${n} ${scope} game${n === 1 ? "" : "s"} with ${opText} ` +
      `${spec.threshold!.value} ${label}${quals}.`
    );
  }

  if (spec.intent === "player_total" && spec.perGame) {
    const v = top.total !== undefined ? top.total : top.value;
    const scope =
      spec.seasonMin != null ? `from ${spec.seasonMin} to ${spec.seasonMax}`
        : spec.scope === "career" ? "over his career"
          : `in ${top.season ?? spec.season}`;
    return `${name} averaged ${fmt(v)}${unit} ${label} per game ${scope}${post}${quals}.`;
  }
  if (spec.intent === "player_total" && spec.seasonMin != null) {
    return `${name} had ${fmt(top.total)}${unit}${post} ${label} from ${spec.seasonMin} to ${spec.seasonMax}${quals}.`;
  }
  if (spec.intent === "player_total" && (spec.firstN || spec.lastN)) {
    const window = spec.firstN ? `first ${spec.firstN}` : `last ${spec.lastN}`;
    return `${name} totaled ${fmt(top.total)}${unit} ${label} over his ${window}${post} games${quals}.`;
  }
  if (spec.intent === "player_total" && spec.rookie) {
    return `${name} had ${fmt(top.value)}${unit} ${label} as a rookie in ${top.season}.`;
  }
  if (spec.intent === "player_total" && top.total !== undefined && spec.season != null) {
    return `${name} had ${fmt(top.total)}${unit}${post} ${label} in ${spec.season}${quals}.`;
  }
  if (spec.intent === "player_total" && (spec.scope === "career" || top.total !== undefined)) {
    return `${name} has ${fmt(top.total)}${unit} career${post} ${label}${quals}.`;
  }
  if (spec.intent === "player_total") {
    return `${name} had ${fmt(top.value)}${unit}${post} ${label} in ${top.season}${quals}.`;
  }
  if (spec.intent === "single_game") {
    return (
      `${name} has the top single-game${post} mark with ${top.value} ` +
      `${label}, against ${top.opponent} in Week ${top.week}, ${top.season}.`
    );
  }
  // leaders
  const posText = spec.position ? ` among ${spec.position}s` : "";
  const rate = spec.perGame ? " per game" : "";
  const verb = spec.dir === "asc" ? "has the fewest" : "leads";
  if (spec.scope === "career" && spec.seasonMin != null) {
    return `${name} ${verb === "leads" ? "leads" : "has the fewest"} with ${fmt(top.value)}${unit}${post} ${label}${rate}${posText} from ${spec.seasonMin} to ${spec.seasonMax}.`;
  }
  if (spec.scope === "career") {
    return `${name} ${verb === "leads" ? "leads all time" : "has the fewest all time"} with ${fmt(top.value)}${unit} career${post} ${label}${rate}${posText}.`;
  }
  const season = top.season ?? spec.season;
  const where = season && post ? ` in the ${season} postseason` : season ? ` in ${season}` : "";
  if (spec.dir === "asc") {
    return `${name} has the fewest ${label}${rate}${posText}${where}${quals} (min. 8 games) at ${fmt(top.value)}${unit}.`;
  }
  return `${name} leads${posText} with ${fmt(top.value)}${unit} ${label}${rate}${where}${quals}${spec.rookie ? " among rookies" : ""}.`;
}
