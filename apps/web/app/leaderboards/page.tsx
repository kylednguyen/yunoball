"use client";

import { useEffect, useMemo, useState } from "react";

import { Nav } from "../components/Nav";
import { BoardSkeleton } from "../components/Skeleton";
import { fetchLeaderboards, type LeaderboardsResponse } from "../lib/api";

/**
 * Leaderboards as dense, scannable stat tables — the native format for sports
 * numbers — rather than charts: exact values, tabular alignment, rank order.
 */
export default function LeaderboardsPage() {
  const [data, setData] = useState<LeaderboardsResponse | null>(null);
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchLeaderboards(season, 10)
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

  const boards = useMemo(() => (data?.boards ?? []).filter((b) => b.rows.length > 0), [data]);
  const board = boards.find((b) => b.key === activeKey) ?? boards[0];

  const formatValue = (v: number) =>
    Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);

  return (
    <>
      <Nav />
      <main id="main" className="yb-page" style={{ maxWidth: 980 }}>
        <div className="yb-page-head">
          <h1 className="yb-page-title">Leaderboards</h1>
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

        {!loading && !error && data && boards.length === 0 && (
          <div className="yb-state">
            <div className="yb-glyph" aria-hidden="true">
              📊
            </div>
            <h2>No leaders for this season yet</h2>
            <p>There&apos;s no data ingested for {data.season}. Try another season.</p>
          </div>
        )}

        {loading && !data && (
          <div className="yb-card">
            <BoardSkeleton />
          </div>
        )}

        {boards.length > 0 && board && (
          <>
            {/* Who leads what — one tile per category, exact value up front. */}
            <div className="yb-tiles">
              {boards.map((b) => (
                <button
                  key={b.key}
                  className="yb-tile"
                  onClick={() => setActiveKey(b.key)}
                  style={{
                    cursor: "pointer",
                    textAlign: "left",
                    font: "inherit",
                    color: "inherit",
                    borderColor: b.key === board.key ? "var(--accent)" : undefined,
                  }}
                >
                  <div className="yb-tile-label">{b.label}</div>
                  <div className="yb-tile-value" style={{ fontSize: 20 }}>
                    {formatValue(b.rows[0]!.value)}
                    <span className="yb-lb-unit"> {b.unit}</span>
                  </div>
                  <div className="yb-tile-meta">{b.rows[0]!.name}</div>
                </button>
              ))}
            </div>

            <div className="yb-tabs" role="tablist" aria-label="Stat category">
              {boards.map((b) => (
                <button
                  key={b.key}
                  role="tab"
                  aria-selected={b.key === board.key}
                  className="yb-tab"
                  onClick={() => setActiveKey(b.key)}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div
              className="yb-table-scroll"
              role="tabpanel"
              aria-label={board.label}
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              <table className="yb-table">
                <thead>
                  <tr>
                    <th className="num" style={{ width: 48 }}>
                      #
                    </th>
                    <th>Player</th>
                    <th>Team</th>
                    <th className="num">{board.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((r) => (
                    <tr key={`${r.rank}-${r.name}`} className={r.rank === 1 ? "yb-div-leader" : undefined}>
                      <td className="num">{r.rank}</td>
                      <td>
                        <a href={`/players/${encodeURIComponent(r.player_id)}`} style={{ color: "inherit" }}>
                          {r.name}
                        </a>
                      </td>
                      <td style={{ color: "var(--muted)", fontWeight: 400 }}>{r.team ?? "—"}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {formatValue(r.value)}
                        <span className="yb-lb-unit"> {board.unit}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </>
  );
}
