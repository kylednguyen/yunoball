/** LEADERS executor: season boards, career/all-time boards, positional and
 * rookie filters, per-game rates, and game-log aggregation whenever the board
 * needs game-level filters or a game-sourced stat. */

import { STATS } from "../spec.js";
import type { LeadersSpec } from "../spec.js";
import {
  aggExpr, beforeSeasonPred, gamePreds, gameTable, minAgePred, OPP_TEAM_EXPR, Params, ratioFloor,
  ROOKIE_PRED, statColumns, statDef,
} from "./shared.js";

export function leadersSql(spec: LeadersSpec, p: Params): string {
  const def = statDef(spec);

  // First-N-games window ("through his first 50 career games", "in his
  // first 10 playoff games"): each player's own first N games by date,
  // summed and ranked — a per-player ROW_NUMBER window, not a plain GROUP BY.
  // Reuses the game log regardless of the stat's usual grain, same as
  // needsGameLog does for player_total's firstN.
  if (spec.firstN != null) {
    const table = gameTable(def);
    const cols = [...new Set(statColumns(def))];
    const where = gamePreds(spec, p);
    if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
    if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
    // Age/experience windows combine with the game window as plain AND
    // predicates (same as gameCountLeadersSql), applied BEFORE the
    // ROW_NUMBER so "first 50 games after turning 30" means the first 50
    // of the games that qualify — the executor and narration must agree on
    // every window that applied, never silently drop one.
    if (spec.minAgeYears != null) where.push(minAgePred(spec.minAgeYears, p));
    if (spec.beforeSeasonN != null) where.push(beforeSeasonPred(spec.beforeSeasonN, p));
    // The inner query passes the raw columns a stat needs straight through
    // under their own names, so the outer query's aggExpr/def.expr — written
    // against generic `s.<col>` — works unmodified against the derived table
    // aliased `s` below.
    const inner =
      `SELECT s.player_id, p.full_name, ${cols.map((c) => `s.${c}`).join(", ")}, ` +
      "ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY g.game_date, g.game_id) AS rn " +
      `FROM ${table} s ` +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")}`;
    const having = def.ratio
      ? `HAVING SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
      : def.formula === "passer_rating"
        ? `HAVING SUM(COALESCE(s.attempts, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
        // Ascending boards need the FULL window, or a two-game cameo sweeps
        // "fewest X through his first 50 games" (cf. the games_played >= 8
        // floor on plain ascending leaders).
        : spec.dir === "asc"
          ? `HAVING COUNT(*) >= ${p.add(spec.firstN)} `
          : "";
    return (
      `SELECT s.player_id, s.full_name, ${aggExpr(spec)} AS value ` +
      `FROM (${inner}) s ` +
      `WHERE s.rn <= ${p.add(spec.firstN)} ` +
      "GROUP BY s.player_id, s.full_name " + having +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, s.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }

  // Age-window totals ("most rushing yards after turning 30"): sum game
  // rows from the player's Nth birthday on. Always the game log — age
  // varies within a season, so the season rollup (player_season_stats)
  // can't express a mid-season birthday the way beforeSeasonN's season
  // boundary can. Same game-date-vs-birth_date idiom as
  // gameCountLeadersSql's minAgeYears predicate. A co-occurring
  // beforeSeasonN ANDs in here (firstN combos are handled above).
  if (spec.minAgeYears != null) {
    const table = gameTable(def);
    const where = [...gamePreds(spec, p), minAgePred(spec.minAgeYears, p)];
    if (spec.beforeSeasonN != null) where.push(beforeSeasonPred(spec.beforeSeasonN, p));
    if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
    if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
    const having = def.ratio
      ? `HAVING SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
      : def.formula === "passer_rating"
        ? `HAVING SUM(COALESCE(s.attempts, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
        // Ascending boards need a floor, or benchwarmers sweep "fewest X"
        // (cf. the games_played >= 8 floor on plain ascending leaders).
        : spec.dir === "asc"
          ? "HAVING COUNT(*) >= 8 "
          : "";
    return (
      `SELECT p.player_id, p.full_name, ${aggExpr(spec)} AS value ` +
      `FROM ${table} s ` +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")} ` +
      "GROUP BY p.player_id, p.full_name " + having +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }

  // Season-window totals ("before his fifth NFL season", "in his first
  // three seasons"): sum strictly before the boundary season, per player.
  // Excludes players with no rookie_season on file.
  if (spec.beforeSeasonN != null) {
    // Ratio/formula/game-only stats have no season-rollup column (def.expr is
    // empty, or the column simply isn't in player_season_stats) — aggregate
    // the game log with a season-boundary predicate instead, same
    // statColumns/aggExpr idiom as the first-N-games window above. Any
    // game-window field on the spec (season, venue, month, weeks, primetime,
    // weather, SB, game result — all threaded by the cumulative-window
    // parser shape) also forces the game log: the season rollup can't
    // express them, and gamePreds is what honors them.
    const hasGameWindow =
      spec.season != null || spec.seasonMin != null || spec.seasonMax != null ||
      spec.venue != null || spec.month != null ||
      spec.weekMin != null || spec.weekMax != null ||
      Boolean(spec.primetime) || spec.tempMax != null || Boolean(spec.sbOnly) ||
      spec.gameResult != null || Boolean(spec.oneScore) || Boolean(spec.oppWinningRecord);
    if (def.source === "game" || def.ratio || def.formula || hasGameWindow) {
      const table = gameTable(def);
      const where = [
        ...gamePreds(spec, p),
        beforeSeasonPred(spec.beforeSeasonN, p),
      ];
      if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
      if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
      const having = def.ratio
        ? `HAVING SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
        : def.formula === "passer_rating"
          ? `HAVING SUM(COALESCE(s.attempts, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
          // Ascending boards need a floor, or benchwarmers sweep "fewest X"
          // (cf. the games_played >= 8 floor on plain ascending leaders).
          : spec.dir === "asc"
            ? "HAVING COUNT(*) >= 8 "
            : "";
      return (
        `SELECT p.player_id, p.full_name, ${aggExpr(spec)} AS value ` +
        `FROM ${table} s ` +
        "JOIN games g ON g.game_id = s.game_id " +
        "JOIN players p ON p.player_id = s.player_id " +
        `WHERE ${where.join(" AND ")} ` +
        "GROUP BY p.player_id, p.full_name " + having +
        `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
        `LIMIT ${p.add(spec.limit)}`
      );
    }
    const where = [
      `s.season_type = ${p.add(spec.seasonType)}`,
      // ponytail: players missing rookie_season are excluded, not guessed —
      // same honest-smaller-board call as minAgeYears' NULL birth_date
      // exclusion in gameCountLeadersSql.
      "p.rookie_season IS NOT NULL",
      `s.season < p.rookie_season + ${p.add(spec.beforeSeasonN - 1)}`,
    ];
    if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
    if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
    // Ascending boards need a floor, or benchwarmers sweep "fewest X" (cf.
    // the games_played >= 8 floor on plain ascending leaders).
    const ascFloor = spec.dir === "asc" ? "HAVING SUM(COALESCE(s.games_played, 0)) >= 8 " : "";
    return (
      `SELECT p.player_id, p.full_name, SUM(${def.expr}) AS value ` +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")} ` +
      "GROUP BY p.player_id, p.full_name " + ascFloor +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"}, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }

  // Game-result-conditioned / per-opponent boards ("most touchdowns in games
  // his team lost", "in one-score games", "against teams with winning
  // records", "against a single opponent"): always the game log — these
  // predicates only exist per game. gameResult/oneScore/oppWinningRecord ride
  // gamePreds, the same shared idiom every other game-grain executor uses;
  // perOpponent additionally groups by the opponent so the board ranks
  // (player, opponent) pairs instead of just players.
  if (spec.gameResult != null || spec.oneScore || spec.oppWinningRecord || spec.perOpponent) {
    const table = gameTable(def);
    const where = gamePreds(spec, p);
    if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
    if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
    if (spec.perOpponent) {
      // Ascending boards need a floor per (player, opponent) PAIR, or a
      // two-game matchup cameo sweeps "fewest X against a single opponent"
      // (same 8-game convention as every other ascending leaders branch).
      const pairFloor = spec.dir === "asc" ? "HAVING COUNT(*) >= 8 " : "";
      return (
        "SELECT p.player_id, p.full_name, opp.team_id AS opponent_id, " +
        `opp.name AS opponent_name, ${aggExpr(spec)} AS value ` +
        `FROM ${table} s ` +
        "JOIN games g ON g.game_id = s.game_id " +
        "JOIN players p ON p.player_id = s.player_id " +
        `JOIN teams opp ON opp.team_id = ${OPP_TEAM_EXPR} ` +
        `WHERE ${where.join(" AND ")} ` +
        "GROUP BY p.player_id, p.full_name, opp.team_id, opp.name " + pairFloor +
        `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
        `LIMIT ${p.add(spec.limit)}`
      );
    }
    const having = def.ratio
      ? `HAVING SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
      : def.formula === "passer_rating"
        ? `HAVING SUM(COALESCE(s.attempts, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
        : spec.dir === "asc"
          ? "HAVING COUNT(*) >= 8 "
          : "";
    return (
      `SELECT p.player_id, p.full_name, ${aggExpr(spec)} AS value ` +
      `FROM ${table} s ` +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")} ` +
      "GROUP BY p.player_id, p.full_name " + having +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }

  // "Without a Y-season" negation ("most career rushing yards without a
  // 1,500-yard season"): rank the career sum, excluding any player whose
  // best single season (of the SAME stat) ever reached the bar. Always
  // player_season_stats — every stat this field reaches through the parser
  // is a plain season-rollup column, never a ratio/formula/game-only stat.
  if (spec.withoutSeasonAtLeast != null) {
    const having = [`MAX(${def.expr}) < ${p.add(spec.withoutSeasonAtLeast)}`];
    if (spec.dir === "asc") having.push("SUM(COALESCE(s.games_played, 0)) >= 8");
    const where = [`s.season_type = ${p.add(spec.seasonType)}`];
    if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
    return (
      `SELECT p.player_id, p.full_name, SUM(${def.expr}) AS value ` +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")} ` +
      "GROUP BY p.player_id, p.full_name " +
      `HAVING ${having.join(" AND ")} ` +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }

  // "Without ever leading the league" negation ("most career touchdowns
  // without ever leading the league in touchdowns"): a season LEADS
  // whenever it matches that season's league max (ties all count) — compute
  // the set of players who ever did, then rank the career sum over everyone
  // else. Always player_season_stats, same stat-shape restriction as above.
  if (spec.withoutLeagueLead) {
    const stype = p.add(spec.seasonType);
    // "led the league" is computed league-wide, over every position — the
    // `szn`/`led` CTEs never see spec.position. Only the OUTER ranking (who
    // tops the remaining career-sum board) is restricted to the asked-about
    // position, same split as the plain leaders board below.
    const outerWhere = [
      `s.season_type = ${stype}`,
      "s.player_id NOT IN (SELECT player_id FROM led)",
    ];
    if (spec.position) outerWhere.push(`p.position = ${p.add(spec.position)}`);
    return (
      "WITH szn AS (" +
      `SELECT s.player_id, s.season, ${def.expr} AS v ` +
      `FROM player_season_stats s WHERE s.season_type = ${stype}` +
      "), szn_max AS (" +
      "SELECT season, MAX(v) AS mx FROM szn GROUP BY season" +
      "), led AS (" +
      "SELECT DISTINCT szn.player_id FROM szn " +
      "JOIN szn_max ON szn_max.season = szn.season AND szn_max.mx = szn.v" +
      ") " +
      `SELECT p.player_id, p.full_name, SUM(${def.expr}) AS value ` +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${outerWhere.join(" AND ")} ` +
      "GROUP BY p.player_id, p.full_name " +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }

  // Cross-stat career negation ("most rushing attempts without scoring a
  // touchdown", "most rushing touchdowns with fewer than 1,000 career
  // rushing yards"): a second stat's career sum must clear a bound. Both
  // stats' columns live on whichever table the PRIMARY stat sources from
  // (game log when the primary is game-sourced, season rollup otherwise) —
  // never the advanced pbp table, since it doesn't carry the box-score
  // columns crossStat needs; parseRules never sets crossStat for an
  // advanced/ratio primary stat, so that combination never reaches here.
  if (spec.crossStat != null && spec.crossOp != null && spec.crossValue != null) {
    const crossExpr = STATS[spec.crossStat]!.expr;
    const bound = p.add(spec.crossValue);
    if (def.source === "game" || def.ratio || def.formula) {
      const table = gameTable(def);
      const where = gamePreds(spec, p);
      if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
      return (
        `SELECT p.player_id, p.full_name, ${aggExpr(spec)} AS value ` +
        `FROM ${table} s ` +
        "JOIN games g ON g.game_id = s.game_id " +
        "JOIN players p ON p.player_id = s.player_id " +
        `WHERE ${where.join(" AND ")} ` +
        "GROUP BY p.player_id, p.full_name " +
        `HAVING SUM(COALESCE(${crossExpr}, 0)) ${spec.crossOp} ${bound} ` +
        `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
        `LIMIT ${p.add(spec.limit)}`
      );
    }
    const stype = p.add(spec.seasonType);
    const where = [`s.season_type = ${stype}`];
    if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
    return (
      `SELECT p.player_id, p.full_name, SUM(${def.expr}) AS value ` +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")} ` +
      "GROUP BY p.player_id, p.full_name " +
      `HAVING SUM(COALESCE(${crossExpr}, 0)) ${spec.crossOp} ${bound} ` +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }

  // Week/venue/month-filtered leaders can't use season rollups — aggregate
  // the game log instead ("most touchdowns in week 22", "at home").
  if (
    def.source !== "game" &&
    (spec.venue || spec.weekMin != null || spec.weekMax != null ||
      spec.month != null || spec.primetime || spec.tempMax != null || spec.sbOnly)
  ) {
    const where = gamePreds(spec, p);
    if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
    return (
      `SELECT p.player_id, p.full_name, COUNT(*) AS games, SUM(${def.expr}) AS value ` +
      "FROM player_game_stats s " +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")}` +
      (spec.position ? ` AND p.position = ${p.add(spec.position)}` : "") +
      " GROUP BY p.player_id, p.full_name " +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"}, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }
  if (def.source === "game") {
    // Game-sourced leaders: aggregate the game log. Ratio stats (completion
    // %, yards per carry) get a volume qualifier so tiny samples can't top
    // the board; plain game-sourced sums (air yards) rank directly.
    const where = gamePreds(spec, p);
    if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
    const having = def.ratio
      ? `HAVING SUM(COALESCE(s.${def.ratio.den}, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
      : def.formula === "passer_rating"
        ? `HAVING SUM(COALESCE(s.attempts, 0)) >= ${p.add(ratioFloor(def, spec.scope))} `
        : "";
    return (
      `SELECT p.player_id, p.full_name, ${aggExpr(spec)} AS value ` +
      `FROM ${gameTable(def)} s ` +
      "JOIN games g ON g.game_id = s.game_id " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE ${where.join(" AND ")}` +
      (spec.position ? ` AND p.position = ${p.add(spec.position)}` : "") +
      " GROUP BY p.player_id, p.full_name " + having +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }
  if (spec.scope === "career") {
    const stype = p.add(spec.seasonType);
    // A season range ("receiving yards from 2021 to 2023") bounds the sum;
    // a pinned single season bounds it the same way — never silently ignored
    // while the narration voices it (R1).
    const rangePred =
      spec.seasonMin != null && spec.seasonMax != null
        ? ` AND s.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`
        : spec.season != null
          ? ` AND s.season = ${p.add(spec.season)}`
          : "";
    // Per-game career board divides career total by career games, with a
    // volume floor so a one-game cameo can't top the list.
    const valueSel = spec.perGame
      ? `ROUND(SUM(${def.expr})::numeric / NULLIF(SUM(COALESCE(s.games_played, 0)), 0), 1)`
      : `SUM(${def.expr})`;
    const perGameFloor = spec.perGame
      ? `HAVING SUM(COALESCE(s.games_played, 0)) >= ${p.add(16)} `
      : "";
    return (
      `SELECT p.player_id, p.full_name, COUNT(*) AS seasons, ${valueSel} AS value ` +
      "FROM player_season_stats s " +
      "JOIN players p ON p.player_id = s.player_id " +
      `WHERE s.season_type = ${stype}${rangePred}` +
      (spec.teamId ? ` AND s.team_id = ${p.add(spec.teamId)}` : "") +
      (spec.position ? ` AND p.position = ${p.add(spec.position)}` : "") +
      " GROUP BY p.player_id, p.full_name " + perGameFloor +
      `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"}, p.full_name ` +
      `LIMIT ${p.add(spec.limit)}`
    );
  }
  const where = [`s.season_type = ${p.add(spec.seasonType)}`];
  // Single-season record boards can be bounded ("in a season since 2015"):
  // rank season rows, but only within the range.
  if (spec.seasonMin != null && spec.seasonMax != null) {
    where.push(`s.season BETWEEN ${p.add(spec.seasonMin)} AND ${p.add(spec.seasonMax)}`);
  } else if (spec.season != null) {
    where.push(`s.season = ${p.add(spec.season)}`);
  }
  if (spec.teamId) where.push(`s.team_id = ${p.add(spec.teamId)}`);
  if (spec.position) where.push(`p.position = ${p.add(spec.position)}`);
  if (spec.rookie) where.push(ROOKIE_PRED);
  // Ascending boards need a floor, or benchwarmers sweep "fewest X".
  if (spec.dir === "asc") where.push("COALESCE(s.games_played, 0) >= 8");
  // A per-game board is a rate, with the same games floor.
  if (spec.perGame) where.push("COALESCE(s.games_played, 0) >= 8");
  const valueSel = spec.perGame
    ? `ROUND(${def.expr}::numeric / NULLIF(COALESCE(s.games_played, 0), 0), 1)`
    : `${def.expr}`;
  return (
    `SELECT p.player_id, p.full_name, s.season, ${valueSel} AS value ` +
    "FROM player_season_stats s " +
    "JOIN players p ON p.player_id = s.player_id " +
    `WHERE ${where.join(" AND ")} ` +
    `ORDER BY value ${spec.dir === "asc" ? "ASC" : "DESC"}, s.season DESC, p.full_name ` +
    `LIMIT ${p.add(spec.limit)}`
  );
}
