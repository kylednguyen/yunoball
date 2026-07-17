/** Ingestion pipeline tests against a scratch Postgres database, with the
 * nflverse provider stubbed to serve small fixture datasets shaped like the
 * real release files.
 *
 * Messy cases covered: relocated franchises (OAK->LV), duplicate roster rows,
 * rows without stable ids, playoff game_type normalization (SB->POST),
 * postponed games (null scores), stats for players missing from the dimension,
 * season-type filtering, dry runs, idempotent re-runs, schema drift.
 *
 * Requires the dev Postgres from docker-compose (localhost:5432); tests
 * create and drop their own scratch database.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { teamRow } from "../src/ingest/normalize.js";

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgresql://yunoball:yunoball@localhost:5432/yunoball";
const SCRATCH_DB = "yunoball_ts_test";

// ---- fixture rows, shaped like the release CSVs (all values strings) ---- //

const TEAMS_CSV = [
  { team_abbr: "KC", team_name: "Kansas City Chiefs", team_nick: "Chiefs", team_conf: "AFC", team_division: "AFC West" },
  { team_abbr: "LV", team_name: "Las Vegas Raiders", team_nick: "Raiders", team_conf: "AFC", team_division: "AFC West" },
  // Historical abbr for the same franchise — must NOT become its own row.
  { team_abbr: "OAK", team_name: "Oakland Raiders", team_nick: "Raiders", team_conf: "AFC", team_division: "AFC West" },
];

// Week 1: away team spelled with the HISTORICAL abbr; week 2 postponed; week
// 21 Super Bowl (game_type SB -> season_type POST).
const SCHED_CSV = [
  { game_id: "2023_01_OAK_KC", season: "2023", week: "1", game_type: "REG", gameday: "2023-09-10",
    home_team: "KC", away_team: "OAK", home_score: "30", away_score: "20",
    stadium: "Arrowhead", roof: "outdoors", surface: "grass" },
  { game_id: "2023_02_KC_LV", season: "2023", week: "2", game_type: "REG", gameday: "2023-09-17",
    home_team: "LV", away_team: "KC", home_score: "", away_score: "",
    stadium: "Allegiant", roof: "dome", surface: "grass" },
  { game_id: "2023_21_LV_KC", season: "2023", week: "21", game_type: "SB", gameday: "2024-02-11",
    home_team: "KC", away_team: "LV", home_score: "25", away_score: "22",
    stadium: "Allegiant", roof: "dome", surface: "grass" },
];

const ROSTER_CSV = [
  // Duplicate rows for the same player (two seasons) — latest must win in the
  // players dimension; the 2022 row also exercises the rosters season guard
  // (2022 isn't an ingested season in these tests).
  { gsis_id: "P_MAHOMES", season: "2022", team: "KC", full_name: "Patrick Mahomes", first_name: "Patrick",
    last_name: "Mahomes", position: "QB", birth_date: "1995-09-17", height: "74", weight: "225",
    college: "Texas Tech", jersey_number: "15", status: "ACT" },
  { gsis_id: "P_MAHOMES", season: "2023", team: "KC", full_name: "Patrick Mahomes", first_name: "Patrick",
    last_name: "Mahomes", position: "QB", birth_date: "1995-09-17", height: "74", weight: "227",
    college: "Texas Tech", jersey_number: "15", status: "ACT" },
  // Historical team abbr — must normalize to the current franchise (LV).
  { gsis_id: "P_ADAMS", season: "2023", team: "OAK", full_name: "Davante Adams", first_name: "Davante",
    last_name: "Adams", position: "WR", birth_date: "", height: "73", weight: "215",
    college: "Fresno St", jersey_number: "17", status: "ACT" },
  // No stable id — must be skipped (and logged), never keyed by name.
  { gsis_id: "", season: "2023", team: "KC", full_name: "Practice Squad Guy", first_name: "Practice",
    last_name: "Guy", position: "WR", birth_date: "", height: "", weight: "", college: "",
    jersey_number: "", status: "DEV" },
];

function wk(player_id: string, week: string, team: string, season_type: string, stats: Record<string, string> = {}) {
  return {
    player_id, season: "2023", week, team, season_type,
    completions: "0", attempts: "0", passing_yards: "0", passing_tds: "0",
    passing_interceptions: "0", sacks_suffered: "0", carries: "0",
    rushing_yards: "0", rushing_tds: "0", targets: "0", receptions: "0",
    receiving_yards: "0", receiving_tds: "0", fantasy_points_ppr: "0",
    sack_fumbles: "0", rushing_fumbles: "0", receiving_fumbles: "0",
    sack_fumbles_lost: "0", rushing_fumbles_lost: "0", receiving_fumbles_lost: "0",
    ...stats,
  };
}

const WEEKLY_CSV = [
  wk("P_MAHOMES", "1", "KC", "REG", { passing_yards: "305", passing_tds: "3" }),
  // AWAY-team player under a HISTORICAL abbr — must map to LV and resolve to
  // the same canonical game_id as the home player.
  wk("P_ADAMS", "1", "OAK", "REG", { receiving_yards: "96", receiving_tds: "1", receptions: "NA" }),
  // Playoff box score (weekly files carry season_type POST directly).
  wk("P_MAHOMES", "21", "KC", "POST", { passing_yards: "333" }),
  // Not on any roster — must be skipped, not violate the players FK.
  wk("P_GHOST", "1", "KC", "REG", { passing_yards: "99" }),
];

// Id crosswalk (players release): keyed on gsis_id. One row without a gsis
// id (skipped), one retired player outside the loaded seasons (kept — the
// crosswalk has no players FK), one player with no nflverse headshot (espn
// CDN fallback at runtime).
const PLAYER_IDS_CSV = [
  { gsis_id: "P_MAHOMES", esb_id: "ESB_M", pfr_id: "MahoPa00", pff_id: "11765",
    otc_id: "1889", espn_id: "3139477", headshot: "https://static.www.nfl.com/image/mahomes" },
  { gsis_id: "P_ADAMS", esb_id: "ESB_A", pfr_id: "AdamDa01", pff_id: "NA",
    otc_id: "", espn_id: "16800", headshot: "" },
  { gsis_id: "", esb_id: "ESB_GHOST", pfr_id: "", pff_id: "", otc_id: "", espn_id: "", headshot: "" },
  { gsis_id: "P_RETIRED", esb_id: "ESB_R", pfr_id: "RetiJo00", pff_id: "",
    otc_id: "", espn_id: "1428", headshot: "https://static.www.nfl.com/image/retired" },
];

function seasonRowFx(player_id: string, recent_team: string, stats: Record<string, string> = {}) {
  return {
    player_id, recent_team, games: "16", passing_yards: "0", passing_tds: "0",
    passing_interceptions: "0", rushing_yards: "0", rushing_tds: "0",
    receptions: "0", receiving_yards: "0", receiving_tds: "0", fantasy_points_ppr: "0",
    ...stats,
  };
}

const SEASON_REG_CSV = [
  seasonRowFx("P_MAHOMES", "KC", { passing_yards: "4183", fantasy_points_ppr: "350.0" }),
  seasonRowFx("P_ADAMS", "OAK", { receiving_yards: "1144", receptions: "103" }),
];
const SEASON_POST_CSV = [seasonRowFx("P_MAHOMES", "KC", { passing_yards: "333", games: "1" })];

// Play-by-play TD events, shaped like the pbp release columns the scoring
// step reads. Covers every td_kind classification and each home of the true
// TD distance (yards_gained vs return_yards vs fumble_recovery_1_yards).
function pbp(over: Record<string, string>) {
  return {
    game_id: "2023_01_OAK_KC", play_id: "1", season_type: "REG", touchdown: "1",
    td_player_id: "", td_team: "", posteam: "KC",
    yards_gained: "0", return_yards: "0", fumble_recovery_1_yards: "",
    pass_touchdown: "0", rush_touchdown: "0", return_touchdown: "0", interception: "0",
    qtr: "1", play_type: "run", desc: "", epa: "", success: "", cpoe: "", drive: "",
    passer_player_id: "", rusher_player_id: "", receiver_player_id: "",
    ...over,
  };
}

const PBP_CSV = [
  // Offensive scrimmage TDs: distance = yards_gained.
  pbp({ play_id: "10", td_player_id: "P_MAHOMES", td_team: "KC",
    rush_touchdown: "1", yards_gained: "1", desc: "P.Mahomes 1 yard run, TOUCHDOWN." }),
  pbp({ play_id: "20", td_player_id: "P_ADAMS", td_team: "OAK", posteam: "OAK",
    pass_touchdown: "1", play_type: "pass", yards_gained: "75",
    desc: "Pass deep to D.Adams for 75 yards, TOUCHDOWN." }),
  // Pick six: yards_gained is the offense's 0 — distance lives in return_yards.
  pbp({ play_id: "30", td_player_id: "P_MAHOMES", td_team: "KC", posteam: "OAK",
    return_touchdown: "1", interception: "1", play_type: "pass", return_yards: "45",
    desc: "Pass INTERCEPTED by P.Mahomes for 45 yards, TOUCHDOWN." }),
  // Defensive fumble return: return_yards is 0 too — fumble_recovery_1_yards has it.
  pbp({ play_id: "40", td_player_id: "P_ADAMS", td_team: "OAK",
    return_touchdown: "1", yards_gained: "-4", fumble_recovery_1_yards: "30",
    desc: "FUMBLES, RECOVERED by LV-D.Adams for 30 yards, TOUCHDOWN." }),
  // Kickoff return: a special-teams RETURN score, never a defensive TD.
  pbp({ play_id: "50", td_player_id: "P_ADAMS", td_team: "OAK", posteam: "OAK",
    return_touchdown: "1", play_type: "kickoff", return_yards: "99",
    desc: "D.Adams 99 yards, TOUCHDOWN." }),
  // Own-fumble recovery (offense keeps the ball): description matching would
  // call this FUMBLE + TOUCHDOWN = defensive — td_kind must say "other".
  pbp({ play_id: "60", td_player_id: "P_MAHOMES", td_team: "KC",
    yards_gained: "3", fumble_recovery_1_yards: "2",
    desc: "P.Mahomes FUMBLES, recovered by KC-P.Mahomes, TOUCHDOWN." }),
  // Scorer not in the players dimension — dropped loudly, no FK violation.
  pbp({ play_id: "70", td_player_id: "P_GHOST", td_team: "KC",
    rush_touchdown: "1", yards_gained: "8", desc: "Ghost TD." }),
];

vi.mock("../src/ingest/providers/nflverse.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/ingest/providers/nflverse.js")>();
  const byUrl = (url: string): Record<string, string>[] => {
    if (url.includes("teams_colors_logos")) return TEAMS_CSV;
    if (url.includes("schedules/games")) return SCHED_CSV;
    if (url.includes("players/players.csv")) return PLAYER_IDS_CSV;
    if (url.includes("roster_")) return ROSTER_CSV;
    if (url.includes("stats_player_week_")) return WEEKLY_CSV;
    if (url.includes("stats_player_reg_")) return SEASON_REG_CSV;
    if (url.includes("stats_player_post_")) return SEASON_POST_CSV;
    if (url.includes("pbp/play_by_play_")) return PBP_CSV;
    throw new Error(`no fixture for ${url}`);
  };
  return {
    ...original,
    allRows: async (url: string) => byUrl(url),
    rows: async function* (url: string) {
      yield* byUrl(url);
    },
  };
});

// Imported AFTER the mock so pipelines bind to the stubbed provider.
const { Ctx } = await import("../src/ingest/context.js");
const p = await import("../src/ingest/pipelines.js");
const { upsert } = await import("../src/ingest/upsert.js");

let pool: pg.Pool;

async function loadAll(ctx: InstanceType<typeof Ctx>) {
  return {
    teams: await p.loadTeams(ctx),
    seasons: await p.loadSeasons(ctx, [2023]),
    players: await p.loadPlayers(ctx, [2023]),
    player_ids: await p.loadPlayerIds(ctx),
    rosters: await p.loadRosters(ctx, [2023]),
    games: await p.loadGames(ctx, [2023]),
    player_game_stats: await p.loadPlayerGameStats(ctx, [2023]),
    player_season_stats: await p.loadPlayerSeasonStats(ctx, [2023]),
    team_game_stats: await p.loadTeamGameStats(ctx, [2023]),
  };
}

const all = async (sql: string) => (await pool.query(sql)).rows;

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: ADMIN_URL });
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  await admin.end();
  pool = new pg.Pool({
    connectionString: ADMIN_URL.replace(/\/[^/]+$/, `/${SCRATCH_DB}`),
  });
  const ddl = readFileSync(path.resolve(__dirname, "../src/db/schema.sql"), "utf-8");
  await pool.query(ddl);
});

beforeEach(async () => {
  await pool.query(
    "TRUNCATE scoring_plays, player_game_advanced, team_game_stats, player_season_stats, player_game_stats, games, rosters, player_id_map, players, teams, seasons CASCADE",
  );
});

afterAll(async () => {
  await pool.end();
});

describe("normalization", () => {
  it("folds relocated franchises forward everywhere", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    const teams = (await all("SELECT team_id FROM teams")).map((r) => r.team_id).sort();
    expect(teams).toEqual(["KC", "LV"]); // no phantom OAK franchise
    const g = await all("SELECT away_team FROM games WHERE game_id = '2023_01_OAK_KC'");
    expect(g[0].away_team).toBe("LV");
    const adams = await all("SELECT team_id FROM player_game_stats WHERE player_id = 'P_ADAMS'");
    expect(adams[0].team_id).toBe("LV");
    const sea = await all("SELECT team_id FROM player_season_stats WHERE player_id = 'P_ADAMS'");
    expect(sea[0].team_id).toBe("LV");
  });

  it("resolves the away player's game id from the schedule", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    const rows = await all(
      "SELECT player_id, game_id FROM player_game_stats WHERE game_id LIKE '2023_01%'",
    );
    const byPlayer = Object.fromEntries(rows.map((r) => [r.player_id, r.game_id]));
    expect(byPlayer.P_MAHOMES).toBe("2023_01_OAK_KC");
    expect(byPlayer.P_ADAMS).toBe("2023_01_OAK_KC"); // away side, historical abbr
  });

  it("collapses playoff rounds to POST", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    const sb = await all("SELECT season_type FROM games WHERE game_id = '2023_21_LV_KC'");
    expect(sb[0].season_type).toBe("POST");
  });

  it("keeps postponed games without fabricating results", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    const g = await all("SELECT home_score, away_score FROM games WHERE game_id = '2023_02_KC_LV'");
    expect(g[0]).toEqual({ home_score: null, away_score: null });
    const tgs = await all("SELECT * FROM team_game_stats WHERE game_id = '2023_02_KC_LV'");
    expect(tgs).toHaveLength(0);
  });
});

describe("messy rows", () => {
  it("dedupes duplicate roster rows, latest season wins", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    const rows = await all("SELECT weight_lbs FROM players WHERE player_id = 'P_MAHOMES'");
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_lbs).toBe(227); // 2023 row won over 2022
  });

  it("skips and logs rows without stable ids", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    const names = (await all("SELECT full_name FROM players")).map((r) => r.full_name);
    expect(names).not.toContain("Practice Squad Guy");
    expect(ctx.skipped.get("players: roster row without a stable gsis id")).toBe(1);
  });

  it("skips stats for players missing from the dimension", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    const ids = (await all("SELECT player_id FROM player_game_stats")).map((r) => r.player_id);
    expect(ids).not.toContain("P_GHOST");
    expect(ctx.skipped.get("player_game_stats: player not in players dimension")).toBe(1);
  });

  it("turns missing stat values into NULL, not crashes", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    const r = await all(
      "SELECT receptions, receiving_yards FROM player_game_stats WHERE player_id = 'P_ADAMS'",
    );
    expect(r[0].receptions).toBeNull();
    expect(r[0].receiving_yards).toBe(96);
  });

});

describe("id crosswalk", () => {
  it("keys the crosswalk on gsis id and syncs headshots onto players", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    const ids = (await all("SELECT player_id FROM player_id_map ORDER BY player_id")).map(
      (r) => r.player_id,
    );
    expect(ids).toEqual(["P_ADAMS", "P_MAHOMES", "P_RETIRED"]);
    expect(ctx.skipped.get("player_id_map: crosswalk row without a gsis id")).toBe(1);
    const mahomes = await all(
      "SELECT espn_id, headshot_url FROM players WHERE player_id = 'P_MAHOMES'",
    );
    expect(mahomes[0]).toEqual({
      espn_id: "3139477",
      headshot_url: "https://static.www.nfl.com/image/mahomes",
    });
    // No nflverse headshot -> null in the warehouse (runtime falls back to espn_id).
    const adams = await all(
      "SELECT espn_id, headshot_url FROM players WHERE player_id = 'P_ADAMS'",
    );
    expect(adams[0]).toEqual({ espn_id: "16800", headshot_url: null });
  });

  it("keeps crosswalk rows for players outside the loaded seasons (no FK)", async () => {
    await loadAll(new Ctx(pool));
    expect(await all("SELECT 1 FROM player_id_map WHERE player_id = 'P_RETIRED'")).toHaveLength(1);
    expect(await all("SELECT 1 FROM players WHERE player_id = 'P_RETIRED'")).toHaveLength(0);
  });
});

describe("historical rosters", () => {
  it("loads per-season rosters with franchise-normalized teams", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    const rows = await all(
      "SELECT player_id, season, team_id, jersey_number, status FROM rosters ORDER BY player_id",
    );
    expect(rows).toEqual([
      { player_id: "P_ADAMS", season: 2023, team_id: "LV", jersey_number: 17, status: "ACT" },
      { player_id: "P_MAHOMES", season: 2023, team_id: "KC", jersey_number: 15, status: "ACT" },
    ]);
    // The 2022 Mahomes row targets a season the run didn't ingest; the
    // no-gsis row can't join the players dimension. Both drop loudly.
    expect(ctx.skipped.get("rosters: season not ingested (run seasons first)")).toBe(1);
    expect(ctx.skipped.get("rosters: roster row without a stable gsis id")).toBe(1);
  });
});

describe("scoring plays (pbp distillation)", () => {
  it("stores the true TD distance and an exact td_kind classification", async () => {
    const ctx = new Ctx(pool);
    await loadAll(ctx);
    await p.loadScoringPlays(ctx, [2023]);
    const rows = await all(
      "SELECT play_id, player_id, yards, td_kind FROM scoring_plays ORDER BY play_id",
    );
    expect(rows).toEqual([
      { play_id: "2023_01_OAK_KC_10", player_id: "P_MAHOMES", yards: 1, td_kind: "rush" },
      { play_id: "2023_01_OAK_KC_20", player_id: "P_ADAMS", yards: 75, td_kind: "pass" },
      { play_id: "2023_01_OAK_KC_30", player_id: "P_MAHOMES", yards: 45, td_kind: "int_return" },
      { play_id: "2023_01_OAK_KC_40", player_id: "P_ADAMS", yards: 30, td_kind: "fumble_return" },
      { play_id: "2023_01_OAK_KC_50", player_id: "P_ADAMS", yards: 99, td_kind: "kick_return" },
      { play_id: "2023_01_OAK_KC_60", player_id: "P_MAHOMES", yards: 3, td_kind: "other" },
    ]);
    expect(ctx.skipped.get("scoring_plays: scorer not in players dimension")).toBe(1);
  });
});

describe("run mechanics", () => {
  it("season-type filter REG excludes playoff rows end to end", async () => {
    const ctx = new Ctx(pool, false, "REG");
    await loadAll(ctx);
    const stypes = (await all("SELECT DISTINCT season_type FROM games")).map((r) => r.season_type);
    expect(stypes).toEqual(["REG"]);
    const sea = (await all("SELECT DISTINCT season_type FROM player_season_stats")).map(
      (r) => r.season_type,
    );
    expect(sea).toEqual(["REG"]);
  });

  it("dry run validates and counts without writing", async () => {
    const ctx = new Ctx(pool, true);
    const counts = await loadAll(ctx);
    expect(counts.teams).toBe(2);
    expect(counts.games).toBe(3);
    expect(counts.player_game_stats).toBe(3); // ghost row still excluded
    for (const table of ["teams", "players", "games", "player_game_stats"]) {
      const n = await all(`SELECT COUNT(*)::int AS n FROM ${table}`);
      expect(n[0].n).toBe(0);
    }
    // Validation findings still surface in dry-run mode.
    expect(ctx.skipped.get("players: roster row without a stable gsis id")).toBe(1);
  });

  it("re-running is idempotent", async () => {
    const first = await loadAll(new Ctx(pool));
    const second = await loadAll(new Ctx(pool));
    expect(second).toEqual(first);
    const n = await all("SELECT COUNT(*)::int AS n FROM player_game_stats");
    expect(n[0].n).toBe(first.player_game_stats);
  });

  it("refuses rows with columns the warehouse doesn't know", async () => {
    const ctx = new Ctx(pool);
    await expect(
      upsert(ctx, "teams", [{ team_id: "KC", name: "x", nickname: null, conference: null, division: null, bogus_column: 1 }], ["team_id"], teamRow),
    ).rejects.toThrow(/bogus_column|Unrecognized/i);
  });

  it("fails loudly when an upstream identity column is renamed (schema drift)", () => {
    const sample = { player_id: "P", season: "2023", week: "1", team: "KC", season_type: "REG" };
    // A renamed/missing identity column corrupts every row → hard failure.
    const { player_id: _pid, ...missingId } = sample;
    expect(() =>
      p.checkColumns(missingId, "stats_player_week", ["player_id", "season"], []),
    ).toThrow(/schema drift|player_id/);
    // A missing STAT column only warns (the value becomes null/zero) → no throw.
    expect(() =>
      p.checkColumns(sample, "stats_player_week", ["player_id"], ["passing_yards"]),
    ).not.toThrow();
  });
});
