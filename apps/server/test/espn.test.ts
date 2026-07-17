/** headshotUrl() resolution from the warehouse-backed map: nflverse
 * headshot_url wins, espn_id builds the ESPN CDN fallback, unknown players
 * stay null (initials avatar). DB-free — the pool is mocked. */

import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/pool.js", () => ({
  q: vi.fn(async () => [
    { player_id: "P_NFLVERSE", espn_id: "111", headshot_url: "https://static.www.nfl.com/image/x" },
    { player_id: "P_ESPN_ONLY", espn_id: "2330", headshot_url: null },
  ]),
}));

const { headshotUrl, loadHeadshots } = await import("../src/lib/espn.js");

describe("headshots", () => {
  it("prefers the nflverse url, falls back to the espn cdn, else null", async () => {
    expect(headshotUrl("P_NFLVERSE")).toBeNull(); // nothing loaded yet
    await loadHeadshots();
    expect(headshotUrl("P_NFLVERSE")).toBe("https://static.www.nfl.com/image/x");
    expect(headshotUrl("P_ESPN_ONLY")).toBe(
      "https://a.espncdn.com/i/headshots/nfl/players/full/2330.png",
    );
    expect(headshotUrl("P_UNKNOWN")).toBeNull();
  });
});
