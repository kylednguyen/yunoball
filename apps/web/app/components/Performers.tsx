"use client";

import Link from "next/link";
import { Headshot } from "./Headshot";
import type { Performer } from "../lib/api";
import { teamTheme } from "../lib/teamTheme";

/** Performers of the week: the top calculated fantasy player(s) for a week,
 *  each shown with headshot, PPR total and full stat line. */
export function Performers({
  performers,
  loading,
  count = 5,
}: {
  performers: Performer[] | null;
  loading?: boolean;
  count?: number;
}) {
  if (loading && !performers) {
    return (
      <ol className="yb-performers">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="yb-skel" style={{ height: 64, borderRadius: "var(--r-xl)" }} />
        ))}
      </ol>
    );
  }
  // The section heading renders above this component — an empty week needs a
  // line under it, not a silent gap.
  if (!performers || performers.length === 0) {
    return <p className="yb-muted">No completed games this week yet.</p>;
  }

  const top = performers[0]!;
  const rest = performers.slice(1, count);

  return (
    <div className="yb-performers-wrap">
      {/* Player of the week — the single best calculated fantasy line. */}
      <Link
        className="yb-potw"
        href={`/players/${encodeURIComponent(top.player_id)}`}
        aria-label={`Player of the week: ${top.name}`}
        style={teamTheme(top.team)}
      >
        <Headshot src={top.headshot_url} name={top.name} scale="feature" />
        <div className="yb-potw-body">
          <span className="yb-potw-tag">Player of the Week</span>
          <span className="yb-potw-name">
            <span className="t">{top.name}</span>
          </span>
          <span className="yb-potw-line">{top.stat_line}</span>
        </div>
        <div className="yb-potw-pts">
          <span className="n">{top.fantasy_points_ppr.toFixed(1)}</span>
          <span className="u">PPR</span>
        </div>
      </Link>

      <ol className="yb-performers">
        {rest.map((p) => (
          <li key={p.player_id}>
            <Link
              className="yb-performer"
              href={`/players/${encodeURIComponent(p.player_id)}`}
              style={teamTheme(p.team)}
            >
              <span className="rk">{p.rank}</span>
              <Headshot src={p.headshot_url} name={p.name} scale="row" />
              <span className="who">
                <span className="nm">
                  <span className="t">{p.name}</span>
                </span>
                <span className="ln">{p.stat_line}</span>
              </span>
              <span className="pts">{p.fantasy_points_ppr.toFixed(1)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
