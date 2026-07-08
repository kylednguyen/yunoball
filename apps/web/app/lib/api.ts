export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ResolvedEntity {
  mention: string;
  entity_type: string;
  canonical_id: string;
  display_name: string;
  confidence: number;
}

export interface AnswerResult {
  question: string;
  narration: string;
  sql: string;
  rows: Record<string, unknown>[];
  columns: string[];
  entities?: ResolvedEntity[];
  cached: boolean;
  share_id?: string | null;
}

export async function ask(question: string): Promise<AnswerResult> {
  const res = await fetch(`${API_URL}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as AnswerResult;
}

export async function fetchSharedAnswer(shareId: string): Promise<AnswerResult | null> {
  const res = await fetch(`${API_URL}/api/search/answer/${shareId}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as AnswerResult;
}

export interface LeaderRow {
  rank: number;
  player_id: string;
  name: string;
  team: string | null;
  value: number;
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

export async function fetchLeaderboards(
  season?: number,
  limit = 10,
): Promise<LeaderboardsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (season) params.set("season", String(season));
  const res = await fetch(`${API_URL}/api/leaderboards?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as LeaderboardsResponse;
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

export async function fetchGames(season?: number, week?: number): Promise<GamesResponse> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  if (week) params.set("week", String(week));
  const res = await fetch(`${API_URL}/api/games?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as GamesResponse;
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

export async function fetchStandings(season?: number): Promise<StandingsResponse> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  const res = await fetch(`${API_URL}/api/standings?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as StandingsResponse;
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
  points_per_game: number;
}

export interface FantasyPlayersResponse {
  season: number;
  seasons: number[];
  players: FantasyPlayer[];
}

export async function fetchFantasyPlayers(
  season?: number,
  position?: string,
  q?: string,
): Promise<FantasyPlayersResponse> {
  const params = new URLSearchParams({ limit: "300" });
  if (season) params.set("season", String(season));
  if (position && position !== "ALL") params.set("position", position);
  if (q) params.set("q", q);
  const res = await fetch(`${API_URL}/api/fantasy/players?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as FantasyPlayersResponse;
}

// ---- Player profiles ----

export interface PlayerSeasonLine {
  season: number;
  team: string | null;
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
  week: number;
  date: string | null;
  opponent: string;
  home: boolean;
  team_score: number | null;
  opp_score: number | null;
  result: string;
  passing_yards: number;
  passing_tds: number;
  rushing_yards: number;
  rushing_tds: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
}

export interface PlayerProfile {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  team_name: string | null;
  headshot_url: string | null;
  career: PlayerCareer;
  seasons: PlayerSeasonLine[];
  game_log: PlayerGameLogRow[];
}

export async function fetchPlayer(playerId: string): Promise<PlayerProfile | null> {
  const res = await fetch(`${API_URL}/api/players/${encodeURIComponent(playerId)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as PlayerProfile;
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
  mode: "demo" | "llm";
}

export async function askAgent(messages: ChatTurn[]): Promise<AgentResponse> {
  const res = await fetch(`${API_URL}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: messages.slice(-20) }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as AgentResponse;
}
