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
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "48px 20px 120px" }}>
      <Nav />
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 32, margin: 0 }}>Leaderboards</h1>
        {data && (
          <select
            value={data.season}
            onChange={(e) => setSeason(Number(e.target.value))}
            style={{
              background: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 14,
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

      {loading && <p style={{ color: "var(--muted)" }}>Loading…</p>}
      {error && <p style={{ color: "#f87171" }}>{error}</p>}

      {data?.boards.map((board) => (
        <section key={board.key} style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>{board.label}</h2>
          <BarChart
            data={board.rows.map((r) => ({ label: r.name, value: r.value }))}
            unit={board.unit}
          />
        </section>
      ))}
    </main>
  );
}
