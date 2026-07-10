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

/* Client-side GET cache: 60s TTL + in-flight dedupe. Revisited screens
   render instantly from memory while stats change on ingest cadence, not
   per-second. POSTs (ask/askAgent) stay uncached.
   ponytail: TTL cache, swap for stale-while-revalidate if freshness bites. */
const TTL_MS = 60_000;
const jsonCache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

class HttpError extends Error {
  constructor(public status: number) {
    super(`Request failed (${status})`);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const hit = jsonCache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;
  const pending = inflight.get(path);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!res.ok) throw new HttpError(res.status);
    const data = (await res.json()) as unknown;
    jsonCache.set(path, { at: Date.now(), data });
    return data;
  })();
  inflight.set(path, p);
  try {
    return (await p) as T;
  } finally {
    inflight.delete(path);
  }
}

/** GET where a 404 means "doesn't exist" rather than an error. */
async function getJsonOr404<T>(path: string): Promise<T | null> {
  try {
    return await getJson<T>(path);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

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
  return (await getJson<{ examples: string[] }>(`/api/search/examples?n=${n}`)).examples;
}

export function fetchSuggest(q: string): Promise<SuggestResponse> {
  return getJson<SuggestResponse>(`/api/search/suggest?q=${encodeURIComponent(q)}`);
}

export function fetchSharedAnswer(shareId: string): Promise<AnswerResult | null> {
  return getJsonOr404<AnswerResult>(`/api/search/answer/${shareId}`);
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
  return getJson<LeaderboardsResponse>(`/api/leaderboards?${params}`);
}

export async function fetchGames(season?: number, week?: number): Promise<GamesResponse> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  if (week) params.set("week", String(week));
  return getJson<GamesResponse>(`/api/games?${params}`);
}

export async function fetchPerformers(
  season?: number,
  week?: number,
  limit = 10,
): Promise<PerformersResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (season) params.set("season", String(season));
  if (week) params.set("week", String(week));
  return getJson<PerformersResponse>(`/api/games/performers?${params}`);
}

export async function fetchStandings(season?: number): Promise<StandingsResponse> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  return getJson<StandingsResponse>(`/api/standings?${params}`);
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
  return getJson<FantasyPlayersResponse>(`/api/fantasy/players?${params}`);
}

export function fetchPlayer(playerId: string): Promise<PlayerProfile | null> {
  return getJsonOr404<PlayerProfile>(`/api/players/${encodeURIComponent(playerId)}`);
}

export function fetchBoxScore(gameId: string): Promise<BoxScore | null> {
  return getJsonOr404<BoxScore>(`/api/games/${encodeURIComponent(gameId)}/boxscore`);
}

export async function fetchPlayerSplits(
  playerId: string,
  season?: number,
): Promise<PlayerSplits | null> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  return getJsonOr404<PlayerSplits>(
    `/api/players/${encodeURIComponent(playerId)}/splits?${params}`,
  );
}

export async function fetchTeam(
  teamId: string,
  season?: number,
): Promise<TeamProfile | null> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  return getJsonOr404<TeamProfile>(`/api/teams/${encodeURIComponent(teamId)}?${params}`);
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
