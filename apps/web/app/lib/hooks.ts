"use client";

import { useCallback, useEffect, useState } from "react";

import {
  fetchBoxScore,
  fetchLeaderboards,
  fetchPlayer,
  fetchPlayerSplits,
  fetchStandings,
  fetchTeam,
  type BoxScore,
  type PlayerProfile,
  type PlayerSplits,
  type TeamProfile,
} from "./api";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** One fetch-on-deps-change effect for every data-driven page: loading flag,
 *  error capture and stale-response protection in a single place. */
function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true }));
    fetcher()
      .then((data) => active && setState({ data, error: null, loading: false }))
      .catch(
        (e) =>
          active && setState((s) => ({ ...s, error: (e as Error).message, loading: false })),
      );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the fetcher's inputs
  }, deps);

  return state;
}

export const useStandings = (season?: number) => useApi(() => fetchStandings(season), [season]);

export const useLeaderboards = (
  season?: number,
  limit = 10,
  team?: string,
  position?: string,
) => useApi(() => fetchLeaderboards(season, limit, { team, position }), [season, limit, team, position]);

export const useTeam = (teamId: string | undefined, season?: number): ApiState<TeamProfile | null> =>
  useApi(() => (teamId ? fetchTeam(teamId, season) : Promise.resolve(null)), [teamId, season]);

export const usePlayer = (playerId: string | undefined): ApiState<PlayerProfile | null> =>
  useApi(() => (playerId ? fetchPlayer(playerId) : Promise.resolve(null)), [playerId]);

export const useBoxScore = (gameId: string | undefined): ApiState<BoxScore | null> =>
  useApi(() => (gameId ? fetchBoxScore(gameId) : Promise.resolve(null)), [gameId]);

export const usePlayerSplits = (
  playerId: string | undefined,
  season?: number,
  enabled = true,
): ApiState<PlayerSplits | null> =>
  useApi(
    () => (playerId && enabled ? fetchPlayerSplits(playerId, season) : Promise.resolve(null)),
    [playerId, season, enabled],
  );


/** Season kept in the URL (?season=2025) so team/player/leader views are
 *  linkable and survive refresh. Same window.location idiom as search.tsx. */
/** Numeric view state mirrored into the URL — shareable, and it survives
 * back-navigation and refresh. */
export function useNumParam(
  name: string,
): [number | undefined, (v: number | undefined) => void] {
  const [value, setValue] = useState<number | undefined>(undefined);

  useEffect(() => {
    const v = Number(new URLSearchParams(window.location.search).get(name));
    if (v) setValue(v);
  }, [name]);

  const set = useCallback(
    (v: number | undefined) => {
      setValue(v);
      const url = new URL(window.location.href);
      if (v) url.searchParams.set(name, String(v));
      else url.searchParams.delete(name);
      window.history.replaceState(null, "", url);
    },
    [name],
  );

  return [value, set];
}

export function useSeasonParam(): [number | undefined, (s: number | undefined) => void] {
  return useNumParam("season");
}

/** String view state mirrored into the URL; `def` values stay out of it. */
export function useStrParam(
  name: string,
  def: string,
): [string, (v: string) => void] {
  const [value, setValue] = useState(def);

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get(name);
    if (v) setValue(v);
  }, [name]);

  const set = useCallback(
    (v: string) => {
      setValue(v);
      const url = new URL(window.location.href);
      if (v && v !== def) url.searchParams.set(name, v);
      else url.searchParams.delete(name);
      window.history.replaceState(null, "", url);
    },
    [name, def],
  );

  return [value, set];
}

/** Per-page document title — client pages can't export metadata, so tabs,
 * history and screen readers get their titles here. */
export function useTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const full = `${title} · YunoBall`;
    document.title = full;
    // Next applies the route's static metadata asynchronously after mount on
    // first load — re-apply once it has settled.
    const t = setTimeout(() => {
      document.title = full;
    }, 300);
    return () => clearTimeout(t);
  }, [title]);
}
