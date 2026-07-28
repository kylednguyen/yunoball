/** Second-layer auditor: the DB-free validation paths.
 *
 * Contradictions, coverage bounds and the Super Bowl played-year rule all
 * decide before any warehouse probe runs, so these tests need no database.
 * Probe-backed behavior (surname clarification, player-active checks) is
 * covered by live verification against the warehouse.
 */

import { describe, expect, it } from "vitest";
import { audit } from "../src/engine/audit.js";
import type { QuerySpec } from "../src/engine/spec.js";

const base: QuerySpec = {
  intent: "player_total",
  stat: "passing_yards",
  seasonType: "REG",
  scope: "season",
  limit: 10,
};

const ctx = (question: string) => ({ question, entities: [], latestSeason: 2025 });

describe("second-layer auditor", () => {
  it("rejects contradictory week ranges", async () => {
    const out = await audit(
      { ...base, weekMin: 10, weekMax: 5 },
      ctx("mahomes stats weeks 10 to 5"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("contradictory");
  });

  it("rejects impossible weeks", async () => {
    const out = await audit({ ...base, weekMin: 40 }, ctx("week 40 stats"));
    expect(out.status).toBe("invalid");
  });

  it("rejects combined first-N and last-N windows", async () => {
    const out = await audit(
      { ...base, firstN: 5, lastN: 3 },
      ctx("first 5 last 3 games"),
    );
    expect(out.status).toBe("invalid");
  });

  it("blocks seasons before warehouse coverage", async () => {
    const out = await audit({ ...base, season: 1990 }, ctx("most yards 1990"));
    expect(out.status).toBe("no_matching_data");
    expect(out.reason).toContain("1999");
  });

  it("mentions Super Bowl coverage when an early SB is asked for", async () => {
    const out = await audit(
      { ...base, season: 1985, sbOnly: true },
      ctx("super bowl xx stats"),
    );
    expect(out.status).toBe("no_matching_data");
    expect(out.reason).toContain("Super Bowl XXXIV");
  });

  it("blocks future seasons and names the newest loaded one", async () => {
    const out = await audit({ ...base, season: 2030 }, ctx("chiefs 2030 record"));
    expect(out.status).toBe("no_matching_data");
    expect(out.reason).toContain("2025");
  });

  it("keeps season and played-year straight for Super Bowl questions", async () => {
    const out = await audit(
      {
        intent: "game_result", stat: "passing_yards", seasonType: "REG",
        scope: "season", limit: 10, season: 2023, round: "SB",
      },
      ctx("who won the 2024 super bowl"),
    );
    expect(out.status).toBe("validated_with_warnings");
    expect(out.warnings.join(" ")).toContain("Super Bowl LVIII");
    expect(out.warnings.join(" ")).toContain("2023 season");
    expect(out.confidence.season).toBeLessThan(1);
  });

  it("validates a clean spec with full confidence", async () => {
    const out = await audit(
      {
        intent: "leaders", stat: "passing_yards", seasonType: "REG",
        scope: "season", limit: 10, season: 2024,
      },
      ctx("most passing yards 2024"),
    );
    expect(out.status).toBe("validated");
    expect(out.confidence.overall).toBe(1);
  });

  it("repeats deterministically", async () => {
    const spec: QuerySpec = { ...base, season: 1990 };
    const a = await audit({ ...spec }, ctx("most yards 1990"));
    const b = await audit({ ...spec }, ctx("most yards 1990"));
    expect(a.status).toBe(b.status);
    expect(a.reason).toBe(b.reason);
    expect(a.confidence).toEqual(b.confidence);
  });
});

// Task 1: unconsumed-qualifier guardrail. Question text is the exact
// benchmark wording from .superpowers/sdd/q100.txt (numbers noted per case) —
// each names a filter the parser recognizes in prose but no spec field
// captures, so the spec below is deliberately built WITHOUT that field (the
// shape parseRules actually produces today) and the guard must refuse by
// name instead of silently answering the narrower, unqualified question.
const leaders = (stat: string, extra: Partial<QuerySpec> = {}): QuerySpec =>
  ({ intent: "leaders", stat, seasonType: "REG", scope: "career", limit: 25, ...extra }) as QuerySpec;

describe("unconsumed-qualifier guardrail", () => {
  it("refuses a TD-distance filter the spec never captured (q2)", async () => {
    const out = await audit(
      leaders("total_tds"),
      ctx("Who has scored the most touchdowns from inside the 5-yard line?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("distance");
  });

  it("does NOT refuse TD distance when a scoring board captured it (Task 4, q2)", async () => {
    const out = await audit(
      { intent: "scoring_board", stat: "total_tds", seasonType: "REG", scope: "career",
        limit: 10, yardsMax: 5, yardsMin: null, tdKind: null },
      ctx("Who has scored the most touchdowns from inside the 5-yard line?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("refuses a vs-team opponent split the spec never captured", async () => {
    const out = await audit(
      leaders("passing_yards"),
      ctx("most passing yards against the bills"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Opponent splits");
  });

  it("does NOT refuse vs-team when a player total captured opponentId", async () => {
    const out = await audit(
      { ...base, opponentId: "BUF", opponentName: "Buffalo Bills" },
      ctx("mahomes passing yards vs the bills"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("refuses a first-N-games window the spec never captured", async () => {
    const out = await audit(
      leaders("total_tds"),
      ctx("Who scored the most touchdowns through his first 50 career games?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("First-N-games");
  });

  it("does NOT refuse first-N when a named player's total actually captured it", async () => {
    const out = await audit(
      { ...base, firstN: 50 },
      ctx("Mahomes passing yards through his first 50 career games"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it('refuses "before beginning his Nth season" the spec never captured (q8)', async () => {
    const out = await audit(
      leaders("total_tds"),
      ctx("Who scored the most touchdowns before beginning his fifth NFL season?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Season-window");
  });

  it("does NOT refuse before-Nth-season when a qualifying-game board already captured it", async () => {
    const out = await audit(
      { intent: "game_count_leaders", stat: "rushing_yards", seasonType: "REG", scope: "career", limit: 10,
        threshold: { op: ">=", value: 100 }, beforeSeasonN: 5 },
      ctx("most 100-yard rushing games before his fifth season"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("refuses an after-turning-N age split the spec never captured", async () => {
    const out = await audit(
      leaders("total_tds"),
      ctx("Who scored the most touchdowns after turning 30?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Age splits");
  });

  it("does NOT refuse after-turning-N when a qualifying-game board already captured it", async () => {
    const out = await audit(
      { intent: "game_count_leaders", stat: "rushing_yards", seasonType: "REG", scope: "career", limit: 10,
        threshold: { op: ">=", value: 100 }, minAgeYears: 30 },
      ctx("Which player had the most 100-yard rushing games after turning 30?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("does NOT refuse after-turning-N when an aggregate leaders board captured it (Task 3, q25)", async () => {
    const out = await audit(
      leaders("rushing_yards", { minAgeYears: 30 }),
      ctx("Who recorded the most rushing yards after turning 30?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it('refuses "before turning N" — a max-age filter no spec field captures (q97)', async () => {
    const out = await audit(
      { intent: "leaders", stat: "passing_tds", seasonType: "POST", scope: "season",
        season: 2025, limit: 25 },
      ctx("Who threw the most playoff touchdown passes before turning 25?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Age splits");
  });

  it('refuses "final NFL season" the spec never captured (q15)', async () => {
    const out = await audit(
      leaders("total_tds"),
      ctx("Who scored the most touchdowns in a player's final NFL season?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Final-season");
  });

  it("still refuses q15 when the parser DEFAULTED the season (not named in the question)", async () => {
    // Live, the parser defaults a bare leaderboard to the latest season —
    // a defaulted season must not count as consuming the final-season split.
    const out = await audit(
      leaders("total_tds", { scope: "season", season: 2025 }),
      ctx("Who scored the most touchdowns in a player's final NFL season?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Final-season");
  });

  it('does NOT refuse a season-anchored question with a "final NFL season" aside', async () => {
    const out = await audit(
      leaders("passing_tds", { scope: "season", season: 2015 }),
      ctx("Most passing touchdowns in 2015, Peyton Manning's final NFL season"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it('refuses "most Pro Bowls" (plural) with the awards refusal', async () => {
    const out = await audit(
      leaders("total_tds"),
      ctx("Who has made the most Pro Bowls?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Award-based");
  });

  it('refuses "most rushing titles" (plural) with the awards refusal', async () => {
    const out = await audit(
      leaders("rushing_yards"),
      ctx("Who has won the most rushing titles?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Award-based");
  });

  it('refuses a singular "Pro Bowl" filter with the awards refusal', async () => {
    const out = await audit(
      leaders("rushing_yards", { scope: "season", season: 2023 }),
      ctx("Most rushing yards by a Pro Bowl running back in 2023"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Award-based");
  });

  it('refuses a singular "rushing title" filter with the awards refusal', async () => {
    const out = await audit(
      leaders("rushing_yards", { scope: "season", season: 2019 }),
      ctx("Who won the rushing title in 2019?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Award-based");
  });

  it('refuses "games his team lost" the spec never captured (q17)', async () => {
    const out = await audit(
      leaders("total_tds"),
      ctx("Who scored the most touchdowns in games his team lost?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("game result");
  });

  it('refuses "one-score games/losses" the spec never captured', async () => {
    const out = await audit(
      leaders("passing_yards", { season: 2024 }),
      ctx("Who has the most passing yards in one-score losses?"),
    );
    expect(out.status).toBe("invalid");
  });

  it('refuses "against teams with winning records" the spec never captured', async () => {
    const out = await audit(
      leaders("total_tds", { season: 2024 }),
      ctx("Who scored the most touchdowns against teams with winning records?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Opponent-record");
  });

  it('refuses "without a season" the spec never captured (q21, pre-Task-6 shape)', async () => {
    const out = await audit(
      leaders("rushing_yards"),
      ctx("Who has the most career rushing yards without a 1,500-yard season?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Without");
  });

  it('refuses unnamed single-opponent superlatives ("against one specific opponent")', async () => {
    const out = await audit(
      leaders("rushing_yards"),
      ctx("Who has scored the most touchdowns against one specific opponent?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("single-opponent");
  });

  it('refuses "and still won" result-conditioned filters (q57)', async () => {
    const out = await audit(
      { intent: "game_count_leaders", stat: "interceptions", seasonType: "REG", scope: "career", limit: 10,
        threshold: { op: ">=", value: 3 } },
      ctx("Who has the most games with at least three interceptions and still won?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("still won");
  });

  it('refuses compound same-game "both X and Y touchdown" filters (q99)', async () => {
    const out = await audit(
      leaders("receiving_tds"),
      ctx("Who has the most career games with both a rushing and receiving touchdown?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Compound");
  });

  it('refuses compound "at least one X and one Y touchdown" filters (q100)', async () => {
    const out = await audit(
      leaders("passing_tds"),
      ctx("Who has the most career games with at least one passing and one rushing touchdown?"),
    );
    expect(out.status).toBe("invalid");
  });

  // ---- Task 5: opponent + game-result context boards — guard retirement.
  // Same "spec never captured it" vs "spec actually captured it" pairing as
  // the earlier Task 2-4 blocks: each "refuses" case above stays refused
  // because the hand-built spec deliberately omits the new field; these
  // confirm the SAME regex stops firing once a spec sets it. ----

  it("does NOT refuse 'games his team lost' when gameResult captured (q17)", async () => {
    const out = await audit(
      leaders("total_tds", { gameResult: "L" }),
      ctx("Who scored the most touchdowns in games his team lost?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("does NOT refuse 'one-score losses' when oneScore+gameResult captured", async () => {
    const out = await audit(
      leaders("passing_yards", { oneScore: true, gameResult: "L" }),
      ctx("Who has the most passing yards in one-score losses?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("does NOT refuse 'one-score games' when only oneScore captured", async () => {
    const out = await audit(
      leaders("total_tds", { oneScore: true }),
      ctx("Who scored the most touchdowns in one-score games?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("does NOT refuse 'against teams with winning records' when captured (q19)", async () => {
    const out = await audit(
      leaders("total_tds", { oppWinningRecord: true, season: 2024 }),
      ctx("Who scored the most touchdowns against teams with winning records?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("does NOT refuse a per-opponent board once perOpponent is captured (q20)", async () => {
    const out = await audit(
      leaders("total_tds", { perOpponent: true }),
      ctx("Who has scored the most touchdowns against one specific opponent?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("still refuses 'against a single quarterback' even with an unrelated spec (q94/q95)", async () => {
    // Deliberately not implemented — sacks/interceptions are recorded
    // against the opposing TEAM in the warehouse, never a specific opposing
    // quarterback, so this rule has no retirement condition.
    const out = await audit(
      leaders("def_sacks", { season: 2024 }),
      ctx("Who has the most sacks against a single quarterback?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("opposing quarterback");
  });

  it("does NOT refuse 'and still won' when gameResult W is captured (q57)", async () => {
    const out = await audit(
      { intent: "game_count_leaders", stat: "interceptions", seasonType: "REG", scope: "career", limit: 10,
        threshold: { op: ">=", value: 3 }, gameResult: "W" },
      ctx("Who has the most games with at least three interceptions and still won?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("does NOT refuse a compound same-game filter once andStat is captured (q99)", async () => {
    const out = await audit(
      { intent: "game_count_leaders", stat: "rushing_tds", seasonType: "REG", scope: "career", limit: 10,
        threshold: { op: ">=", value: 1 }, andStat: "receiving_tds", andThreshold: { op: ">=", value: 1 } },
      ctx("Who has the most career games with both a rushing and receiving touchdown?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it('refuses the bare "a rushing TD and a receiving TD" paraphrase the spec never captured (review fix, pre-fix: silently answered a plain rushing-TD board)', async () => {
    const out = await audit(
      leaders("rushing_tds"),
      ctx("Who has the most career games with a rushing touchdown and a receiving touchdown?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Compound");
  });

  it('does NOT refuse the bare "a rushing TD and a receiving TD" paraphrase once andStat is captured (parses like Q99)', async () => {
    const out = await audit(
      { intent: "game_count_leaders", stat: "rushing_tds", seasonType: "REG", scope: "career", limit: 10,
        threshold: { op: ">=", value: 1 }, andStat: "receiving_tds", andThreshold: { op: ">=", value: 1 } },
      ctx("Who has the most career games with a rushing touchdown and a receiving touchdown?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("refuses q39 verbatim (also trips the age-split rule — either is honest)", async () => {
    const out = await audit(
      leaders("rushing_yards", { season: 2024 }),
      ctx("Which player had the highest percentage of his rushing yards come after age 30?"),
    );
    expect(out.status).toBe("invalid");
  });

  it("refuses a self-referential percentage-of-career split in isolation", async () => {
    const out = await audit(
      leaders("rushing_yards", { season: 2024 }),
      ctx("What percentage of his career rushing yards came in December?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Percentage-of-career");
  });

  it("does NOT refuse a real percentage-native stat leaderboard", async () => {
    const out = await audit(
      leaders("completion_pct", { season: 2023 }),
      ctx("Who had the best completion percentage in 2023?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it('does NOT refuse "who led the league in X" — a plain season-leaders lookup', async () => {
    const out = await audit(
      leaders("rushing_yards", { season: 2012 }),
      ctx("Who led the league in rushing in 2012?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("leaves a plain leaders question untouched", async () => {
    const out = await audit(
      leaders("passing_yards", { scope: "season", season: 2024 }),
      ctx("most passing yards in 2024"),
    );
    expect(out.status).toBe("validated");
  });

  it("leaves a plain qualifying-game-count question untouched", async () => {
    const out = await audit(
      { intent: "game_count_leaders", stat: "passing_yards", seasonType: "REG", scope: "career", limit: 10,
        threshold: { op: ">=", value: 300 } },
      ctx("most 300-yard passing games"),
    );
    expect(out.status).toBe("validated");
  });

  // ---- Task 6: derived-negation boards — guard retirement. Same "spec
  // never captured it" vs "spec actually captured it" pairing as Task 2-5:
  // the without-family rules above stay refused because a hand-built spec
  // omits the new field; these confirm the SAME regex stops firing once a
  // spec sets it. ----

  it("does NOT refuse a season-threshold negation once withoutSeasonAtLeast is captured (q21)", async () => {
    const out = await audit(
      leaders("rushing_yards", { withoutSeasonAtLeast: 1500 }),
      ctx("Who has the most career rushing yards without a 1,500-yard season?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("does NOT refuse a receptions season-threshold negation (q69)", async () => {
    const out = await audit(
      leaders("receptions", { withoutSeasonAtLeast: 100 }),
      ctx("Who has the most career receptions without a 100-catch season?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("refuses a season-threshold negation whose unit doesn't match the ranked stat (crashed live pre-fix: catches < 1000 for a 1,000-YARD season)", async () => {
    const out = await audit(
      leaders("receptions"),
      ctx("Who has the most career receptions without a 1,000-yard season?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("SAME stat");
  });

  it('refuses "without ever leading the league" the spec never captured (q16)', async () => {
    const out = await audit(
      leaders("total_tds"),
      ctx("Who has the most career touchdowns without ever leading the league in touchdowns?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("League-leadership");
  });

  it("does NOT refuse a league-lead negation once withoutLeagueLead is captured (q16)", async () => {
    const out = await audit(
      leaders("total_tds", { withoutLeagueLead: true }),
      ctx("Who has the most career touchdowns without ever leading the league in touchdowns?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("does NOT refuse a bare 'without leading the league' negation (q70, no 'ever'/'in X')", async () => {
    const out = await audit(
      leaders("receiving_tds", { withoutLeagueLead: true }),
      ctx("Who has the most career receiving touchdowns without leading the league?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it('refuses "without scoring a touchdown" the spec never captured (q35)', async () => {
    const out = await audit(
      leaders("carries"),
      ctx("Who has the most rushing attempts without scoring a touchdown?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("scoring a touchdown");
  });

  it("does NOT refuse a cross-stat zero condition once crossStat is captured (q35)", async () => {
    const out = await audit(
      leaders("carries", { crossStat: "rushing_tds", crossOp: "=", crossValue: 0 }),
      ctx("Who has the most rushing attempts without scoring a touchdown?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it('refuses "with fewer than N career X" the spec never captured (q36)', async () => {
    const out = await audit(
      leaders("rushing_tds"),
      ctx("Who has the most rushing touchdowns with fewer than 1,000 career rushing yards?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("fewer than N career X");
  });

  it("does NOT refuse a cross-stat bound once crossStat is captured (q36)", async () => {
    const out = await audit(
      leaders("rushing_tds", { crossStat: "rushing_yards", crossOp: "<", crossValue: 1000 }),
      ctx("Who has the most rushing touchdowns with fewer than 1,000 career rushing yards?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("still refuses q29's rushing-title exclusion (not implemented — game_count_leaders shape)", async () => {
    const out = await audit(
      { intent: "game_count_leaders", stat: "rushing_yards", seasonType: "REG", scope: "career", limit: 10,
        threshold: { op: ">=", value: 100 } },
      ctx("Who has the most 100-yard rushing games without winning a rushing title?"),
    );
    expect(out.status).toBe("invalid");
  });

  // ---- Review fixes: negation fields are parser-gated to plain
  // season-rollup stats (isSeasonRollupStat) / an explicit TD-side map, so
  // the phrasings below — each a live 500 or a wrong-stat answer pre-fix —
  // now reach the auditor with the field unset and refuse gracefully. The
  // hand-built specs mirror exactly what the gated parser produces. ----

  it("refuses the league-lead negation for a game-only stat (crashed live pre-fix)", async () => {
    const out = await audit(
      leaders("carries"),
      ctx("Who has the most rushing attempts without ever leading the league in rushing attempts?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("League-leadership");
  });

  it("refuses the season-threshold negation for a ratio stat (crashed live pre-fix)", async () => {
    const out = await audit(
      leaders("yards_per_carry"),
      ctx("Who has the most career yards per carry without a 1,500-yard season?"),
    );
    expect(out.status).toBe("invalid");
  });

  it("refuses a cross-stat bound when either half isn't a season-rollup column", async () => {
    const out = await audit(
      leaders("yards_per_carry"),
      ctx("Who has the most yards per carry with fewer than 1,000 career rushing yards?"),
    );
    expect(out.status).toBe("invalid");
  });

  it("refuses 'without scoring a touchdown' when the stat's TD side isn't mappable", async () => {
    const out = await audit(
      leaders("tackles"),
      ctx("Who has the most tackles without scoring a touchdown?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("scoring a touchdown");
  });

  it("refuses a compound 'without' whose second clause the spec never consumed (regression)", async () => {
    // The parser consumes the 1,500-yard clause (withoutSeasonAtLeast set),
    // but the playoff-game negation has no field — the catch-all must
    // refuse on the leftover "without", not sail through because one field
    // landed.
    const out = await audit(
      leaders("rushing_yards", { withoutSeasonAtLeast: 1500 }),
      ctx("Who has the most career rushing yards without a 1,500-yard season and without winning a playoff game?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("Without");
  });

  it("refuses when two supported negation fields combine (executor is first-branch-wins)", async () => {
    const out = await audit(
      leaders("rushing_yards", { withoutSeasonAtLeast: 1500, withoutLeagueLead: true }),
      ctx("Who has the most rushing yards without a 1,500-yard season without ever leading the league?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("pick one");
  });

  // ---- Review fixes: cross-family combos are parser-joint but the leaders()
  // executor is first-match-wins in a fixed branch order (firstN/minAgeYears/
  // beforeSeasonN, then gameResult/oneScore/oppWinningRecord/perOpponent,
  // then the negation fields) — any two fields from different branches
  // silently drop one, so the combination must refuse. ----

  it("refuses a negation field combined with an age window (repro: 'after turning 30 without a 1,500-yard season')", async () => {
    const out = await audit(
      leaders("rushing_yards", { withoutSeasonAtLeast: 1500, minAgeYears: 30 }),
      ctx("Most rushing yards after turning 30 without a 1,500-yard season?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("pick one");
  });

  it("refuses a negation field combined with a game-result filter", async () => {
    const out = await audit(
      leaders("total_tds", { withoutLeagueLead: true, gameResult: "L" }),
      ctx("Who has the most touchdowns in games his team lost without ever leading the league?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("pick one");
  });

  it("refuses a negation field combined with a per-opponent board", async () => {
    const out = await audit(
      leaders("rushing_yards", { crossStat: "rushing_tds", crossOp: "=", crossValue: 0, perOpponent: true }),
      ctx("Who has the most rushing yards against a single opponent without scoring a touchdown?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("pick one");
  });

  it("refuses a per-opponent board combined with an age window (repro: 'against a single opponent after turning 30')", async () => {
    const out = await audit(
      leaders("rushing_yards", { perOpponent: true, minAgeYears: 30 }),
      ctx("Most rushing yards against a single opponent after turning 30?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("single-opponent board");
  });

  it("refuses a per-opponent board combined with a first-N-games window", async () => {
    const out = await audit(
      leaders("total_tds", { perOpponent: true, firstN: 50 }),
      ctx("Who scored the most touchdowns against a single opponent through his first 50 games?"),
    );
    expect(out.status).toBe("invalid");
  });

  it("does NOT refuse a per-opponent board combined with a game-result filter — the executor genuinely composes both via gamePreds", async () => {
    const out = await audit(
      leaders("total_tds", { perOpponent: true, gameResult: "L" }),
      ctx("Who has scored the most touchdowns against a single opponent in games his team lost?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("does NOT refuse a per-opponent board combined with one-score games — the executor genuinely composes both via gamePreds", async () => {
    const out = await audit(
      leaders("total_tds", { perOpponent: true, oneScore: true }),
      ctx("Who has scored the most touchdowns against a single opponent in one-score games?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  // R2: the season-rollup negation branches never call gamePreds, so a
  // co-occurring game-window filter would be silently dropped from the SQL
  // while the narration implies it applied — refuse instead.

  it("refuses a negation combined with a question-named season (R2 repro: 'without a 1,500-yard season in 2019')", async () => {
    const out = await audit(
      leaders("rushing_yards", { withoutSeasonAtLeast: 1500, season: 2019 }),
      ctx("Who has the most rushing yards without a 1,500-yard season in 2019?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("career-wide only");
  });

  it("does NOT refuse a negation whose season could only be parser-defaulted (question names no year)", async () => {
    // The parser defaults bare leaderboards to the latest season — a
    // defaulted season must not turn every bare negation question into a
    // refusal, so the season clause is keyed on the question actually
    // naming a year (same idiom as the final-season rule).
    const out = await audit(
      leaders("rushing_yards", { withoutSeasonAtLeast: 1500, season: 2025 }),
      ctx("Who has the most career rushing yards without a 1,500-yard season?"),
    );
    expect(out.status).not.toBe("invalid");
  });

  it("refuses a negation combined with a venue filter (no year needed)", async () => {
    const out = await audit(
      leaders("rushing_yards", { withoutSeasonAtLeast: 1500, venue: "home" }),
      ctx("Who has the most rushing yards at home without a 1,500-yard season?"),
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("career-wide only");
  });

  it("still refuses awards-dependent 'without' negations even with an unrelated spec (q49, q50, q51, q98)", async () => {
    // Deliberately not implemented — MVP, playoff wins, conference
    // championships and Super Bowl wins aren't tracked per-season the way
    // the boards above need, so none of these ever set a without*/crossStat
    // field; the catch-all "without" rule (permanently unmet) is what keeps
    // them honest regardless of whatever spec the parser happened to build.
    for (const q of [
      "Who has the most touchdown passes without ever winning MVP?",
      "Who has the most career passing yards without winning a playoff game?",
      "Who has the most career touchdown passes without reaching a conference championship?",
      "Who accumulated the most playoff scrimmage yards without winning a Super Bowl?",
    ]) {
      const out = await audit(leaders("passing_yards"), ctx(q));
      expect(out.status, q).toBe("invalid");
    }
  });
});
