/** Typed client for the YunoBall Express API. All request/response shapes
 * come from @yunoball/types — the same definitions the backend implements,
 * so the two can't drift. */

import type {
  AgentResponse,
  AnswerResult,
  BoxScore,
  ChatTurn,
  PlayerSplits,
  FantasyPlayersResponse,
  GamesResponse,
  LeaderboardsResponse,
  PerformersResponse,
  PlayerProfile,
  StandingsResponse,
  SuggestResponse,
  TeamProfile,
} from "@yunoball/types";

export type {
  AgentResponse,
  AgentStep,
  AnswerResult,
  BoxScore,
  BoxScorePlayer,
  BoxScoreTeam,
  ChatTurn,
  PlayerBio,
  PlayerCard,
  PlayerSplits,
  ScoringPlay,
  SplitGroup,
  SplitRow,
  ConferenceStandings,
  DivisionStandings,
  FantasyPlayer,
  FantasyPlayersResponse,
  GameRow,
  GameTeam,
  GamesResponse,
  Leaderboard,
  LeaderboardsResponse,
  LeaderRow,
  Performer,
  PerformersResponse,
  PlayerCareer,
  PlayerGameLogRow,
  PlayerProfile,
  PlayerSeasonLine,
  ResolvedEntity,
  StandingRow,
  StandingsResponse,
  SuggestPlayer,
  SuggestResponse,
  SuggestTeam,
  TeamGame,
  TeamKeyPlayer,
  TeamLeader,
  TeamProfile,
  TeamRecord,
  TeamStat,
} from "@yunoball/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface LeaderboardFilters {
  season?: number;
  team?: string;
  position?: string;
  limit?: number;
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

export async function fetchExamples(n = 4): Promise<string[]> {
  const res = await fetch(`${API_URL}/api/search/examples?n=${n}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return ((await res.json()) as { examples: string[] }).examples;
}

export async function fetchSuggest(q: string): Promise<SuggestResponse> {
  const res = await fetch(`${API_URL}/api/search/suggest?q=${encodeURIComponent(q)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as SuggestResponse;
}

export async function fetchSharedAnswer(shareId: string): Promise<AnswerResult | null> {
  const res = await fetch(`${API_URL}/api/search/answer/${shareId}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as AnswerResult;
}

export async function fetchLeaderboards(
  season?: number,
  limit = 10,
  filters?: Pick<LeaderboardFilters, "team" | "position">,
): Promise<LeaderboardsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (season) params.set("season", String(season));
  if (filters?.team) params.set("team", filters.team);
  if (filters?.position) params.set("position", filters.position);
  const res = await fetch(`${API_URL}/api/leaderboards?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as LeaderboardsResponse;
}

export async function fetchGames(season?: number, week?: number): Promise<GamesResponse> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  if (week) params.set("week", String(week));
  const res = await fetch(`${API_URL}/api/games?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as GamesResponse;
}

export async function fetchPerformers(
  season?: number,
  week?: number,
  limit = 10,
): Promise<PerformersResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (season) params.set("season", String(season));
  if (week) params.set("week", String(week));
  const res = await fetch(`${API_URL}/api/games/performers?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as PerformersResponse;
}

export async function fetchStandings(season?: number): Promise<StandingsResponse> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  const res = await fetch(`${API_URL}/api/standings?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as StandingsResponse;
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

export async function fetchPlayer(playerId: string): Promise<PlayerProfile | null> {
  const res = await fetch(`${API_URL}/api/players/${encodeURIComponent(playerId)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as PlayerProfile;
}

export async function fetchBoxScore(gameId: string): Promise<BoxScore | null> {
  const res = await fetch(
    `${API_URL}/api/games/${encodeURIComponent(gameId)}/boxscore`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as BoxScore;
}

export async function fetchPlayerSplits(
  playerId: string,
  season?: number,
): Promise<PlayerSplits | null> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  const res = await fetch(
    `${API_URL}/api/players/${encodeURIComponent(playerId)}/splits?${params}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as PlayerSplits;
}

export async function fetchTeam(
  teamId: string,
  season?: number,
): Promise<TeamProfile | null> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  const res = await fetch(
    `${API_URL}/api/teams/${encodeURIComponent(teamId)}?${params}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as TeamProfile;
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
