/**
 * The YunoBall API wire contract — one source of truth, imported by both the
 * Express backend (apps/server) and the Next.js frontend (apps/web).
 *
 * Types only: this package has no runtime code, so importing it never affects
 * bundles. Field names are snake_case because they ARE the JSON wire format.
 */

// ---- Search / query engine ----

export interface ResolvedEntity {
  mention: string;
  entity_type: "player" | "team";
  canonical_id: string;
  display_name: string;
  confidence: number;
}

/** Compact identity card for the player an answer is about — rendered above
 * the result table on every answer that concerns a player. */
export interface PlayerCard {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  team_name: string | null;
  headshot_url: string | null;
}

export interface AnswerResult {
  question: string;
  narration: string;
  sql: string;
  rows: Record<string, unknown>[];
  columns: string[];
  entities: ResolvedEntity[];
  cached: boolean;
  share_id?: string | null;
  intent?: string | null;
  /** Primary scalar answer before internal helper columns are removed. */
  answer_value?: number | string | null;
  player_card?: PlayerCard | null;
  /** Second card for head-to-head answers. */
  player_card2?: PlayerCard | null;
  /** Second-layer audit verdict: validation status, warnings shown to the
   * user, and overall confidence in the interpretation. Backend-diagnostic
   * only — the frontend never reads this (warnings are already folded into
   * `narration` server-side), so its absence from the UI is intentional. */
  audit?: {
    status: string;
    warnings: string[];
    confidence: number;
  } | null;
  /** Structured display context for reusable result drill-downs. */
  query_context?: {
    metric: string;
    metric_label: string;
    category:
      | "passing"
      | "rushing"
      | "receiving"
      | "defense"
      | "kicking"
      | "fantasy"
      | "team"
      | "game"
      | "other";
    season: number | null;
    season_type: string;
    scope: "season" | "career";
    per_game: boolean;
  } | null;
}

export interface SuggestPlayer {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  headshot_url: string | null;
}

export interface SuggestTeam {
  team_id: string;
  name: string;
  nickname: string | null;
}

export interface SuggestResponse {
  query: string;
  questions: string[];
  players: SuggestPlayer[];
  teams: SuggestTeam[];
}

// ---- Leaderboards ----

export interface LeaderRow {
  rank: number;
  player_id: string;
  name: string;
  team: string | null;
  position: string | null;
  value: number;
  headshot_url: string | null;
}

export interface Leaderboard {
  key: string;
  label: string;
  unit: string;
  rows: LeaderRow[];
}

export interface LeaderboardsResponse {
  season: number;
  seasons: number[];
  boards: Leaderboard[];
}

// ---- Scores & results ----

export interface GameTeam {
  team_id: string;
  name: string;
  nickname: string | null;
  score: number | null;
}

export interface GameRow {
  game_id: string;
  season: number;
  week: number;
  date: string | null;
  home: GameTeam;
  away: GameTeam;
  final: boolean;
}

export interface GamesResponse {
  season: number;
  seasons: number[];
  week: number;
  weeks: number[];
  games: GameRow[];
}

// ---- Performers of the week ----

export interface Performer {
  rank: number;
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  opponent: string | null;
  headshot_url: string | null;
  fantasy_points_ppr: number;
  stat_line: string;
}

export interface PerformersResponse {
  season: number;
  seasons: number[];
  week: number;
  weeks: number[];
  performers: Performer[];
}

// ---- Standings ----

export interface StandingRow {
  team_id: string;
  name: string;
  nickname: string | null;
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  points_for: number;
  points_against: number;
  point_diff: number;
  streak: string;
}

export interface DivisionStandings {
  division: string;
  teams: StandingRow[];
}

export interface ConferenceStandings {
  conference: string;
  divisions: DivisionStandings[];
}

export interface StandingsResponse {
  season: number;
  seasons: number[];
  conferences: ConferenceStandings[];
}

// ---- Fantasy ----

export interface FantasyPlayer {
  player_id: string;
  name: string;
  team: string | null;
  position: string | null;
  headshot_url: string | null;
  games_played: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  rushing_yards: number;
  rushing_tds: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fantasy_points_ppr: number;
  fantasy_points_half: number;
  fantasy_points_std: number;
  points_per_game: number;
}

export interface FantasyPlayersResponse {
  season: number;
  seasons: number[];
  players: FantasyPlayer[];
}

// ---- Player profiles ----

export interface PlayerSeasonLine {
  season: number;
  team: string | null;
  position_rank: number | null;
  position_players: number | null;
  games_played: number;
  completions: number;
  attempts: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  sacks: number;
  sack_yards: number;
  rushing_yards: number;
  rushing_tds: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fumbles: number;
  fumbles_lost: number;
  tackles: number;
  def_sacks: number;
  def_interceptions: number;
  forced_fumbles: number;
  passes_defended: number;
  fantasy_points_ppr: number;
  points_per_game: number;
}

export interface PlayerCareer {
  seasons: number;
  games_played: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  rushing_yards: number;
  rushing_tds: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fantasy_points_ppr: number;
}

export interface PlayerGameLogRow {
  game_id: string;
  season: number;
  season_type: string; // REG | POST
  week: number;
  date: string | null;
  opponent: string;
  home: boolean;
  team_score: number | null;
  opp_score: number | null;
  result: string;
  completions: number;
  attempts: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fumbles: number;
  fumbles_lost: number;
  tackles: number;
  def_sacks: number;
  def_interceptions: number;
  forced_fumbles: number;
  passes_defended: number;
  fantasy_points_ppr: number;
  pass_plays: number;
  pass_epa: number;
  pass_success: number;
}

/** One aggregated line in a splits table (Home/Road, Wins/Losses, ...). */
export interface SplitRow {
  label: string;
  gp: number;
  completions: number;
  attempts: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fantasy_points_ppr: number;
}

export interface SplitGroup {
  title: string; // Location | Result | Month | Conference | Division | Opponent
  rows: SplitRow[];
}

export interface PlayerSplits {
  player_id: string;
  season: number;
  seasons: number[];
  groups: SplitGroup[];
}

// ---- Box scores ----

export interface BoxScorePlayer {
  player_id: string;
  name: string;
  position: string | null;
  headshot_url: string | null;
  completions: number;
  attempts: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  sacks: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fumbles_lost: number;
  tackles: number;
  def_sacks: number;
  def_interceptions: number;
  forced_fumbles: number;
  passes_defended: number;
  fantasy_points_ppr: number;
}

export interface BoxScoreTeam {
  team_id: string;
  name: string;
  nickname: string | null;
  score: number | null;
  players: BoxScorePlayer[];
}

export interface BoxScore {
  game_id: string;
  season: number;
  season_type: string;
  week: number;
  date: string | null;
  stadium: string | null;
  home: BoxScoreTeam;
  away: BoxScoreTeam;
}

/** One touchdown event from the scoring log. */
export interface ScoringPlay {
  game_id: string;
  season: number;
  week: number;
  date: string | null;
  opponent: string;
  qtr: number | null;
  play_type: string | null;
  description: string | null;
}

export interface PlayerBio {
  birth_date: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  college: string | null;
  first_season: number | null;
  last_season: number | null;
}

export interface PlayerProfile {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  team_name: string | null;
  headshot_url: string | null;
  bio: PlayerBio;
  career: PlayerCareer;
  seasons: PlayerSeasonLine[];
  /** Postseason season-by-season lines (playoffs tab). */
  postseasons: PlayerSeasonLine[];
  game_log: PlayerGameLogRow[];
  scoring_plays: ScoringPlay[];
}

// ---- Team profiles ----

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  points_for: number;
  points_against: number;
  point_diff: number;
  streak: string;
  division_rank: number;
  division_size: number;
}

export interface TeamStat {
  key: string;
  label: string;
  value: number;
  per_game: number;
  rank: number;
}

export interface TeamLeader {
  key: string;
  label: string;
  unit: string;
  player_id: string;
  name: string;
  position: string | null;
  headshot_url: string | null;
  value: number;
}

export interface TeamKeyPlayer {
  player_id: string;
  name: string;
  position: string | null;
  headshot_url: string | null;
  games_played: number;
  passing_yards: number;
  rushing_yards: number;
  receptions: number;
  receiving_yards: number;
  total_tds: number;
  fantasy_points_ppr: number;
}

export interface TeamGame {
  game_id: string;
  week: number;
  date: string | null;
  opponent: string;
  opponent_nickname: string | null;
  home: boolean;
  team_score: number | null;
  opp_score: number | null;
  result: string;
}

export interface TeamProfile {
  team_id: string;
  name: string;
  nickname: string | null;
  conference: string | null;
  division: string | null;
  season: number;
  seasons: number[];
  record: TeamRecord;
  offense: TeamStat[];
  defense: TeamStat[];
  leaders: TeamLeader[];
  key_players: TeamKeyPlayer[];
  games: TeamGame[];
}

// ---- AI assistant ----

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentStep {
  tool: string;
  summary: string;
}

export interface AgentResponse {
  reply: string;
  steps: AgentStep[];
  mode: "demo";
}
