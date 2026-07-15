/** Normalization rules + row validation (zod) for the warehouse.
 *
 *  - Stable ids everywhere: players by gsis id, games by nflverse game_id,
 *    teams by current-franchise abbreviation. Names are display data only.
 *  - Relocated franchises map forward (OAK->LV, SD->LAC, STL/LA->LAR,
 *    JAC->JAX) so a career spans relocations under one team id.
 *  - season_type is REG | POST — playoff rounds (WC/DIV/CON/SB) collapse to
 *    POST, matching what the query layer filters on.
 */

import { z } from "zod";

/** Historical abbreviation -> current franchise. The second block covers
 * PFR-style codes used by the nflverse draft dataset (KAN, GNB, ...). */
export const TEAM_MAP: Record<string, string> = {
  OAK: "LV",
  SD: "LAC",
  STL: "LAR",
  LA: "LAR",
  JAC: "JAX",
  GNB: "GB", KAN: "KC", LVR: "LV", NOR: "NO", NWE: "NE",
  PHO: "ARI", RAI: "LV", RAM: "LAR", SDG: "LAC", SFO: "SF", TAM: "TB",
};

/** Raw nflverse game/season types -> the two the platform splits on. */
export const SEASON_TYPE: Record<string, string> = {
  REG: "REG",
  WC: "POST",
  DIV: "POST",
  CON: "POST",
  SB: "POST",
  POST: "POST",
  PRE: "PRE",
};

export function team(abbr: string): string {
  return TEAM_MAP[abbr] ?? abbr;
}

// ---- CSV cell coercion ("" and "NA" mean missing) ----

const MISSING = new Set(["", "NA", "NULL", undefined]);

export function str(v: string | undefined): string | null {
  return MISSING.has(v) ? null : v!;
}

export function int(v: string | undefined): number | null {
  if (MISSING.has(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function float(v: string | undefined): number | null {
  if (MISSING.has(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- Row schemas: validated immediately before upsert ----
// Column sets mirror db/schema.sql; the upsert only ever writes keys that
// exist in these schemas, so schema drift fails loudly instead of silently.

const id = z.string().min(1);

export const teamRow = z.strictObject({
  team_id: id,
  name: z.string().min(1),
  nickname: z.string().nullable(),
  conference: z.string().nullable(),
  division: z.string().nullable(),
  color: z.string().nullable(),
  color2: z.string().nullable(),
});

export const seasonRow = z.strictObject({ season: z.number().int() });

export const playerRow = z.strictObject({
  player_id: id,
  full_name: z.string().min(1),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  position: z.string().nullable(),
  birth_date: z.string().nullable(),
  height_inches: z.number().nullable(),
  weight_lbs: z.number().nullable(),
  college: z.string().nullable(),
  jersey_number: z.number().nullable(),
});

export const gameRow = z.strictObject({
  game_id: id,
  season: z.number().int(),
  week: z.number().int(),
  season_type: z.enum(["REG", "POST", "PRE"]),
  game_date: z.string().nullable(),
  home_team: id,
  away_team: id,
  home_score: z.number().nullable(),
  away_score: z.number().nullable(),
  stadium: z.string().nullable(),
  roof: z.string().nullable(),
  surface: z.string().nullable(),
  weekday: z.string().nullable(),
  gametime: z.string().nullable(),
  temp: z.number().nullable(),
  wind: z.number().nullable(),
  home_coach: z.string().nullable(),
  away_coach: z.string().nullable(),
});

export const playerGameStatsRow = z.strictObject({
  player_id: id,
  game_id: id,
  team_id: id,
  completions: z.number().nullable(),
  attempts: z.number().nullable(),
  passing_yards: z.number().nullable(),
  passing_tds: z.number().nullable(),
  interceptions: z.number().nullable(),
  sacks: z.number().nullable(),
  carries: z.number().nullable(),
  rushing_yards: z.number().nullable(),
  rushing_tds: z.number().nullable(),
  targets: z.number().nullable(),
  receptions: z.number().nullable(),
  receiving_yards: z.number().nullable(),
  receiving_tds: z.number().nullable(),
  fumbles: z.number().nullable(),
  fumbles_lost: z.number().nullable(),
  fantasy_points_ppr: z.number().nullable(),
  sack_yards: z.number().nullable(),
  tackles: z.number().nullable(),
  def_sacks: z.number().nullable(),
  def_interceptions: z.number().nullable(),
  forced_fumbles: z.number().nullable(),
  passes_defended: z.number().nullable(),
  passing_air_yards: z.number().nullable(),
  receiving_air_yards: z.number().nullable(),
});

export const playerSeasonStatsRow = z.strictObject({
  player_id: id,
  season: z.number().int(),
  season_type: z.enum(["REG", "POST"]),
  team_id: z.string().nullable(),
  games_played: z.number().nullable(),
  passing_yards: z.number().nullable(),
  passing_tds: z.number().nullable(),
  interceptions: z.number().nullable(),
  rushing_yards: z.number().nullable(),
  rushing_tds: z.number().nullable(),
  receptions: z.number().nullable(),
  receiving_yards: z.number().nullable(),
  receiving_tds: z.number().nullable(),
  fantasy_points_ppr: z.number().nullable(),
  completions: z.number().nullable(),
  attempts: z.number().nullable(),
  sacks: z.number().nullable(),
  sack_yards: z.number().nullable(),
  fumbles: z.number().nullable(),
  fumbles_lost: z.number().nullable(),
  tackles: z.number().nullable(),
  def_sacks: z.number().nullable(),
  def_interceptions: z.number().nullable(),
  forced_fumbles: z.number().nullable(),
  passes_defended: z.number().nullable(),
});

export const teamGameStatsRow = z.strictObject({
  team_id: id,
  game_id: id,
  is_home: z.boolean(),
  points_for: z.number(),
  points_against: z.number(),
  result: z.enum(["W", "L", "T"]),
});

export const draftPickRow = z.strictObject({
  season: z.number().int(),
  round: z.number().int().min(1),
  pick: z.number().int().min(1), // overall selection number
  team_id: z.string().min(1),
  player_id: z.string().nullable(),
  player_name: z.string().min(1),
  position: z.string().nullable(),
  college: z.string().nullable(),
});

export const scoringPlayRow = z.strictObject({
  play_id: id,
  game_id: id,
  player_id: id,
  team_id: z.string().nullable(),
  qtr: z.number().nullable(),
  play_type: z.string().nullable(),
  description: z.string().nullable(),
  yards: z.number().nullable(),
});

export const playerGameAdvancedRow = z.strictObject({
  player_id: id,
  game_id: id,
  team_id: z.string().nullable(),
  pass_plays: z.number().nullable(),
  pass_epa: z.number().nullable(),
  pass_success: z.number().nullable(),
  cpoe_sum: z.number().nullable(),
  cpoe_n: z.number().nullable(),
  rush_plays: z.number().nullable(),
  rush_epa: z.number().nullable(),
  rush_success: z.number().nullable(),
  recv_plays: z.number().nullable(),
  recv_epa: z.number().nullable(),
  recv_success: z.number().nullable(),
});

// ===========================================================================
// P0 datasets: cross-source ID crosswalk + trades / injuries / depth charts /
// snap counts. Each has a zod row schema (mirrors db/schema.sql) and a pure
// row-mapper (nflverse CSV row -> warehouse row) so the mappers are unit
// testable without a database. Column names below are the REAL nflverse
// release headers (confirmed against the live CSVs).
// ===========================================================================

/** A raw CSV row before coercion: every cell is a string (or absent). */
type Raw = Record<string, string | undefined>;

/** Optional pfr_id -> gsis crosswalk, built from the player_ids table, used to
 * resolve datasets that key players by PFR id (trades, snap counts) onto the
 * warehouse's gsis player_id. Empty map => player_id stays null (nullable). */
export type GsisByPfr = Map<string, string>;

// ---- player_ids: the nflverse players master carries every external id ----
// players.csv header (real): gsis_id, display_name, ..., esb_id, nfl_id,
// pfr_id, pff_id, otc_id, espn_id, smart_id, ... (NO sportradar_id column).

export const playerIdsRow = z.strictObject({
  player_id: id, // gsis
  esb_id: z.string().nullable(),
  nfl_id: z.string().nullable(),
  pfr_id: z.string().nullable(),
  pff_id: z.string().nullable(),
  otc_id: z.string().nullable(),
  espn_id: z.string().nullable(),
  smart_id: z.string().nullable(),
});

export function mapPlayerIds(r: Raw): z.infer<typeof playerIdsRow> {
  return {
    player_id: r.gsis_id ?? "",
    esb_id: str(r.esb_id),
    nfl_id: str(r.nfl_id),
    pfr_id: str(r.pfr_id),
    pff_id: str(r.pff_id),
    otc_id: str(r.otc_id),
    espn_id: str(r.espn_id),
    smart_id: str(r.smart_id),
  };
}

// ---- trades ----
// trades.csv header (real): trade_id, season, trade_date, gave, received,
// pick_season, pick_round, pick_number, conditional, pfr_id, pfr_name.
// One row per ASSET moved; a trade_id groups the rows. The source has no
// natural per-row key, so asset_id is a deterministic composite surrogate.

export const tradeRow = z.strictObject({
  asset_id: id,
  trade_id: z.number().int(),
  season: z.number().int().nullable(),
  trade_date: z.string().nullable(),
  gave: z.string().nullable(),
  received: z.string().nullable(),
  pick_season: z.number().int().nullable(),
  pick_round: z.number().int().nullable(),
  pick_number: z.number().int().nullable(),
  conditional: z.boolean().nullable(),
  player_id: z.string().nullable(), // gsis, resolved from pfr_id when known
  pfr_id: z.string().nullable(),
  pfr_name: z.string().nullable(),
});

export function mapTrade(r: Raw, gsisByPfr: GsisByPfr = new Map()): z.infer<typeof tradeRow> {
  const pfr = str(r.pfr_id);
  // Deterministic surrogate: every field that distinguishes an asset within a
  // trade. Re-fetching yields the same key, so upserts stay idempotent.
  const asset_id = [
    r.trade_id ?? "",
    r.gave ?? "",
    r.received ?? "",
    r.pfr_id ?? "",
    r.pick_season ?? "",
    r.pick_round ?? "",
    r.pick_number ?? "",
  ].join("|");
  return {
    asset_id,
    trade_id: int(r.trade_id) ?? 0,
    season: int(r.season),
    trade_date: str(r.trade_date),
    gave: r.gave ? team(r.gave) : null,
    received: r.received ? team(r.received) : null,
    pick_season: int(r.pick_season),
    pick_round: int(r.pick_round),
    pick_number: int(r.pick_number),
    conditional: r.conditional === "1" ? true : r.conditional === "0" ? false : null,
    player_id: pfr ? (gsisByPfr.get(pfr) ?? null) : null,
    pfr_id: pfr,
    pfr_name: str(r.pfr_name),
  };
}

// ---- injuries (2009+) ----
// injuries_<year>.csv header (real): season, game_type, team, week, gsis_id,
// position, full_name, first_name, last_name, report_primary_injury,
// report_secondary_injury, report_status, practice_primary_injury,
// practice_secondary_injury, practice_status, date_modified.

export const injuryRow = z.strictObject({
  player_id: id, // gsis
  season: z.number().int(),
  game_type: z.enum(["REG", "POST"]),
  week: z.number().int(),
  team: id,
  position: z.string().nullable(),
  report_primary_injury: z.string().nullable(),
  report_secondary_injury: z.string().nullable(),
  report_status: z.string().nullable(),
  practice_primary_injury: z.string().nullable(),
  practice_secondary_injury: z.string().nullable(),
  practice_status: z.string().nullable(),
  date_modified: z.string().nullable(),
});

/** Note: game_type is normalized here but may come back "" / "PRE"; the
 * pipeline drops non-REG/POST rows before validation (the zod enum is strict). */
export function mapInjury(r: Raw): Record<string, unknown> {
  return {
    player_id: r.gsis_id ?? "",
    season: int(r.season) ?? 0,
    game_type: SEASON_TYPE[r.game_type ?? ""] ?? "",
    week: int(r.week) ?? 0,
    team: team(r.team ?? ""),
    position: str(r.position),
    report_primary_injury: str(r.report_primary_injury),
    report_secondary_injury: str(r.report_secondary_injury),
    report_status: str(r.report_status),
    practice_primary_injury: str(r.practice_primary_injury),
    practice_secondary_injury: str(r.practice_secondary_injury),
    practice_status: str(r.practice_status),
    date_modified: str(r.date_modified),
  };
}

// ---- depth charts (2001+) ----
// depth_charts_<year>.csv header (real): season, club_code, week, game_type,
// depth_team, last_name, first_name, football_name, formation, gsis_id,
// jersey_number, position, elias_id, depth_position, full_name.

export const depthChartRow = z.strictObject({
  player_id: id, // gsis
  season: z.number().int(),
  game_type: z.enum(["REG", "POST"]),
  week: z.number().int(),
  team: id,
  position: z.string().min(1),
  depth_team: z.number().int().nullable(),
  depth_position: z.string().nullable(),
  formation: z.string().nullable(),
  jersey_number: z.number().int().nullable(),
});

export function mapDepthChart(r: Raw): Record<string, unknown> {
  return {
    player_id: r.gsis_id ?? "",
    season: int(r.season) ?? 0,
    game_type: SEASON_TYPE[r.game_type ?? ""] ?? "",
    week: int(r.week) ?? 0,
    team: team(r.club_code ?? ""),
    position: str(r.position) ?? "",
    depth_team: int(r.depth_team),
    depth_position: str(r.depth_position),
    formation: str(r.formation),
    jersey_number: int(r.jersey_number),
  };
}

// ---- snap counts (2012+) ----
// snap_counts_<year>.csv header (real): game_id, pfr_game_id, season,
// game_type, week, player, pfr_player_id, position, team, opponent,
// offense_snaps, offense_pct, defense_snaps, defense_pct, st_snaps, st_pct.
// Players are keyed by PFR id here (not gsis); game_id matches the schedule.

export const snapCountRow = z.strictObject({
  pfr_player_id: id,
  game_id: id,
  player_id: z.string().nullable(), // gsis, resolved via player_ids
  season: z.number().int(),
  game_type: z.enum(["REG", "POST"]),
  week: z.number().int(),
  team: id,
  opponent: z.string().nullable(),
  position: z.string().nullable(),
  offense_snaps: z.number().int().nullable(),
  offense_pct: z.number().nullable(),
  defense_snaps: z.number().int().nullable(),
  defense_pct: z.number().nullable(),
  st_snaps: z.number().int().nullable(),
  st_pct: z.number().nullable(),
});

export function mapSnapCount(r: Raw, gsisByPfr: GsisByPfr = new Map()): Record<string, unknown> {
  const pfr = r.pfr_player_id ?? "";
  return {
    pfr_player_id: pfr,
    game_id: r.game_id ?? "",
    player_id: gsisByPfr.get(pfr) ?? null,
    season: int(r.season) ?? 0,
    game_type: SEASON_TYPE[r.game_type ?? ""] ?? "",
    week: int(r.week) ?? 0,
    team: team(r.team ?? ""),
    opponent: r.opponent ? team(r.opponent) : null,
    position: str(r.position),
    offense_snaps: int(r.offense_snaps),
    offense_pct: float(r.offense_pct),
    defense_snaps: int(r.defense_snaps),
    defense_pct: float(r.defense_pct),
    st_snaps: int(r.st_snaps),
    st_pct: float(r.st_pct),
  };
}
