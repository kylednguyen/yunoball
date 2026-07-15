/** DB-free unit tests for the P0 ingestion worker:
 *   - the new zod row schemas + pure row-mappers (valid / invalid rows), using
 *     rows shaped exactly like the real nflverse release CSV headers;
 *   - the resumable-backfill planning (season floor clamping + resume skip-set).
 *
 * No Postgres required — mappers and planRuns are pure functions.
 */

import { describe, expect, it } from "vitest";
import {
  mapPlayerIds, playerIdsRow,
  mapTrade, tradeRow,
  mapInjury, injuryRow,
  mapDepthChart, depthChartRow,
  mapSnapCount, snapCountRow,
} from "../src/ingest/normalize.js";
import {
  CLEAN_FLOOR, DATASETS, SINGLE_SEASON,
  getDataset, planRuns, seasonsFor, stateKey, currentSeason,
} from "../src/worker/datasets.js";

// ---- fixtures: exact real nflverse headers ----

const PLAYER = {
  gsis_id: "00-0028830", display_name: "Isaako Aaitui", esb_id: "AAI622937",
  nfl_id: "", pfr_id: "AaitIs00", pff_id: "6998", otc_id: "2535",
  espn_id: "14856", smart_id: "32004141-4962-2937-61ff-017b1804dec6",
};

// trades.csv: one row per asset; a pick and a player.
const TRADE_PICK = {
  trade_id: "702", season: "2002", trade_date: "2002-03-08", gave: "MIA",
  received: "NO", pick_season: "2002", pick_round: "1", pick_number: "25",
  conditional: "0", pfr_id: "", pfr_name: "",
};
const TRADE_PLAYER = {
  trade_id: "701", season: "2002", trade_date: "2002-03-04", gave: "SD",
  received: "WAS", pick_season: "", pick_round: "", pick_number: "",
  conditional: "", pfr_id: "WuerDa00", pfr_name: "Danny Wuerffel",
};

const INJURY = {
  season: "2009", game_type: "REG", team: "ARI", week: "1", gsis_id: "00-0022084",
  position: "WR", full_name: "Anquan Boldin", first_name: "Anquan", last_name: "Boldin",
  report_primary_injury: "Hamstring", report_secondary_injury: "", report_status: "Questionable",
  practice_primary_injury: "Hamstring", practice_secondary_injury: "",
  practice_status: "Limited Participation in Practice", date_modified: "",
};

const DEPTH = {
  season: "2002", club_code: "MIN", week: "1", game_type: "REG", depth_team: "1",
  last_name: "Mixon", first_name: "Kenneth", football_name: "Kenny", formation: "Defense",
  gsis_id: "00-0011446", jersey_number: "79", position: "DE", elias_id: "MIX565722",
  depth_position: "DE", full_name: "Kenny Mixon",
};

const SNAP = {
  game_id: "2023_01_ARI_WAS", pfr_game_id: "202309100was", season: "2023",
  game_type: "REG", week: "1", player: "Saahdiq Charles", pfr_player_id: "CharSa00",
  position: "G", team: "WAS", opponent: "ARI", offense_snaps: "71", offense_pct: "1",
  defense_snaps: "0", defense_pct: "0", st_snaps: "4", st_pct: "0.14",
};

describe("player_ids mapper", () => {
  it("maps the players master row and validates", () => {
    const row = mapPlayerIds(PLAYER);
    expect(playerIdsRow.safeParse(row).success).toBe(true);
    expect(row.player_id).toBe("00-0028830");
    expect(row.pfr_id).toBe("AaitIs00");
    expect(row.nfl_id).toBeNull(); // "" -> null
  });
  it("rejects a master row without a gsis id", () => {
    const row = mapPlayerIds({ ...PLAYER, gsis_id: "" });
    expect(playerIdsRow.safeParse(row).success).toBe(false);
  });
});

describe("trades mapper", () => {
  it("maps a pick asset, normalizes teams, parses conditional", () => {
    const row = mapTrade(TRADE_PICK);
    expect(tradeRow.safeParse(row).success).toBe(true);
    expect(row.pick_number).toBe(25);
    expect(row.conditional).toBe(false);
    expect(row.player_id).toBeNull(); // a pick, no player
    expect(row.pfr_id).toBeNull();
  });
  it("resolves player_id from pfr_id via the crosswalk and folds relocated teams", () => {
    const row = mapTrade(TRADE_PLAYER, new Map([["WuerDa00", "00-0005106"]]));
    expect(tradeRow.safeParse(row).success).toBe(true);
    expect(row.gave).toBe("LAC"); // SD -> LAC
    expect(row.player_id).toBe("00-0005106");
    expect(row.pfr_id).toBe("WuerDa00");
    expect(row.conditional).toBeNull(); // "" -> null
  });
  it("produces a deterministic, unique asset_id per asset", () => {
    expect(mapTrade(TRADE_PICK).asset_id).toBe(mapTrade(TRADE_PICK).asset_id);
    expect(mapTrade(TRADE_PICK).asset_id).not.toBe(mapTrade(TRADE_PLAYER).asset_id);
  });
});

describe("injuries mapper", () => {
  it("maps a REG injury report and validates", () => {
    const row = mapInjury(INJURY);
    expect(injuryRow.safeParse(row).success).toBe(true);
    expect(row.player_id).toBe("00-0022084");
    expect(row.report_status).toBe("Questionable");
    expect(row.report_secondary_injury).toBeNull();
    expect(row.date_modified).toBeNull();
  });
  it("normalizes a preseason report to an invalid game_type so the pipeline drops it", () => {
    const row = mapInjury({ ...INJURY, game_type: "PRE" });
    expect(row.game_type).toBe("PRE");
    expect(injuryRow.safeParse(row).success).toBe(false); // enum is REG|POST only
  });
});

describe("depth_charts mapper", () => {
  it("maps a depth chart row (club_code -> team) and validates", () => {
    const row = mapDepthChart(DEPTH);
    expect(depthChartRow.safeParse(row).success).toBe(true);
    expect(row.team).toBe("MIN");
    expect(row.depth_team).toBe(1);
    expect(row.position).toBe("DE");
  });
  it("rejects a row without a position (position is part of the key)", () => {
    const row = mapDepthChart({ ...DEPTH, position: "" });
    expect(depthChartRow.safeParse(row).success).toBe(false);
  });
});

describe("snap_counts mapper", () => {
  it("maps snaps, keeps pct as fractions, resolves gsis via crosswalk", () => {
    const row = mapSnapCount(SNAP, new Map([["CharSa00", "00-0035657"]]));
    expect(snapCountRow.safeParse(row).success).toBe(true);
    expect(row.pfr_player_id).toBe("CharSa00");
    expect(row.game_id).toBe("2023_01_ARI_WAS");
    expect(row.player_id).toBe("00-0035657");
    expect(row.st_pct).toBeCloseTo(0.14);
    expect(row.offense_snaps).toBe(71);
  });
  it("leaves player_id null when the pfr id is not in the crosswalk", () => {
    const row = mapSnapCount(SNAP);
    expect(row.player_id).toBeNull();
    expect(snapCountRow.safeParse(row).success).toBe(true); // player_id nullable
  });
});

describe("season resolution + floors", () => {
  it("clamps a per-season dataset to its floor", () => {
    const injuries = getDataset("injuries")!;
    expect(seasonsFor(injuries, 1999, 2011)).toEqual([2009, 2010, 2011]);
  });
  it("returns [] for single-file datasets and for ranges below the floor", () => {
    expect(seasonsFor(getDataset("trades")!, 1999, 2020)).toEqual([]); // single-file
    expect(seasonsFor(getDataset("snap_counts")!, 1999, 2005)).toEqual([]); // below floor 2012
  });
  it("current season rolls over in September", () => {
    expect(currentSeason(new Date("2026-08-01"))).toBe(2025);
    expect(currentSeason(new Date("2026-09-01"))).toBe(2026);
  });
});

describe("resume skip-logic (planRuns)", () => {
  const two = DATASETS.filter((d) => d.name === "trades" || d.name === "injuries");

  it("plans a single-file dataset once (null season) and a per-season dataset per year", () => {
    const plan = planRuns(two, 2009, 2010);
    expect(plan).toEqual([
      { dataset: "trades", season: null },
      { dataset: "injuries", season: 2009 },
      { dataset: "injuries", season: 2010 },
    ]);
  });

  it("skips (dataset, season) pairs already in source_state", () => {
    const done = new Set([stateKey("trades", null), stateKey("injuries", 2009)]);
    const plan = planRuns(two, 2009, 2010, done);
    expect(plan).toEqual([{ dataset: "injuries", season: 2010 }]);
  });

  it("--force re-runs everything regardless of source_state", () => {
    const done = new Set([stateKey("trades", null), stateKey("injuries", 2009)]);
    const plan = planRuns(two, 2009, 2010, done, true);
    expect(plan).toHaveLength(3);
  });

  it("single-file datasets checkpoint under the -1 sentinel key", () => {
    expect(stateKey("trades", null)).toBe(`trades|${SINGLE_SEASON}`);
    expect(stateKey("injuries", 2010)).toBe("injuries|2010");
  });

  it("uses the clean floor as the default lower bound", () => {
    const plan = planRuns(DATASETS.filter((d) => d.name === "games"), CLEAN_FLOOR, CLEAN_FLOOR);
    expect(plan).toEqual([{ dataset: "games", season: CLEAN_FLOOR }]);
  });
});
