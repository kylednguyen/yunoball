"use client";

import { useEffect, useState } from "react";

import { Nav } from "../components/Nav";
import { fetchStandings, type StandingsResponse } from "../lib/api";

function StreakCell({ streak }: { streak: string }) {
  const cls = streak.startsWith("W") ? "yb-streak-w" : streak.startsWith("L") ? "yb-streak-l" : "";
  return <span className={cls}>{streak}</span>;
}

export default function StandingsPage() {
  const [data, setData] = useState<StandingsResponse | null>(null);
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchStandings(season)
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
  }, [season]);

  return (
    <>
      <Nav />
      <main id="main" className="yb-page">
        <div className="yb-page-head">
          <h1 className="yb-page-title">Standings</h1>
          {data && (
            <select
              className="yb-select"
              aria-label="Select season"
              value={data.season}
              onChange={(e) => setSeason(Number(e.target.value))}
            >
              {data.seasons.map((s) => (
                <option key={s} value={s}>
                  {s} season
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="yb-page-sub">
          Computed live from game results — always in agreement with the scoreboard.
        </p>

        {error && (
          <div className="yb-state error" role="alert">
            <div className="yb-glyph" aria-hidden="true">
              ⚠️
            </div>
            <h2>Couldn&apos;t load standings</h2>
            <p>{error}</p>
          </div>
        )}

        {loading && !data && (
          <div className="yb-standings-grid">
            {[0, 1].map((i) => (
              <div key={i} className="yb-skel" style={{ height: 480, borderRadius: 14 }} />
            ))}
          </div>
        )}

        {data && !error && (
          <div className="yb-standings-grid" style={{ opacity: loading ? 0.6 : 1 }}>
            {data.conferences.map((conf) => (
              <section key={conf.conference} aria-label={`${conf.conference} standings`}>
                <h2 className="yb-conf-title">{conf.conference}</h2>
                {conf.divisions.map((div) => (
                  <div key={div.division} className="yb-division">
                    <h3>{div.division}</h3>
                    <div className="yb-table-scroll">
                      <table className="yb-table">
                        <thead>
                          <tr>
                            <th>Team</th>
                            <th className="num">W</th>
                            <th className="num">L</th>
                            <th className="num">PCT</th>
                            <th className="num">PF</th>
                            <th className="num">PA</th>
                            <th className="num">DIFF</th>
                            <th className="num">STRK</th>
                          </tr>
                        </thead>
                        <tbody>
                          {div.teams.map((t, i) => (
                            <tr key={t.team_id} className={i === 0 ? "yb-div-leader" : undefined}>
                              <td>{t.name}</td>
                              <td className="num">{t.wins}</td>
                              <td className="num">{t.losses}</td>
                              <td className="num">{t.pct.toFixed(3).replace(/^0/, "")}</td>
                              <td className="num">{t.points_for}</td>
                              <td className="num">{t.points_against}</td>
                              <td className="num">
                                {t.point_diff > 0 ? `+${t.point_diff}` : t.point_diff}
                              </td>
                              <td className="num">
                                <StreakCell streak={t.streak} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
