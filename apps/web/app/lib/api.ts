export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ResolvedEntity {
  mention: string;
  entity_type: string;
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

export interface StandingRow {
  rank: number;
  team_id: string;
  team: string;
  conference: string | null;
  division: string | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  diff: number;
  pct: number;
}

export interface StandingsResponse {
  season: number;
  seasons: number[];
  rows: StandingRow[];
}

export async function fetchStandings(season?: number): Promise<StandingsResponse> {
  const params = new URLSearchParams();
  if (season) params.set("season", String(season));
  const qs = params.toString();
  const res = await fetch(`${API_URL}/api/standings${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as StandingsResponse;
}
