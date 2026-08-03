/** Unit tests for the fact miner — phrasing rules, the coverage-floor guard,
 * scoring, and the shape of every registered probe's SQL. No database
 * required: each probe's SQL is built and inspected, not executed.
 *
 * The tests that matter most here are the coverage ones. A fact that reaches
 * further back than the warehouse can see is the specific way this feature
 * would ship a wrong number, so it is pinned from three directions: the phrase
 * builder, the post-hoc headline scan, and each probe's rendered output.
 */

import { describe, expect, it } from "vitest";
import { Params } from "../src/engine/executors/shared.js";
import { STATS } from "../src/engine/spec.js";
import {
  assertNoUnsupportedYear, ordinal, sinceClause, subjectPhrase, whenPhrase,
} from "../src/facts/claim.js";
import { claimFrom, coverageFloor, factId } from "../src/facts/mine.js";
import { PROBES, probeById } from "../src/facts/registry.js";
import { dedupe, dedupeKey, roundness } from "../src/facts/score.js";
import { TEAM_STATS } from "../src/facts/probes/teamGame.js";
import type { Claim, FactCandidate, OccurrenceRow, SourceDataset } from "../src/facts/types.js";

const occurrence = (over: Partial<OccurrenceRow> = {}): OccurrenceRow => ({
  subject_id: "P1",
  subject_name: "Test Player",
  season: 2025,
  week: 7,
  value: 214,
  season_type: "REG",
  opponent: "KC",
  ...over,
});

const claim = (over: Partial<Claim> = {}): Claim => ({
  population: 4,
  priorSeason: 2018,
  coverageFloor: 1999,
  coHolders: [],
  ...over,
});

describe("phrasing", () => {
  it("spells small ordinals and uses digits past ten", () => {
    expect(ordinal(1)).toBe("first");
    expect(ordinal(4)).toBe("fourth");
    expect(ordinal(10)).toBe("tenth");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(112)).toBe("112th");
    expect(ordinal(113)).toBe("113th");
  });

  it("names co-holders instead of crowning whichever row sorted first", () => {
    const subject = occurrence({ subject_name: "Josh Allen" });
    const withCo = claim({
      coHolders: [occurrence({ subject_name: "Lamar Jackson", subject_id: "P2" })],
    });
    expect(subjectPhrase(subject, withCo)).toBe("Josh Allen and Lamar Jackson");

    const three = claim({
      coHolders: [
        occurrence({ subject_name: "Lamar Jackson", subject_id: "P2" }),
        occurrence({ subject_name: "Jayden Daniels", subject_id: "P3" }),
      ],
    });
    expect(subjectPhrase(subject, three)).toBe("Josh Allen, Lamar Jackson and Jayden Daniels");
  });

  it("labels weeks, playoffs and season-grain facts differently", () => {
    expect(whenPhrase(2025, 7, "REG")).toBe("Week 7 of 2025");
    expect(whenPhrase(2025, 21, "POST")).toBe("the 2025 playoffs");
    expect(whenPhrase(2025, null, "REG")).toBe("2025");
  });
});

describe("coverage floor", () => {
  it("cites the prior occurrence when it is inside the window", () => {
    expect(sinceClause(claim({ priorSeason: 2018, coverageFloor: 1999 }))).toBe("since 2018");
  });

  // The load-bearing case: with no prior occurrence on record, the true
  // statement is about OUR RECORD, not about NFL history.
  it("degrades to the coverage floor when nothing preceded it", () => {
    expect(sinceClause(claim({ priorSeason: null, coverageFloor: 1999 }))).toBe(
      "since 1999, the earliest season on record here",
    );
  });

  it("degrades when the prior occurrence IS the floor — we cannot see past it", () => {
    expect(sinceClause(claim({ priorSeason: 1999, coverageFloor: 1999 }))).toBe(
      "since 1999, the earliest season on record here",
    );
  });

  it("refuses a headline naming a season the probe could not have seen", () => {
    expect(() =>
      assertNoUnsupportedYear("First to do this since 1972.", 1999),
    ).toThrow(/claims 1972 but the probe's coverage floor is 1999/);
  });

  it("allows years inside the window", () => {
    expect(() => assertNoUnsupportedYear("First since 2007, back in 2007.", 1999)).not.toThrow();
  });

  // A probe reading a dataset that starts late may not claim the earlier one's
  // reach, so the floor is the LATEST of its sources.
  it("takes a probe's floor from its most recently-starting source", () => {
    const floors = {
      player_game_stats: 1999,
      player_season_stats: 1999,
      team_game_stats: 2012,
      scoring_plays: 1999,
    } as Record<SourceDataset, number>;
    expect(coverageFloor({ sources: ["player_game_stats"] } as never, floors)).toBe(1999);
    expect(
      coverageFloor({ sources: ["player_game_stats", "team_game_stats"] } as never, floors),
    ).toBe(2012);
  });

  it("gives an empty dataset an unreachable floor so no claim is made", () => {
    const floors = {
      player_game_stats: Number.MAX_SAFE_INTEGER,
    } as Record<SourceDataset, number>;
    expect(coverageFloor({ sources: ["player_game_stats"] } as never, floors)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

describe("claim derivation", () => {
  it("treats the newest row as the subject and counts the rest", () => {
    const rows = [
      occurrence({ season: 2025, week: 7 }),
      occurrence({ season: 2021, week: 3, subject_id: "P2" }),
      occurrence({ season: 2014, week: 9, subject_id: "P3" }),
    ];
    const c = claimFrom(rows, 1999)!;
    expect(c.population).toBe(3);
    expect(c.priorSeason).toBe(2021);
    expect(c.coHolders).toEqual([]);
  });

  it("collects same-week co-holders and skips them when finding the prior", () => {
    const rows = [
      occurrence({ season: 2025, week: 7, subject_id: "P1" }),
      occurrence({ season: 2025, week: 7, subject_id: "P2" }),
      occurrence({ season: 2016, week: 2, subject_id: "P3" }),
    ];
    const c = claimFrom(rows, 1999)!;
    expect(c.coHolders).toHaveLength(1);
    expect(c.priorSeason).toBe(2016);
  });

  it("reports no prior season when the subject is the only occurrence", () => {
    const c = claimFrom([occurrence()], 1999)!;
    expect(c.population).toBe(1);
    expect(c.priorSeason).toBeNull();
  });

  it("produces no claim from an empty list", () => {
    expect(claimFrom([], 1999)).toBeNull();
  });

  it("hashes a stable, re-mineable id", () => {
    const a = factId("game_threshold", "rush200", "P1", 2025, 7);
    expect(a).toBe(factId("game_threshold", "rush200", "P1", 2025, 7));
    expect(a).not.toBe(factId("game_threshold", "rush200", "P1", 2025, 8));
    expect(a).not.toBe(factId("game_threshold", "rush250", "P1", 2025, 7));
  });
});

describe("scoring", () => {
  it("rates milestone thresholds above arbitrary ones", () => {
    expect(roundness(200)).toBe(1);
    expect(roundness(150)).toBe(0.6);
    expect(roundness(40)).toBe(0.3);
    expect(roundness(217)).toBe(0);
  });

  it("collapses same-player same-metric-family facts to the best one", () => {
    const base = {
      subject_id: "P1", metric: "passing_yards", season: 2025, week: 7,
    } as Pick<FactCandidate, "subject_id" | "metric" | "season" | "week">;
    expect(dedupeKey(base)).toBe(dedupeKey({ ...base, metric: "passing_tds" }));
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, metric: "rushing_yards" }));

    const cands = [
      { ...base, surprise: 3, fact_id: "a" },
      { ...base, metric: "passing_tds", surprise: 9, fact_id: "b" },
      { ...base, subject_id: "P2", surprise: 1, fact_id: "c" },
    ] as FactCandidate[];
    const kept = dedupe(cands);
    expect(kept.map((c) => c.fact_id)).toEqual(["b", "c"]);
  });
});

describe("the probe registry", () => {
  it("has unique probe ids and unique variant keys within each probe", () => {
    const ids = PROBES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const probe of PROBES) {
      const keys = probe.variants.map((v) => v.key);
      expect(new Set(keys).size, `${probe.id} variant keys`).toBe(keys.length);
    }
  });

  it("only names stats the engine knows (or a team probe's own allowlist)", () => {
    for (const probe of PROBES) {
      const team = probe.sources.includes("team_game_stats");
      for (const v of probe.variants) {
        for (const stat of [v.stat, v.stat2].filter(Boolean) as string[]) {
          const known = team ? stat in TEAM_STATS : stat in STATS;
          expect(known, `${probe.id}/${v.key}: ${stat}`).toBe(true);
        }
      }
    }
  });

  // Thresholds are what a probe could most easily be tuned with. Requiring a
  // round number keeps "the only player with 217+ yards" out of the product.
  // Counting stats (touchdowns, sacks, interceptions) are small enough that
  // every value is one a fan counts in; yardage and larger totals have to land
  // on a five. Either way the threshold is a number chosen before looking at
  // the data, not after.
  it("uses round thresholds only — never a number fitted to the data", () => {
    for (const probe of PROBES) {
      for (const v of probe.variants) {
        expect(v.threshold % 5 === 0 || v.threshold <= 10, `${probe.id}/${v.key}`).toBe(true);
      }
    }
  });

  it("binds every threshold as a parameter instead of interpolating it", () => {
    for (const probe of PROBES) {
      for (const v of probe.variants) {
        const p = new Params();
        const sql = probe.sql(v, p);
        expect(p.values, `${probe.id}/${v.key} binds values`).toContain(v.threshold);
        // The literal must not appear in the SQL text outside a $n placeholder.
        // Digits legitimately appear inside identifiers (fg_made_50_plus) and
        // array subscripts (ARRAY_AGG(...)[1]), so exclude those contexts and
        // match only a standalone numeric token.
        const bare = new RegExp(`(?<![\\w$.[])${v.threshold}(?![\\w\\]])`);
        expect(bare.test(sql), `${probe.id}/${v.key} interpolates ${v.threshold}`).toBe(false);
      }
    }
  });

  it("fetches one row past the cap so 'rare' is distinguishable from 'capped'", () => {
    for (const probe of PROBES) {
      const p = new Params();
      probe.sql(probe.variants[0]!, p);
      expect(p.values, probe.id).toContain(probe.maxPopulation + 1);
    }
  });

  it("renders a headline for every variant without breaching the floor", () => {
    for (const probe of PROBES) {
      for (const v of probe.variants) {
        const subject = occurrence({ value: v.threshold + 12, value2: (v.threshold2 ?? 0) + 3 });
        for (const c of [claim(), claim({ priorSeason: null, population: 1 })]) {
          const headline = probe.headline(subject, c, v);
          expect(headline.length, `${probe.id}/${v.key}`).toBeGreaterThan(20);
          expect(headline.endsWith("."), `${probe.id}/${v.key} ends in a period`).toBe(true);
          expect(headline).not.toMatch(/undefined|NaN|\[object/);
          expect(() => assertNoUnsupportedYear(headline, c.coverageFloor)).not.toThrow();
        }
      }
    }
  });

  it("looks probes up by id", () => {
    expect(probeById("game_threshold")?.family).toBe("threshold");
    expect(probeById("nope")).toBeUndefined();
  });
});

describe("probe SQL shape", () => {
  it("scopes every probe to a season type and orders newest first", () => {
    for (const probe of PROBES) {
      const p = new Params();
      const sql = probe.sql(probe.variants[0]!, p);
      expect(sql, probe.id).toMatch(/season_type/);
      expect(sql, probe.id).toMatch(/ORDER BY[^;]*DESC/);
      expect(sql, probe.id).toMatch(/LIMIT \$\d+/);
    }
  });

  it("selects the columns the miner reads off every row", () => {
    for (const probe of PROBES) {
      const p = new Params();
      const sql = probe.sql(probe.variants[0]!, p);
      for (const col of ["subject_id", "subject_name", "season", "week", "value"]) {
        expect(sql, `${probe.id} selects ${col}`).toContain(col);
      }
    }
  });
});
