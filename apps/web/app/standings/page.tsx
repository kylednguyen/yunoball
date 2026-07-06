"use client";

import { useEffect, useState } from "react";

import { Nav } from "../components/Nav";
import { BoardSkeleton } from "../components/Skeleton";
import { StandingsTable } from "../components/StandingsTable";
import { fetchStandings, type StandingsResponse } from "../lib/api";

export default function StandingsPage() {
  const [data, setData] = useState<StandingsResponse | null>(null);
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchStandings(season)
      .then((d) => active && setData(d))
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [season]);

  return (
    <>
      <Nav />
      <main id="main" style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px 120px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
            Standings
          </h1>
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
        <p className="yb-muted" style={{ marginTop: 0, marginBottom: 24 }}>
          Regular-season records computed from the same warehouse that answers search.
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
          <div className="yb-card">
            <BoardSkeleton />
          </div>
        )}

        {!loading && !error && data && data.rows.length === 0 && (
          <div className="yb-state">
            <div className="yb-glyph" aria-hidden="true">
              🏈
            </div>
            <h2>No games for this season yet</h2>
            <p>There&apos;s no team data ingested for {data.season}. Try another season.</p>
          </div>
        )}

        {data && data.rows.length > 0 && (
          <div className="yb-card">
            <StandingsTable rows={data.rows} />
          </div>
        )}
      </main>
    </>
  );
}
