/** Unit tests for the deterministic query engine — parser, SQL builder,
 * narration. No database required.
 *
 * The parse battery covers base cases and edge cases: short stat terms
 * ("ints", "picks", "tds"), position-aware generic cues, career leaders,
 * top-N, relative seasons, bare player names — and false-positive guards
 * (words that must NOT trigger a stat). */

import { describe, expect, it } from "vitest";
import { buildSql, narrate } from "../src/engine/build.js";
import { parseRules } from "../src/engine/parseRules.js";
import type { QuerySpec } from "../src/engine/spec.js";
import type { IndexedPlayer } from "../src/engine/resolve.js";
import { ratio } from "../src/engine/similarity.js";

const INDEX = new Map<string, IndexedPlayer>([
  ["patrick mahomes", { playerId: "P_MAHOMES", name: "Patrick Mahomes", position: "QB" }],
  ["mahomes", { playerId: "P_MAHOMES", name: "Patrick Mahomes", position: "QB" }],
  ["josh allen", { playerId: "P_ALLEN", name: "Josh Allen", position: "QB" }],
  ["allen", { playerId: "P_ALLEN", name: "Josh Allen", position: "QB" }],
  ["davante adams", { playerId: "P_ADAMS", name: "Davante Adams", position: "WR" }],
  ["adams", { playerId: "P_ADAMS", name: "Davante Adams", position: "WR" }],
  ["derrick henry", { playerId: "P_HENRY", name: "Derrick Henry", position: "RB" }],
  ["henry", { playerId: "P_HENRY", name: "Derrick Henry", position: "RB" }],
  // Real-world traps: surnames that collide with question vocabulary.
  ["t.j. rushing", { playerId: "P_RUSHING", name: "T.J. Rushing", position: "CB" }],
  ["rushing", { playerId: "P_RUSHING", name: "T.J. Rushing", position: "CB" }],
  ["jahvid best", { playerId: "P_BEST", name: "Jahvid Best", position: "RB" }],
  ["best", { playerId: "P_BEST", name: "Jahvid Best", position: "RB" }],
]);

const parse = (q: string, latestSeason: number | null = 2025) =>
  parseRules(q, [], INDEX, { latestSeason });
const spec = (q: string) => parse(q) as QuerySpec;

describe("parseRules — core shapes", () => {
  it("leaders question -> leaders intent with season", () => {
    expect(parse("who had the most passing yards in 2024?")).toMatchObject({
      intent: "leaders", stat: "passing_yards", season: 2024, scope: "season",
    });
  });

  it("player without a year -> career total", () => {
    expect(parse("patrick mahomes passing touchdowns")).toMatchObject({
      intent: "player_total", stat: "passing_tds", playerId: "P_MAHOMES", scope: "career",
    });
  });

  it("player with a year -> season total", () => {
    expect(parse("mahomes passing yards in 2023")).toMatchObject({
      intent: "player_total", season: 2023, scope: "season",
    });
  });

  it("single-game phrasing -> single_game intent", () => {
    expect(parse("most receiving yards in a game")).toMatchObject({
      intent: "single_game", stat: "receiving_yards", limit: 5,
    });
  });

  it("versus phrasing -> compare with both ids and QB primary stat", () => {
    expect(parse("josh allen vs patrick mahomes")).toMatchObject({
      intent: "compare", playerId: "P_ALLEN", player2Id: "P_MAHOMES", stat: "passing_yards",
    });
  });

  it("postseason scope without a stat -> primary stat, POST", () => {
    expect(parse("josh allen postseason")).toMatchObject({
      intent: "player_total", stat: "passing_yards", seasonType: "POST",
    });
  });

  it("'first five games' scope is captured", () => {
    expect(parse("davante adams first five games")).toMatchObject({
      intent: "player_total", firstN: 5, stat: "receiving_yards",
    });
  });

  it("unparseable question -> null", () => {
    expect(parse("what's the weather like?")).toBeNull();
  });
});

describe("parseRules — short terms & synonyms", () => {
  it.each([
    ["most ints in 2020", "interceptions"],
    ["who threw the most ints", "interceptions"],
    ["most picks thrown in 2007", "interceptions"],
    ["who threw the most interceptions in 2020", "interceptions"],
    ["most recs in 2024", "receptions"],
    ["most catches in 2019", "receptions"],
    ["leader in rushes this season", "rushing_yards"],
    ["most pass yds in 2024", "passing_yards"],
  ])("%s -> %s", (question, stat) => {
    expect(parse(question)).toMatchObject({ intent: "leaders", stat });
  });

  it("false positives stay quiet: 'points' never triggers 'int'", () => {
    // "most points" -> fantasy? no: "points" alone isn't fantasy vocabulary
    // and must not substring-match "int". Honest null beats a wrong answer.
    expect(parse("most points in 2024")).toBeNull();
  });

  it("false positives: 'sprint' / 'painting' never trigger 'int'", () => {
    expect(parse("who can sprint the fastest")).toBeNull();
    expect(parse("best painting of 2024")).toBeNull();
  });

  it("'draft pick' does not become an interception question", () => {
    expect(parse("who was the best draft pick of 2020")).toMatchObject({
      intent: "draft_pick",
      season: 2020,
    });
  });

  it("surnames colliding with vocabulary never hijack a leaders question", () => {
    // T.J. Rushing (CB) must not turn "rushing yards" into his stat line.
    expect(parse("top 3 rushing yards this season")).toMatchObject({
      intent: "leaders", stat: "rushing_yards", season: 2025, limit: 3,
    });
    // Jahvid Best must not absorb the superlative "best".
    expect(parse("best rushing yards in 2010")).toMatchObject({ intent: "leaders" });
    // ...but his full name still resolves him.
    expect(parse("jahvid best rushing yards")).toMatchObject({
      intent: "player_total", playerId: "P_BEST",
    });
  });
});

describe("parseRules — generic cues resolve by context", () => {
  it("RB + 'touchdowns' -> rushing TDs, not passing", () => {
    expect(parse("derrick henry touchdowns")).toMatchObject({
      intent: "player_total", stat: "rushing_tds", playerId: "P_HENRY",
    });
  });

  it("WR + 'tds' -> receiving TDs", () => {
    expect(parse("davante adams tds in 2022")).toMatchObject({
      stat: "receiving_tds", season: 2022,
    });
  });

  it("QB + bare 'yards' -> passing yards", () => {
    expect(parse("mahomes yards in 2023")).toMatchObject({ stat: "passing_yards" });
  });

  it("no player + 'touchdowns' -> combined total TDs", () => {
    expect(parse("most touchdowns in 2024")).toMatchObject({
      intent: "leaders", stat: "total_tds", season: 2024,
    });
  });

  it("no player + 'yards' -> yards from scrimmage", () => {
    expect(parse("most yards in 2024")).toMatchObject({
      intent: "leaders", stat: "scrimmage_yards",
    });
  });

  it("bare player name -> season-by-season answer", () => {
    expect(parse("patrick mahomes")).toMatchObject({
      intent: "player_seasons", stat: "passing_yards",
    });
  });
});

describe("parseRules — career leaders, top-N, relative seasons", () => {
  it("'most career rushing yards' -> career leaders, no season", () => {
    expect(parse("most career rushing yards")).toMatchObject({
      intent: "leaders", scope: "career", stat: "rushing_yards", season: null,
    });
  });

  it.each(["most receptions ever", "all time receptions leaders", "most receptions in history"])(
    "'%s' -> career leaders",
    (question) => {
      expect(parse(question)).toMatchObject({ intent: "leaders", scope: "career", stat: "receptions" });
    },
  );

  it("bare leaderboard question defaults to last season, not all-time", () => {
    // No year, no "career", no position -> the most recent loaded season,
    // instead of ranking the best single season in all of history.
    expect(parse("most rushing touchdowns")).toMatchObject({
      intent: "leaders", stat: "rushing_tds", season: 2025, scope: "season",
    });
    // "career"/"all-time" still widens to the all-time board.
    expect(parse("most career rushing touchdowns")).toMatchObject({
      intent: "leaders", scope: "career", season: null,
    });
    // Degrades to null when no season is loaded (nothing to default to).
    expect(parse("most rushing touchdowns", null)).toMatchObject({ season: null });
    // A generic name search and a comparison keep their own career default —
    // the season default is scoped to leaderboard questions only.
    expect(parse("patrick mahomes")).toMatchObject({ intent: "player_seasons", scope: "career" });
  });

  it("'top 5' sets the result count", () => {
    expect(parse("top 5 passing yards in 2023")).toMatchObject({ intent: "leaders", limit: 5 });
    expect(parse("top ten rushing yards in 2019")).toMatchObject({ limit: 10 });
  });

  it("'this season' resolves to the newest loaded season", () => {
    expect(parse("most passing yards this season")).toMatchObject({ season: 2025 });
    expect(parse("most passing yards last season")).toMatchObject({ season: 2024 });
  });

  it("relative seasons degrade gracefully without warehouse context", () => {
    expect(parse("most passing yards this season", null)).toMatchObject({ season: null });
  });

  it("career player total: 'mahomes career tds'", () => {
    expect(parse("mahomes career tds")).toMatchObject({
      intent: "player_total", stat: "passing_tds", scope: "career",
    });
  });
});

describe("parseRules — scoring events (first/last TD)", () => {
  it("'first touchdown' asks WHICH game, not a count", () => {
    expect(parse("when did derrick henry score his first touchdown")).toMatchObject({
      intent: "scoring", edge: "first", playerId: "P_HENRY",
    });
  });

  it("'last td' -> most recent scoring event", () => {
    expect(parse("derrick henry last td")).toMatchObject({
      intent: "scoring", edge: "last", limit: 1,
    });
  });

  it("'when did X score' without an edge -> recent list", () => {
    expect(parse("when did davante adams score")).toMatchObject({
      intent: "scoring", edge: null, limit: 10,
    });
  });

  it("'tds last season' stays a season count, not a timeline", () => {
    expect(parse("derrick henry tds last season")).toMatchObject({
      intent: "player_total", stat: "rushing_tds", season: 2024,
    });
  });

  it("'first 5 games' stays a first-N scope, not a timeline", () => {
    expect(parse("derrick henry first 5 games")).toMatchObject({
      intent: "player_total", firstN: 5,
    });
  });

  it("postseason scoring scope carries through", () => {
    expect(parse("derrick henry first playoff touchdown")).toMatchObject({
      intent: "scoring", edge: "first", seasonType: "POST",
    });
  });
});

describe("buildSql", () => {
  it("binds every user value as a parameter", () => {
    const sp = spec("most rushing yards in 2019");
    const { sql, params } = buildSql(sp);
    expect(sql).not.toContain("2019"); // season only via bind param
    expect(params).toContain(2019);
    expect(sql).toMatch(/ORDER BY value DESC, s\.season DESC, p\.full_name LIMIT \$\d+/);
  });

  it("career leaders aggregate across seasons", () => {
    const sp = spec("most career passing yards");
    const { sql } = buildSql(sp);
    expect(sql).toContain("SUM(s.passing_yards)");
    expect(sql).toContain("GROUP BY p.player_id");
  });

  it("computed stats expand to COALESCE'd expressions", () => {
    const sp = spec("most touchdowns in 2024");
    const { sql } = buildSql(sp);
    expect(sql).toContain("COALESCE(s.passing_tds, 0) + COALESCE(s.rushing_tds, 0) + COALESCE(s.receiving_tds, 0)");
  });

  it("scoring queries walk the touchdown timeline in the right direction", () => {
    const first = buildSql(spec("derrick henry first touchdown"));
    expect(first.sql).toContain("FROM scoring_plays");
    expect(first.sql).toMatch(/ORDER BY g\.season ASC/);
    const last = buildSql(spec("derrick henry last touchdown"));
    expect(last.sql).toMatch(/ORDER BY g\.season DESC/);
  });

  it("compare unions two per-player aggregates", () => {
    const sp = spec("adams versus mahomes");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("UNION ALL");
    expect(params.slice(0, 2)).toEqual(["P_ADAMS", "P_MAHOMES"]);
  });

  it("first-N-games leaders window is a per-player ROW_NUMBER cutoff", () => {
    const sp = spec("Who scored the most touchdowns through his first 50 career games?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY g.game_date, g.game_id)");
    expect(sql).toContain("WHERE s.rn <=");
    expect(params).toContain(50);
  });

  it("before-Nth-season leaders window excludes players with no rookie_season", () => {
    const sp = spec("Who gained the most rushing yards before his fifth NFL season?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("p.rookie_season IS NOT NULL");
    expect(sql).toContain("s.season < p.rookie_season +");
    expect(params).toContain(4); // "before his fifth season" -> seasons 1..4
  });

  it("ascending first-N-games boards require the full window", () => {
    const sp = spec("Who scored the fewest touchdowns through his first 50 career games?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("HAVING COUNT(*) >=");
    expect(params.filter((v) => v === 50).length).toBeGreaterThanOrEqual(2); // window + floor
  });

  it("ascending before-Nth-season boards get a games floor", () => {
    const sp = spec("Who had the fewest rushing yards before his fifth NFL season?");
    const { sql } = buildSql(sp);
    expect(sql).toContain("HAVING SUM(COALESCE(s.games_played, 0)) >= 8");
  });

  it("scoring boards count the touchdown log with bound distance filters", () => {
    const sp = spec("Who has scored the most rushing touchdowns from exactly 1 yard out?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("FROM scoring_plays");
    expect(sql).toContain("s.yards >=");
    expect(sql).toContain("s.yards <=");
    expect(sql).toContain("s.td_kind =");
    expect(params).toContain("rush");
    expect(params.filter((v) => v === 1)).toHaveLength(2); // min + max, bound
  });

  it("defensive boards span both return kinds — never kick/punt returns", () => {
    const sp = spec("Who has the most defensive touchdowns in NFL history?");
    const { sql } = buildSql(sp);
    expect(sql).toContain("s.td_kind IN ('int_return', 'fumble_return')");
    expect(sql).toContain("COUNT(*) AS value");
  });

  it("game-result leaders filter by the stat owner's W/L in each game", () => {
    const lost = buildSql(spec("Who scored the most touchdowns in games his team lost?"));
    expect(lost.sql).toContain(
      "CASE WHEN s.team_id = g.home_team THEN g.home_score ELSE g.away_score END < " +
      "CASE WHEN s.team_id = g.home_team THEN g.away_score ELSE g.home_score END",
    );
    const won = buildSql(spec(
      "Who has the most games with at least three interceptions and still won?",
    ));
    expect(won.sql).toContain(
      "CASE WHEN s.team_id = g.home_team THEN g.home_score ELSE g.away_score END > " +
      "CASE WHEN s.team_id = g.home_team THEN g.away_score ELSE g.home_score END",
    );
  });

  it("one-score leaders filter by an 8-point final margin", () => {
    const sp = spec("Who scored the most touchdowns in one-score games?");
    const { sql } = buildSql(sp);
    expect(sql).toContain("ABS(g.home_score - g.away_score) <= 8");
  });

  it("opponent-record leaders filter by the OPPONENT's final regular-season record", () => {
    const sp = spec("Who scored the most touchdowns against teams with winning records?");
    const { sql } = buildSql(sp);
    // An uncorrelated (team_id, season) IN-subquery — not a per-row
    // correlated scalar subquery, which measurably timed out over the full
    // game log (see shared.ts's gamePreds doc comment on oppWinningRecord).
    expect(sql).toContain("g.season) IN (");
    expect(sql).toContain("FROM team_game_stats tgs JOIN games g2 ON g2.game_id = tgs.game_id");
    expect(sql).toContain("WHERE g2.season_type = 'REG'");
    expect(sql).toContain("> 0.5)");
  });

  it("per-opponent leaders group by (player, opponent) and rank the best pair", () => {
    const sp = spec("Who has scored the most touchdowns against one specific opponent?");
    const { sql } = buildSql(sp);
    expect(sql).toContain(
      "JOIN teams opp ON opp.team_id = " +
      "CASE WHEN s.team_id = g.home_team THEN g.away_team ELSE g.home_team END",
    );
    expect(sql).toContain("GROUP BY p.player_id, p.full_name, opp.team_id, opp.name");
    expect(sql).toContain("ORDER BY value DESC");
  });

  it("ascending per-opponent boards flip the ORDER BY and floor the pair at 8 games", () => {
    const sp = spec("Who has scored the fewest touchdowns against a single opponent?");
    const { sql } = buildSql(sp);
    expect(sql).toContain("ORDER BY value ASC");
    expect(sql).toContain("HAVING COUNT(*) >= 8");
  });

  it("compound same-game thresholds AND a second stat's per-game value", () => {
    const sp = spec("Who has the most career games with both a rushing and receiving touchdown?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("s.rushing_tds >=");
    expect(sql).toContain("s.receiving_tds >=");
    expect(params.filter((v) => v === 1)).toHaveLength(2); // primary >=1 AND'd with the second >=1
  });

  // ---- Task 6: derived-negation boards ----

  it("season-threshold negation excludes any player whose best season cleared the bar", () => {
    const sp = spec("Who has the most career rushing yards without a 1,500-yard season?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("FROM player_season_stats s");
    expect(sql).toContain("HAVING MAX(s.rushing_yards) <");
    expect(params).toContain(1500);
  });

  it("league-lead negation excludes any player who was ever the season's leader", () => {
    const sp = spec("Who has the most career touchdowns without ever leading the league in touchdowns?");
    const { sql } = buildSql(sp);
    expect(sql).toContain("WITH szn AS (");
    expect(sql).toContain("MAX(v) AS mx FROM szn GROUP BY season");
    expect(sql).toContain("NOT IN (SELECT player_id FROM led)");
  });

  it("cross-stat zero condition aggregates the game log for a game-sourced primary stat", () => {
    const sp = spec("Who has the most rushing attempts without scoring a touchdown?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("SUM(s.carries)");
    expect(sql).toContain("FROM player_game_stats s");
    expect(sql).toContain("HAVING SUM(COALESCE(s.rushing_tds, 0)) =");
    expect(params).toContain(0);
  });

  it("cross-stat TD side comes from the stat itself, never a rushing default (receptions -> receiving)", () => {
    const sp = spec("Who has the most receptions without scoring a touchdown?");
    const { sql } = buildSql(sp);
    expect(sql).toContain("FROM player_season_stats s");
    expect(sql).toContain("HAVING SUM(COALESCE(s.receiving_tds, 0)) =");
  });

  it("cross-stat bound aggregates player_season_stats for a season-rollup primary stat", () => {
    const sp = spec("Who has the most rushing touchdowns with fewer than 1,000 career rushing yards?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("FROM player_season_stats s");
    expect(sql).toContain("HAVING SUM(COALESCE(s.rushing_yards, 0)) <");
    expect(params).toContain(1000);
  });

  // ---- Review fixes: the negation branches never applied spec.position,
  // so "which running back leads X without a Y-season" silently ranked
  // every position and just labeled the answer "among RBs" — a wrong
  // player (e.g. a WR) narrated as the RB leader. ----

  it("season-threshold negation boards apply the position filter (was: ignored, wrong-position answer)", () => {
    const sp = spec("Which running backs have the most receiving yards without a 1,500-yard season?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("p.position =");
    expect(params).toContain("RB");
  });

  it("league-lead negation boards filter the OUTER ranking by position but keep 'led the league' league-wide", () => {
    const sp = spec("Which running backs have the most rushing touchdowns without ever leading the league?");
    const { sql, params } = buildSql(sp);
    const cteEnd = sql.indexOf("NOT IN (SELECT player_id FROM led)");
    expect(cteEnd).toBeGreaterThan(0);
    // The szn/szn_max/led CTEs compute the league-wide season leader set —
    // no position filter inside them.
    expect(sql.slice(0, cteEnd)).not.toContain("p.position");
    // Only the outer ranking (who tops the remaining career-sum board) is
    // restricted to the asked-about position.
    expect(sql.slice(cteEnd)).toContain("p.position =");
    expect(params).toContain("RB");
  });

  it("cross-stat season-rollup boards apply the position filter", () => {
    const sp = spec("Which quarterbacks have the most rushing touchdowns with fewer than 1,000 career rushing yards?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("FROM player_season_stats s");
    expect(sql).toContain("p.position =");
    expect(params).toContain("QB");
  });

  // ---- Review fixes: cross-family combos are parser-joint (both fields
  // land on the spec) but the executor is first-match-wins — audit.test.ts
  // covers the refusal; this pins the parse-level shape the refusal
  // reasons about. ----

  it("age window + season-threshold negation both land on the spec (audit refuses the combo)", () => {
    const sp = spec("Most rushing yards after turning 30 without a 1,500-yard season?");
    expect(sp).toMatchObject({ minAgeYears: 30, withoutSeasonAtLeast: 1500 });
  });

  it("per-opponent + age window both land on the spec (audit refuses the combo)", () => {
    const sp = spec("Most rushing yards against a single opponent after turning 30?");
    expect(sp).toMatchObject({ perOpponent: true, minAgeYears: 30 });
  });

  // ---- Review fix: the compound-TD paraphrase without "both"/"at least
  // one...one" used to silently answer a plain rushing-TD board, dropping
  // the receiving-TD half entirely. Must parse identically to Q99. ----

  it("the bare compound-TD paraphrase ('a rushing TD and a receiving TD') parses like Q99's 'both' phrasing", () => {
    const both = spec("Who has the most career games with both a rushing and receiving touchdown?");
    const bare = spec("Who has the most career games with a rushing touchdown and a receiving touchdown?");
    expect(bare).toMatchObject({
      intent: "game_count_leaders", stat: "rushing_tds",
      threshold: { op: ">=", value: 1 },
      andStat: "receiving_tds", andThreshold: { op: ">=", value: 1 },
      scope: "career",
    });
    expect(bare).toEqual(both);
  });

  // ---- Review fix: the cumulative-window return dropped season/range/venue/
  // week/month/primetime/tempMax even though the executor honors them all via
  // gamePreds — "...in games his team lost in 2019" answered all-time. ----

  it("a season pin threads through the cumulative-window leaders spec and SQL", () => {
    const sp = spec("Who scored the most rushing yards in games his team lost in 2019?");
    expect(sp).toMatchObject({ gameResult: "L", season: 2019 });
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("g.season =");
    expect(params).toContain(2019);
  });

  // R2 sibling: the beforeSeasonN rollup path can't express game-window
  // fields (venue/month/weeks/season...), so any of them forces the game
  // log, where gamePreds honors all of them — never a silently-dropped
  // filter under a narration that voices it.
  it("before-Nth-season boards route to the game log when a game-window field is set", () => {
    const sp = spec("Who gained the most rushing yards before his fifth NFL season at home in 2019?");
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("FROM player_game_stats s");
    expect(sql).toContain("g.season =");
    expect(sql).toContain("s.team_id = g.home_team");
    expect(params).toContain(2019);
  });

  // R1 sibling: a pinned season on a career-scope board must bound the SUM,
  // not be silently ignored while the narration voices it (reachable via the
  // team-leaders parse branch: "who led the chiefs in career X in 2023").
  it("career-scope leaders honor a pinned single season in the season-rollup SQL", () => {
    const sp = {
      intent: "leaders", stat: "receiving_yards", seasonType: "REG",
      scope: "career", season: 2023, limit: 10,
    } as QuerySpec;
    const { sql, params } = buildSql(sp);
    expect(sql).toContain("s.season =");
    expect(params).toContain(2023);
  });
});

describe("narrate", () => {
  it("formats leader narration with separators", () => {
    const sp = spec("most passing yards in 2024");
    const text = narrate(sp, [{ full_name: "Joe Burrow", season: 2024, value: 4918 }]);
    expect(text).toBe("Joe Burrow leads with 4,918 passing yards in 2024.");
  });

  it("career leaders get all-time phrasing", () => {
    const sp = spec("most career passing yards");
    const text = narrate(sp, [{ full_name: "Tom Brady", seasons: 23, value: 89214 }]);
    expect(text).toBe("Tom Brady leads all time with 89,214 career passing yards.");
  });

  it("handles empty result sets", () => {
    const sp = spec("most passing yards in 2024");
    expect(narrate(sp, [])).toBe("No matching results found.");
  });

  it("compare narration names the winner", () => {
    const sp = spec("allen vs mahomes");
    // cmp_value is the requested stat computed per side by the executor; for a
    // plain column stat it equals the summed column.
    const text = narrate(sp, [
      { full_name: "Josh Allen", games: 100, passing_yards: 30000, cmp_value: 30000 },
      { full_name: "Patrick Mahomes", games: 98, passing_yards: 28000, cmp_value: 28000 },
    ]);
    expect(text).toBe(
      "Over their careers, Josh Allen leads Patrick Mahomes in passing yards, 30,000 to 28,000.",
    );
  });

  it("compare narration reports the real ratio value, not fantasy points", () => {
    // Regression guard for the fantasy-points substitution bug: a ratio stat
    // must narrate its own computed value (cmp_value), with its unit.
    const sp = spec("allen vs mahomes completion percentage");
    const text = narrate(sp, [
      { full_name: "Patrick Mahomes", games: 98, cmp_value: 67.3 },
      { full_name: "Josh Allen", games: 100, cmp_value: 65.2 },
    ]);
    expect(text).toBe(
      "Over their careers, Patrick Mahomes leads Josh Allen in completion percentage, 67.3% to 65.2%.",
    );
  });

  it("first-N-games leaders narrate the window, not a career total", () => {
    const sp = spec("Who scored the most touchdowns through his first 50 career games?");
    const text = narrate(sp, [{ full_name: "Emmitt Smith", value: 62 }]);
    expect(text).toBe("Emmitt Smith leads with 62 total touchdowns through their first 50 games.");
  });

  it('"starts" phrasing narrates games with a no-starts-data caveat', () => {
    const sp = spec("Who threw the most touchdown passes through his first 50 starts?");
    const text = narrate(sp, [{ full_name: "Peyton Manning", value: 210 }]);
    expect(text).toBe(
      "Peyton Manning leads with 210 passing touchdowns through their first 50 games " +
      "(games, not starts — no starts data on file).",
    );
  });

  it("before-Nth-season leaders narrate the season boundary", () => {
    const sp = spec("Who gained the most rushing yards before his fifth NFL season?");
    const text = narrate(sp, [{ full_name: "Eric Dickerson", value: 7291 }]);
    expect(text).toBe("Eric Dickerson leads with 7,291 rushing yards before their 5th season.");
  });

  it("scoring boards narrate the distance filter in house style", () => {
    expect(
      narrate(spec("Who has scored the most 1-yard touchdowns in NFL history?"),
        [{ full_name: "Mike Alstott", value: 22 }]),
    ).toBe("Mike Alstott leads with 22 1-yard touchdowns.");
    expect(
      narrate(spec("Who has scored the most touchdowns of 50 or more yards?"),
        [{ full_name: "Tyreek Hill", value: 30 }]),
    ).toBe("Tyreek Hill leads with 30 touchdowns of 50 or more yards.");
    expect(
      narrate(spec("Who has scored the most touchdowns from inside the 5-yard line?"),
        [{ full_name: "LaDainian Tomlinson", value: 80 }]),
    ).toBe("LaDainian Tomlinson leads with 80 touchdowns from inside the 5-yard line.");
    expect(
      narrate(spec("Who has scored the most rushing touchdowns from exactly 1 yard out?"),
        [{ full_name: "Marcus Allen", value: 25 }]),
    ).toBe("Marcus Allen leads with 25 1-yard rushing touchdowns.");
  });

  it("defensive boards narrate the return kind", () => {
    expect(
      narrate(spec("Who has the most interception-return touchdowns?"),
        [{ full_name: "Rod Woodson", value: 12 }]),
    ).toBe("Rod Woodson leads with 12 interception-return touchdowns.");
    expect(
      narrate(spec("Who has the most defensive touchdowns in NFL history?"),
        [{ full_name: "Rod Woodson", value: 13 }]),
    ).toBe("Rod Woodson leads with 13 defensive touchdowns.");
  });

  // Task 7 benchmark rerun (q91): the live warehouse has Charles Woodson and
  // Ronde Barber tied at 12 defensive touchdowns — the scoring board used to
  // always name only the first row, implying sole possession of a record two
  // players actually share. Every "who leads" board must voice a tie.
  it("scoring boards name every player tied for the lead", () => {
    const text = narrate(spec("Who has the most defensive touchdowns in NFL history?"), [
      { full_name: "Charles Woodson", value: 12 },
      { full_name: "Ronde Barber", value: 12 },
      { full_name: "DeAngelo Hall", value: 10 },
    ]);
    expect(text).toBe(
      "Charles Woodson and Ronde Barber are tied for the lead with 12 defensive touchdowns.",
    );
  });

  it("age-window leaders narrate the turning-N boundary", () => {
    const sp = spec("Who recorded the most rushing yards after turning 30?");
    const text = narrate(sp, [{ full_name: "Frank Gore", value: 4000 }]);
    expect(text).toBe("Frank Gore leads with 4,000 rushing yards after turning 30.");
  });

  it("combined age + season windows narrate BOTH qualifiers", () => {
    const sp = spec("Who scored the most touchdowns after turning 30 in his first three seasons?");
    const text = narrate(sp, [{ full_name: "Old Rookie", value: 7 }]);
    expect(text).toBe(
      "Old Rookie leads with 7 total touchdowns before their 4th season after turning 30.",
    );
  });

  it("combined age + first-N windows narrate BOTH qualifiers", () => {
    const sp = spec("Who scored the most touchdowns through his first 100 games after turning 30?");
    const text = narrate(sp, [{ full_name: "Old Rookie", value: 9 }]);
    expect(text).toBe(
      "Old Rookie leads with 9 total touchdowns through their first 100 games after turning 30.",
    );
  });

  it("postseason age/season windows say postseason", () => {
    const age = spec("Who threw the most playoff touchdown passes after turning 35?");
    expect(narrate(age, [{ full_name: "Tom Brady", value: 349 }])).toBe(
      "Tom Brady leads with 349 postseason passing touchdowns after turning 35.",
    );
    const seasons = spec("Who threw the most playoff touchdown passes before his fifth season?");
    expect(narrate(seasons, [{ full_name: "Patrick Mahomes", value: 40 }])).toBe(
      "Patrick Mahomes leads with 40 postseason passing touchdowns before their 5th season.",
    );
  });

  it("ascending window boards say 'fewest', never 'leads'", () => {
    const g = spec("Who scored the fewest touchdowns through his first 50 career games?");
    expect(narrate(g, [{ full_name: "Punter Guy", value: 0 }])).toBe(
      "Punter Guy have the fewest with 0 total touchdowns through their first 50 games.",
    );
    const s = spec("Who had the fewest rushing yards before his fifth NFL season?");
    expect(narrate(s, [{ full_name: "Punter Guy", value: 3 }])).toBe(
      "Punter Guy have the fewest with 3 rushing yards before their 5th season.",
    );
  });

  // Review fix: the SQL already ANDs a game-result/venue/week/etc. filter
  // onto a first-N/before-Nth-season/after-turning-N window via gamePreds,
  // but the narration used to drop it — "through his first 50 games in
  // games his team lost" answered correctly yet described only the window.
  it("combined first-N + game-result windows narrate BOTH qualifiers", () => {
    const sp = spec("Who scored the most touchdowns through his first 50 games in games his team lost?");
    const text = narrate(sp, [{ full_name: "Emmitt Smith", value: 62 }]);
    expect(text).toBe(
      "Emmitt Smith leads with 62 total touchdowns through their first 50 games in losses.",
    );
  });

  // R1: a season pinned onto a career-shaped board is season-scoped in the
  // SQL — "leads ALL TIME with N CAREER yards" would be affirmatively false,
  // so the narration voices the year and drops the all-time/career phrasing.
  it("season-pinned cumulative-window boards voice the season, never 'all time'/'career'", () => {
    const sp = spec("Who has the most rushing yards in games his team lost in 2019?");
    const text = narrate(sp, [{ full_name: "Joe Mixon", value: 931 }]);
    expect(text).toBe("Joe Mixon leads with 931 rushing yards in 2019 in losses.");
  });

  it("window boards voice a pinned season (the SQL applies it via gamePreds)", () => {
    const sp = spec("Who recorded the most rushing yards after turning 30 in 2019?");
    const text = narrate(sp, [{ full_name: "Frank Gore", value: 800 }]);
    expect(text).toBe("Frank Gore leads with 800 rushing yards after turning 30 in 2019.");
  });

  it("game-result leaders narrate the loss/win qualifier", () => {
    const lost = spec("Who scored the most touchdowns in games his team lost?");
    expect(narrate(lost, [{ full_name: "Joe Flacco", value: 30 }])).toBe(
      "Joe Flacco leads all time with 30 career total touchdowns in losses.",
    );
    const oneScore = spec("Who scored the most touchdowns in one-score games?");
    expect(narrate(oneScore, [{ full_name: "Joe Flacco", value: 30 }])).toBe(
      "Joe Flacco leads all time with 30 career total touchdowns in one-score games.",
    );
    const oneScoreLoss = spec("Who has the most passing yards in one-score losses?");
    expect(narrate(oneScoreLoss, [{ full_name: "Joe Flacco", value: 5000 }])).toBe(
      "Joe Flacco leads all time with 5,000 career passing yards in one-score losses.",
    );
  });

  it("opponent-record leaders disclose the final-record simplification", () => {
    const sp = spec("Who scored the most touchdowns against teams with winning records?");
    expect(narrate(sp, [{ full_name: "Jerry Rice", value: 100 }])).toBe(
      "Jerry Rice leads all time with 100 career total touchdowns against teams that finished " +
      "with winning records.",
    );
  });

  it("per-opponent leaders name both the player and the opponent", () => {
    const sp = spec("Who has scored the most touchdowns against one specific opponent?");
    const text = narrate(sp, [
      { full_name: "Adrian Peterson", opponent_id: "CHI", opponent_name: "Chicago Bears", value: 18 },
    ]);
    expect(text).toBe(
      "Adrian Peterson has the most total touchdowns against a single opponent — " +
      "18 against the Chicago Bears.",
    );
  });

  // Review fix: a co-occurring game-result/margin filter is applied in the
  // SQL via gamePreds the same as every other game-grain board, but the
  // per-opponent narration used to drop it silently.
  it("per-opponent leaders voice a co-occurring game-result qualifier", () => {
    const sp = spec("Who has scored the most touchdowns against a single opponent in one-score games?");
    const text = narrate(sp, [
      { full_name: "Adrian Peterson", opponent_id: "CHI", opponent_name: "Chicago Bears", value: 18 },
    ]);
    expect(text).toBe(
      "Adrian Peterson has the most total touchdowns against a single opponent — " +
      "18 against the Chicago Bears in one-score games.",
    );
  });

  it("ascending per-opponent boards say 'fewest' and voice the games floor", () => {
    const sp = spec("Who has scored the fewest touchdowns against a single opponent?");
    const text = narrate(sp, [
      { full_name: "Punter Guy", opponent_id: "CHI", opponent_name: "Chicago Bears", value: 0 },
    ]);
    expect(text).toBe(
      "Punter Guy has the fewest total touchdowns against a single opponent — " +
      "0 against the Chicago Bears (min. 8 games).",
    );
  });

  it("compound same-game qualifying-game boards voice BOTH stats", () => {
    const sp = spec("Who has the most career games with both a rushing and receiving touchdown?");
    const text = narrate(sp, [{ full_name: "Christian McCaffrey", value: 12 }]);
    expect(text).toBe(
      "Christian McCaffrey leads with 12 games with at least 1 rushing touchdowns " +
      "and at least 1 receiving touchdowns.",
    );
  });

  it("'and still won' game-count-leaders boards say so in the narration", () => {
    const sp = spec("Who has the most games with at least three interceptions and still won?");
    const text = narrate(sp, [{ full_name: "Brett Favre", value: 4 }]);
    expect(text).toBe(
      "Brett Favre leads with 4 games with at least 3 interceptions and still won.",
    );
  });

  // ---- Task 6: derived-negation boards (house style: "X leads with N
  // career STAT without a [threshold]-yard season.") ----

  it("season-threshold negation narrates the yard-season exclusion", () => {
    const sp = spec("Who has the most career rushing yards without a 1,500-yard season?");
    const text = narrate(sp, [{ full_name: "Curtis Martin", value: 14101 }]);
    expect(text).toBe("Curtis Martin leads with 14,101 career rushing yards without a 1,500-yard season.");
  });

  it("season-threshold negation says 'catch', not 'yard', for receptions", () => {
    const sp = spec("Who has the most career receptions without a 100-catch season?");
    const text = narrate(sp, [{ full_name: "Larry Fitzgerald", value: 1432 }]);
    expect(text).toBe("Larry Fitzgerald leads with 1,432 career receptions without a 100-catch season.");
  });

  it("league-lead negation narrates the never-led-the-league exclusion", () => {
    const sp = spec("Who has the most career touchdowns without ever leading the league in touchdowns?");
    const text = narrate(sp, [{ full_name: "Frank Gore", value: 96 }]);
    expect(text).toBe("Frank Gore leads with 96 career total touchdowns without ever leading the league.");
  });

  it("cross-stat zero condition narrates as a scoring exclusion", () => {
    const sp = spec("Who has the most rushing attempts without scoring a touchdown?");
    const text = narrate(sp, [{ full_name: "Journeyman Back", value: 250 }]);
    expect(text).toBe(
      "Journeyman Back leads with 250 career rushing attempts without ever scoring a rushing touchdown.",
    );
  });

  it("cross-stat bound narrates as a career-total bound on the other stat", () => {
    const sp = spec("Who has the most rushing touchdowns with fewer than 1,000 career rushing yards?");
    const text = narrate(sp, [{ full_name: "Goal-Line Back", value: 45 }]);
    expect(text).toBe(
      "Goal-Line Back leads with 45 career rushing touchdowns with fewer than 1,000 career rushing yards.",
    );
  });
});

describe("similarity (difflib port)", () => {
  it("matches Python SequenceMatcher.ratio values", () => {
    // Reference values computed with CPython difflib.
    expect(ratio("mahomes", "mahomes")).toBe(1);
    expect(ratio("pat mahomes", "patrick mahomes")).toBeCloseTo(0.8461538, 5);
    expect(ratio("mahomse", "mahomes")).toBeCloseTo(0.8571428, 5);
  });
});
