"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchLeaderboards, type Leaderboard, type LeaderboardsResponse } from "../lib/api";
import { Avatar } from "./Avatar";

function fmtValue(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function questionFor(name: string, board: Leaderboard, season: number): string {
  return `${name} ${board.label.toLowerCase()} in ${season}`;
}

/** Home-page dashboard: current-season league leaders, every row tappable. */
export function Leaders({ onAsk }: { onAsk: (q: string) => void }) {
  const [data, setData] = useState<LeaderboardsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchLeaderboards(undefined, 5)
      .then((d) => active && setData(d))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null;

  if (!data) {
    return (
      <section className="leaders" aria-busy>
        <div className="section-head">
          <h2>League leaders</h2>
        </div>
        <div className="leader-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton skeleton-leader" aria-hidden />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="leaders">
      <div className="section-head">
        <h2>{data.season} league leaders</h2>
        <Link href="/leaderboards" className="see-all">
          All leaderboards
        </Link>
      </div>
      <div className="leader-grid">
        {data.boards.map((board) => (
          <LeaderCard key={board.key} board={board} season={data.season} onAsk={onAsk} />
        ))}
      </div>
    </section>
  );
}

function LeaderCard({
  board,
  season,
  onAsk,
}: {
  board: Leaderboard;
  season: number;
  onAsk: (q: string) => void;
}) {
  const [first, ...rest] = board.rows;
  if (!first) return null;

  return (
    <article className="leader-card">
      <h3>{board.label}</h3>
      <button
        className="leader-hero"
        onClick={() => onAsk(questionFor(first.name, board, season))}
      >
        <Avatar name={first.name} team={first.team} headshotUrl={first.headshot_url} size={52} />
        <span className="lh-who">
          <span className="lh-name">{first.name}</span>
          <span className="lh-team">{first.team ?? ""}</span>
        </span>
        <span className="lh-value">
          {fmtValue(first.value)}
          <span className="lh-unit">{board.unit}</span>
        </span>
      </button>
      <ol className="leader-rows" start={2}>
        {rest.map((r) => (
          <li key={r.rank}>
            <button onClick={() => onAsk(questionFor(r.name, board, season))}>
              <span className="lr-rank">{r.rank}</span>
              <Avatar name={r.name} team={r.team} headshotUrl={r.headshot_url} size={26} />
              <span className="lr-name">{r.name}</span>
              <span className="lr-team">{r.team ?? ""}</span>
              <span className="lr-value">{fmtValue(r.value)}</span>
            </button>
          </li>
        ))}
      </ol>
    </article>
  );
}
