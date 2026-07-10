"use client";

import { useTitle } from "../lib/hooks";

import { tablistKeys } from "../components/tablist";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Nav } from "../components/Nav";
import { Performers } from "../components/Performers";
import { TeamLogo } from "../components/TeamLogo";
import {
  friendlyError,
  fetchGames,
  fetchPerformers,
  type GamesResponse,
  type GameRow,
  type PerformersResponse,
} from "../lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function GameCard({ game }: { game: GameRow }) {
  const homeWon = game.final && (game.home.score ?? 0) > (game.away.score ?? 0);
  const awayWon = game.final && (game.away.score ?? 0) > (game.home.score ?? 0);
  return (
    <div className="yb-game-card yb-enter">
      {[
        { side: game.away, won: awayWon },
        { side: game.home, won: homeWon },
      ].map(({ side, won }) => (
        <div key={side.team_id} className={`yb-game-row${won ? " winner" : ""}`}>
          <Link className="yb-game-team" href={`/teams/${side.team_id}?season=${game.season}`}>
            <TeamLogo team={side.team_id} />
            <span className="abbr">{side.team_id}</span>
            <span className="nick">{side.nickname ?? side.name}</span>
          </Link>
          <span className="yb-game-score">{side.score ?? "-"}</span>
        </div>
      ))}
      <div className="yb-game-foot">
        <span>{formatDate(game.date)}</span>
        {game.final ? (
          <Link className="yb-link" style={{ fontSize: 12 }} href={`/games/${encodeURIComponent(game.game_id)}`}>
            Box score →
          </Link>
        ) : (
          <span className="yb-final-chip">UPCOMING</span>
        )}
      </div>
    </div>
  );
}

export default function ScoresPage() {
  useTitle("Scores");
  const [data, setData] = useState<GamesResponse | null>(null);
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [week, setWeek] = useState<number | undefined>(undefined);
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

  return (
    <>
      <Nav />
      <main id="main" className="yb-page">
        <div className="yb-page-head">
          <h1 className="yb-page-title">Scores &amp; Results</h1>
          {data && (
            <select
              className="yb-select"
              aria-label="Select season"
              value={data.season}
              onChange={(e) => {
                setSeason(Number(e.target.value));
                setWeek(undefined);
              }}
            >
              {data.seasons.map((s) => (
                <option key={s} value={s}>
                  {s} season
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="yb-page-sub">Every final, week by week.</p>

        {data && (
          <div className="yb-week-tabs" role="tablist" aria-label="Week" onKeyDown={tablistKeys}>
            {data.weeks.map((w) => (
              <button
                key={w}
                role="tab"
                aria-selected={w === data.week}
                className="yb-week-tab"
                onClick={() => setWeek(w)}
              >
                Wk {w}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Couldn’t load scores</h2>
            <p>{friendlyError(error)}</p>
          </div>
        )}

        {data && !error && (
          <>
            <div className="yb-tiles">
              <div className="yb-tile">
                <div className="yb-tile-label">Games</div>
                <div className="yb-tile-value">{data.games.length}</div>
                <div className="yb-tile-meta">
                  week {data.week}, {data.season}
                </div>
              </div>
              <div className="yb-tile">
                <div className="yb-tile-label">Points scored</div>
                <div className="yb-tile-value">{totalPoints}</div>
                <div className="yb-tile-meta">across the week</div>
              </div>
              {topGame && (
                <div className="yb-tile">
                  <div className="yb-tile-label">Highest scoring</div>
                  <div className="yb-tile-value">
                    {(topGame.home.score ?? 0) + (topGame.away.score ?? 0)}
                  </div>
                  <div className="yb-tile-meta">
                    {topGame.away.team_id} @ {topGame.home.team_id}
                  </div>
                </div>
              )}
            </div>

            <section aria-label="Performers of the week" style={{ margin: "8px 0 24px" }}>
              <div className="yb-dash-head">
                <h2>Performers of the week</h2>
                <span className="yb-muted" style={{ fontSize: 13 }}>
                  top PPR fantasy lines · week {data.week}
                </span>
              </div>
              <Performers performers={performers?.performers ?? null} loading={!performers} count={5} />
            </section>

            {data.games.length === 0 ? (
              <div className="yb-state">
                <h2>No games this week</h2>
                <p>Nothing final for week {data.week} yet. Pick another week above.</p>
              </div>
            ) : (
              <div className="yb-games-grid" style={{ opacity: loading ? 0.6 : 1 }}>
                {data.games.map((g) => (
                  <GameCard key={g.game_id} game={g} />
                ))}
              </div>
            )}
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
