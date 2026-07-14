"use client";

import { useNumParam, useTitle } from "../lib/hooks";

import { tablistKeys } from "../components/tablist";

import { useEffect, useState } from "react";

import { GameCard } from "../components/GameCard";
import { Performers } from "../components/Performers";
import { SeasonSelect } from "../components/SeasonSelect";
import { PageHeader, SectionHeader } from "../components/ui";
import {
  friendlyError,
  fetchGames,
  fetchPerformers,
  type GamesResponse,
  type GameRow,
  type PerformersResponse,
} from "../lib/api";
import { formatGameDate } from "../lib/format";

export default function ScoresPage() {
  useTitle("Scores");
  const [data, setData] = useState<GamesResponse | null>(null);
  // Season/week live in the URL: refresh, share and back-nav keep the view.
  const [season, setSeason] = useNumParam("season");
  const [week, setWeek] = useNumParam("week");
  const [performers, setPerformers] = useState<PerformersResponse | null>(null);
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

  // Performers follow the games panel's resolved season/week.
  useEffect(() => {
    if (!data) return;
    let active = true;
    setPerformers(null);
    fetchPerformers(data.season, data.week, 5)
      .then((p) => active && setPerformers(p))
      .catch(() => active && setPerformers(null));
    return () => {
      active = false;
    };
  }, [data]);

  const totalPoints = data?.games.reduce(
    (sum, g) => sum + (g.home.score ?? 0) + (g.away.score ?? 0),
    0,
  );
  const topGame = data?.games.reduce<GameRow | null>((best, g) => {
    const t = (g.home.score ?? 0) + (g.away.score ?? 0);
    const bt = best ? (best.home.score ?? 0) + (best.away.score ?? 0) : -1;
    return t > bt ? g : best;
  }, null);
  const closestGame = data?.games.reduce<GameRow | null>((best, g) => {
    if (!g.final || g.home.score === null || g.away.score === null) return best;
    const margin = Math.abs(g.home.score - g.away.score);
    if (!best || margin < Math.abs((best.home.score ?? 0) - (best.away.score ?? 0))) return g;
    return best;
  }, null);
  const biggestMargin = data?.games.reduce<GameRow | null>((best, g) => {
    if (!g.final || g.home.score === null || g.away.score === null) return best;
    const margin = Math.abs(g.home.score - g.away.score);
    if (!best || margin > Math.abs((best.home.score ?? 0) - (best.away.score ?? 0))) return g;
    return best;
  }, null);
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
          title="Scores & Results"
          description={data ? `Week ${data.week}, ${data.season}. Finals and scheduled games grouped by date.` : "Every final, week by week."}
          controls={
            data && (
              <SeasonSelect
                seasons={data.seasons}
                value={data.season}
                onChange={(nextSeason) => {
                  setSeason(nextSeason);
                  setWeek(undefined);
                }}
              />
            )
          }
          filters={
            data && (
              <div className="yb-week-rail-wrap">
                <button
                  className="yb-btn ghost sm"
                  type="button"
                  aria-label="Previous week"
                  disabled={!previousWeek}
                  onClick={() => previousWeek && setWeek(previousWeek)}
                >
                  Prev
                </button>
                <div className="yb-week-tabs" role="tablist" aria-label="Week" onKeyDown={tablistKeys}>
                  {data.weeks.map((w) => (
                    <button
                      key={w}
                      role="tab"
                      aria-selected={w === data.week}
                      className="yb-week-tab"
                      onClick={() => setWeek(w)}
                      ref={(el) => {
                        if (el && w === data.week) el.scrollIntoView({ block: "nearest", inline: "center" });
                      }}
                    >
                      Wk {w}
                    </button>
                  ))}
                </div>
                <button
                  className="yb-btn ghost sm"
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
            <div className="yb-score-context" aria-label="Week context">
              <span>{data.games.length} games</span>
              <span>{totalPoints?.toLocaleString()} points</span>
              {topGame && (
                <span>
                  Highest scoring: {topGame.away.team_id} @ {topGame.home.team_id}
                </span>
              )}
              {closestGame && (
                <span>
                  Closest: {closestGame.away.team_id} @ {closestGame.home.team_id}
                </span>
              )}
              {biggestMargin && (
                <span>
                  Biggest margin: {biggestMargin.away.team_id} @ {biggestMargin.home.team_id}
                </span>
              )}
            </div>

            {data.games.length === 0 ? (
              <div className="yb-state">
                <h2>No games this week</h2>
                <p>Nothing final for week {data.week} yet. Pick another week above.</p>
              </div>
            ) : (
              <section data-section="games" aria-label="Games" style={{ opacity: loading ? 0.6 : 1 }}>
                <SectionHeader title="Games" meta={`${data.games.length} matchups`} />
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

            <section data-section="performers" aria-label="Performers of the week" className="yb-score-performers">
              <SectionHeader title="Performers of the week" meta={`Top PPR fantasy lines · week ${data.week}`} />
              <Performers performers={performers?.performers ?? null} loading={!performers} count={5} />
            </section>
          </>
        )}

        {loading && !data && (
          <div className="yb-games-grid">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="yb-skel" style={{ height: 110, borderRadius: 14 }} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
