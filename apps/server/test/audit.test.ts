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
      { ...base, intent: "game_result", season: 2023, round: "SB", playerId: null },
      ctx("who won the 2024 super bowl"),
    );
    expect(out.status).toBe("validated_with_warnings");
    expect(out.warnings.join(" ")).toContain("Super Bowl LVIII");
    expect(out.warnings.join(" ")).toContain("2023 season");
    expect(out.confidence.season).toBeLessThan(1);
  });

  it("validates a clean spec with full confidence", async () => {
    const out = await audit(
      { ...base, intent: "leaders", season: 2024 },
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
