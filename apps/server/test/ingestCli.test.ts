/** Ingest CLI argument handling: which seasons a run covers, and the guards
 * that still reject nonsense. DB-free — nothing here runs a pipeline.
 *
 * The case that matters most is the bare run: the scheduled weekly workflow
 * invokes `pnpm ingest:nfl` with no season selector, so a bare run must mean
 * exactly the current season — not an error, and not the whole 1999– archive.
 */

import { describe, expect, it } from "vitest";
import { currentSeason, main, selectSeasons } from "../src/ingest/cli.js";

// Local-time construction on purpose: the rule reads local months, so a
// UTC-string date would make these assertions depend on the runner's TZ.
const day = (year: number, month: number, date: number) => new Date(year, month - 1, date);

describe("current season", () => {
  it("rolls forward in September, and holds through the playoffs", () => {
    expect(currentSeason(day(2025, 9, 1))).toBe(2025);
    expect(currentSeason(day(2025, 8, 31))).toBe(2024); // preseason: 2024 is the season with data
    expect(currentSeason(day(2026, 1, 15))).toBe(2025); // January = the 2025 postseason
  });
});

describe("season selection", () => {
  it("defaults a bare run to the current season only", () => {
    expect(selectSeasons({}, day(2026, 2, 3))).toEqual([2025]);
    expect(selectSeasons({ years: [] }, day(2025, 10, 7))).toEqual([2025]);
  });

  it("dedupes and sorts explicit seasons", () => {
    expect(selectSeasons({ years: [2024, 2022, 2024] }, day(2025, 10, 7))).toEqual([2022, 2024]);
  });

  it("--all spans 1999 through the current season", () => {
    const years = selectSeasons({ all: true, years: [2024] }, day(2025, 10, 7));
    expect(years[0]).toBe(1999);
    expect(years.at(-1)).toBe(2025);
    expect(years).toHaveLength(2025 - 1999 + 1);
  });
});

describe("argument validation", () => {
  it("refuses seasons that aren't integers", async () => {
    await expect(main(["--season", "twenty-four"])).resolves.toBe(2);
  });

  it("refuses an unknown season type and an unknown pipeline", async () => {
    await expect(main(["--season", "2024", "--season-type", "PRE"])).resolves.toBe(2);
    await expect(main(["--season", "2024", "--only", "touchdowns"])).resolves.toBe(2);
  });
});
