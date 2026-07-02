"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Avatar } from "../components/Avatar";
import { Nav } from "../components/Nav";
import { fetchLeaderboards, type Leaderboard, type LeaderboardsResponse } from "../lib/api";

function fmtValue(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

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
    <main className="wrap wrap-wide">
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

      {loading && !data && (
        <div className="leader-grid" style={{ marginTop: 24 }} aria-busy>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton skeleton-leader" aria-hidden />
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {data && (
        <div className="board-grid" style={loading ? { opacity: 0.55 } : undefined}>
          {data.boards.map((board) => (
            <BoardTable key={board.key} board={board} season={data.season} />
          ))}
        </div>
      )}
    </main>
  );
}

function BoardTable({ board, season }: { board: Leaderboard; season: number }) {
  return (
    <article className="board-card">
      <header>
        <h2>{board.label}</h2>
        <span className="board-unit">{board.unit}</span>
      </header>
      <table className="board-table">
        <tbody>
          {board.rows.map((r) => (
            <tr key={r.rank}>
              <td className="lr-rank">{r.rank}</td>
              <td className="board-player">
                <Link
                  href={`/?q=${encodeURIComponent(`${r.name} ${board.label.toLowerCase()} in ${season}`)}`}
                >
                  <Avatar name={r.name} team={r.team} headshotUrl={r.headshot_url} size={28} />
                  {r.name}
                </Link>
              </td>
              <td className="lr-team">{r.team ?? ""}</td>
              <td className="num">{fmtValue(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
