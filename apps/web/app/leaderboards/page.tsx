"use client";

import { useEffect, useState } from "react";

import { BarChart } from "../components/BarChart";
import { Nav } from "../components/Nav";
import { BoardSkeleton } from "../components/Skeleton";
import { fetchLeaderboards, type LeaderboardsResponse } from "../lib/api";

export default function LeaderboardsPage() {
  const [data, setData] = useState<LeaderboardsResponse | null>(null);
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchLeaderboards(season, 10)
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
      <main id="main" style={{ maxWidth: 980, margin: "0 auto", padding: "40px 20px 120px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
            Leaderboards
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
          Season leaders across the board — the same warehouse that powers search.
        </p>

        {error && (
          <div className="yb-state error" role="alert">
            <div className="yb-glyph" aria-hidden="true">
              ⚠️
            </div>
            <h2>Couldn&apos;t load leaderboards</h2>
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && data && data.boards.every((b) => b.rows.length === 0) && (
          <div className="yb-state">
            <div className="yb-glyph" aria-hidden="true">
              📊
            </div>
            <h2>No leaders for this season yet</h2>
            <p>There&apos;s no data ingested for {data.season}. Try another season.</p>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
            gap: 20,
          }}
        >
          {loading && !data
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="yb-card">
                  <BoardSkeleton />
                </div>
              ))
            : data?.boards
                .filter((board) => board.rows.length > 0)
                .map((board) => (
                <div key={board.key} className="yb-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{board.label}</h2>
                    {board.rows[0] && (
                      <span className="yb-muted" style={{ fontSize: 13 }}>
                        {board.rows[0].name}
                      </span>
                    )}
                  </div>
                  <BarChart
                    data={board.rows.slice(0, 8).map((r) => ({ label: r.name, value: r.value }))}
                    unit={board.unit}
                  />
                </div>
              ))}
        </div>
      </main>
    </>
  );
}
