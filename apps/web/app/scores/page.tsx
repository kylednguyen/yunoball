"use client";

import { useEffect, useState } from "react";

import { Nav } from "../components/Nav";
import { fetchGames, type GamesResponse, type GameRow } from "../lib/api";

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
          <span className="yb-game-team">
            <span className="abbr">{side.team_id}</span>
            <span className="nick">{side.nickname ?? side.name}</span>
          </span>
          <span className="yb-game-score">{side.score ?? "–"}</span>
        </div>
      ))}
      <div className="yb-game-foot">
        <span>{formatDate(game.date)}</span>
        {game.final && <span className="yb-final-chip">FINAL</span>}
      </div>
    </div>
  );
}

export default function ScoresPage() {
  const [data, setData] = useState<GamesResponse | null>(null);
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [week, setWeek] = useState<number | undefined>(undefined);
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
        <p className="yb-page-sub">Every final from the warehouse, week by week.</p>

        {data && (
          <div className="yb-week-tabs" role="tablist" aria-label="Week">
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
            <div className="yb-glyph" aria-hidden="true">
              ⚠️
            </div>
            <h2>Couldn&apos;t load scores</h2>
            <p>{error}</p>
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

            <div className="yb-games-grid" style={{ opacity: loading ? 0.6 : 1 }}>
              {data.games.map((g) => (
                <GameCard key={g.game_id} game={g} />
              ))}
            </div>
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
