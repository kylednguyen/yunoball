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
});

describe("similarity (difflib port)", () => {
  it("matches Python SequenceMatcher.ratio values", () => {
    // Reference values computed with CPython difflib.
    expect(ratio("mahomes", "mahomes")).toBe(1);
    expect(ratio("pat mahomes", "patrick mahomes")).toBeCloseTo(0.8461538, 5);
    expect(ratio("mahomse", "mahomes")).toBeCloseTo(0.8571428, 5);
  });
});
