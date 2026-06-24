"use client";

import { useEffect, useState } from "react";

import { BarChart } from "../components/BarChart";
import { Nav } from "../components/Nav";
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
    <main className="wrap">
      <Nav />
      <div className="page-head">
        <h1>Leaderboards</h1>
        {data && (
          <div className="seasons" role="tablist" aria-label="Season">
            {data.seasons.map((s) => (
              <button
                key={s}
                className={s === data.season ? "active" : ""}
                onClick={() => setSeason(s)}
                aria-selected={s === data.season}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <p className="thinking">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {data?.boards.map((board) => (
        <section key={board.key} className="board">
          <h2>{board.label}</h2>
          <BarChart
            data={board.rows.map((r) => ({ label: r.name, value: r.value }))}
            unit={board.unit}
          />
        </section>
      ))}
    </main>
  );
}
