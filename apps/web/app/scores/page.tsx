"use client";

import { useNumParam, useTitle } from "../lib/hooks";

import { useEffect, useState } from "react";

import { GameCard } from "../components/GameCard";
import { Performers } from "../components/Performers";
import { PageHeader, SectionHeader } from "../components/ui";
import {
  friendlyError,
  fetchGames,
  fetchPerformers,
  type GamesResponse,
  type GameRow,
  type PerformersResponse,
} from "../lib/api";
import { formatGameDate, weekLabel } from "../lib/format";

export default function ScoresPage() {
  useTitle("Scores");
  const [data, setData] = useState<GamesResponse | null>(null);
  // Season/week live in the URL: refresh, share and back-nav keep the view.
  const [season] = useNumParam("season");
  const [week, setWeek] = useNumParam("week");
  const [performers, setPerformers] = useState<PerformersResponse | null>(null);
  const [performersFailed, setPerformersFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchGames(season, week)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
      })
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [season, week]);

  // Performers follow the games panel's resolved season/week. A failed fetch
  // flips a flag so the section shows an error line, not an eternal skeleton.
  useEffect(() => {
    if (!data) return;
    let active = true;
    setPerformers(null);
    setPerformersFailed(false);
    fetchPerformers(data.season, data.week, 5)
      .then((p) => active && setPerformers(p))
      .catch(() => active && setPerformersFailed(true));
    return () => {
      active = false;
    };
  }, [data]);

  const gamesByDate = (data?.games ?? []).reduce<Map<string, GameRow[]>>((map, game) => {
    const key = game.date ?? "Date TBD";
    map.set(key, [...(map.get(key) ?? []), game]);
    return map;
  }, new Map());
  const weekIndex = data ? data.weeks.indexOf(data.week) : -1;
  const previousWeek = data && weekIndex > 0 ? data.weeks[weekIndex - 1] : undefined;
  const nextWeek =
    data && weekIndex >= 0 && weekIndex < data.weeks.length - 1
      ? data.weeks[weekIndex + 1]
      : undefined;

  return (
    <>
      <main id="main" className="yb-page">
        <PageHeader
          title="Scores"
          filters={
            data && (
              <div className="yb-week-rail-wrap">
                <button
                  className="yb-btn sm"
                  type="button"
                  aria-label="Previous week"
                  disabled={!previousWeek}
                  onClick={() => previousWeek && setWeek(previousWeek)}
                >
                  Prev
                </button>
                {/* One week at a time: the current week is the single pill. */}
                <span className="yb-week-current" aria-live="polite">
                  {weekLabel(data.week, data.season)}
                </span>
                <button
                  className="yb-btn sm"
                  type="button"
                  aria-label="Next week"
                  disabled={!nextWeek}
                  onClick={() => nextWeek && setWeek(nextWeek)}
                >
                  Next
                </button>
              </div>
            )
          }
        />

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Couldn’t load scores</h2>
            <p>{friendlyError(error)}</p>
          </div>
        )}

        {data && !error && (
          <>
            {data.games.length === 0 ? (
              <div className="yb-state">
                <h2>No games at this time</h2>
                <p>Nothing final for {weekLabel(data.week, data.season)} yet. Pick another week above.</p>
              </div>
            ) : (
              <section data-section="games" aria-label="Games" style={{ opacity: loading ? 0.6 : 1 }}>
                <SectionHeader
                  title="Games"
                />
                {[...gamesByDate.entries()].map(([date, games]) => (
                  <div key={date} className="yb-score-group">
                    <h3>{formatGameDate(date === "Date TBD" ? null : date)}</h3>
                    <div className="yb-games-grid">
                      {games.map((g) => (
                        <GameCard key={g.game_id} game={g} />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}

            <section
              id="performers"
              data-section="performers"
              aria-label="Performers of the Week"
              className="yb-card yb-score-performers"
            >
              <SectionHeader title="Performers of the Week" />
              {performersFailed ? (
                <p className="yb-muted" role="alert">
                  Couldn’t load performers. Refresh to try again.
                </p>
              ) : (
                <Performers performers={performers?.performers ?? null} loading={!performers} count={5} />
              )}
            </section>
          </>
        )}

        {loading && !data && (
          <div className="yb-games-grid">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="yb-skel" style={{ height: 110, borderRadius: "var(--r-xl)" }} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
