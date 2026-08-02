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
 * PFR-style codes used by the nflverse draft dataset (KAN, GNB, ...); the
 * third covers GSIS codes used by the 2002–2015 roster files (BLT, HST, ...). */
export const TEAM_MAP: Record<string, string> = {
  OAK: "LV",
  SD: "LAC",
  STL: "LAR",
  LA: "LAR",
  JAC: "JAX",
  GNB: "GB", KAN: "KC", LVR: "LV", NOR: "NO", NWE: "NE",
  PHO: "ARI", RAI: "LV", RAM: "LAR", SDG: "LAC", SFO: "SF", TAM: "TB",
  ARZ: "ARI", BLT: "BAL", CLV: "CLE", HST: "HOU", SL: "LAR",
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
const num = () => z.number().nullable();

/** Column blocks shared by the player game log and the season rollup — both
 * come from the same nflverse stats_player files, so one definition keeps the
 * two row schemas from drifting apart. */
const specialTeamsCols = {
  fg_made: num(), fg_att: num(), fg_long: num(), fg_made_50_plus: num(),
  gwfg_made: num(), gwfg_att: num(), pat_made: num(), pat_att: num(),
  punts: num(), punt_yards: num(), punt_long: num(), punt_net_yards: num(),
  punts_inside_20: num(), punts_blocked: num(),
  punt_returns: num(), punt_return_yards: num(),
  kick_returns: num(), kick_return_yards: num(), special_teams_tds: num(),
};
const situationalCols = {
  passing_first_downs: num(), rushing_first_downs: num(), receiving_first_downs: num(),
  passing_yards_after_catch: num(), receiving_yards_after_catch: num(),
  penalties: num(), penalty_yards: num(),
};
const extendedDefenseCols = {
  def_tackles_for_loss: num(), def_qb_hits: num(), def_interception_yards: num(),
  def_tds: num(), def_safeties: num(),
};

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
  ...specialTeamsCols,
  ...situationalCols,
  ...extendedDefenseCols,
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
  ...specialTeamsCols,
  ...situationalCols,
  ...extendedDefenseCols,
});

/** A team's row for one game: the win/loss record from the schedule, widened
 * with the box score from the nflverse stats_team release. The box-score
 * columns are nullable because stats_team is fetched best-effort — if it is
 * unavailable the row still carries the result, as it always did. */
export const teamGameStatsRow = z.strictObject({
  team_id: id,
  game_id: id,
  is_home: z.boolean(),
  points_for: z.number(),
  points_against: z.number(),
  result: z.enum(["W", "L", "T"]),
  total_yards: z.number().nullable(),
  passing_yards: z.number().nullable(),
  rushing_yards: z.number().nullable(),
  turnovers: z.number().nullable(),
  first_downs: z.number().nullable(),
  penalties: z.number().nullable(),
  penalty_yards: z.number().nullable(),
  sacks_taken: z.number().nullable(),
  def_sacks: z.number().nullable(),
  fg_made: z.number().nullable(),
  fg_att: z.number().nullable(),
  passing_epa: z.number().nullable(),
  rushing_epa: z.number().nullable(),
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

export const rosterRow = z.strictObject({
  player_id: id,
  season: z.number().int(),
  team_id: id,
  position: z.string().nullable(),
  jersey_number: z.number().nullable(),
  status: z.string().nullable(),
});

export const playerIdMapRow = z.strictObject({
  player_id: id,
  espn_id: z.string().nullable(),
  pfr_id: z.string().nullable(),
  pff_id: z.string().nullable(),
  otc_id: z.string().nullable(),
  esb_id: z.string().nullable(),
  headshot_url: z.string().nullable(),
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
  td_kind: z.enum([
    "pass", "rush", "int_return", "fumble_return", "kick_return", "punt_return", "other",
  ]).nullable(),
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
