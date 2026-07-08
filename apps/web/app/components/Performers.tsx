"use client";

import { Headshot } from "./Headshot";
import type { Performer } from "../lib/api";

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
          <li key={i} className="yb-skel" style={{ height: 64, borderRadius: 12 }} />
        ))}
      </ol>
    );
  }
  if (!performers || performers.length === 0) return null;

  const top = performers[0]!;
  const rest = performers.slice(1, count);

  return (
    <div className="yb-performers-wrap">
      {/* Player of the week — the single best calculated fantasy line. */}
      <a
        className="yb-potw"
        href={`/players/${encodeURIComponent(top.player_id)}`}
        aria-label={`Player of the week: ${top.name}`}
      >
        <Headshot src={top.headshot_url} name={top.name} size={64} />
        <div className="yb-potw-body">
          <span className="yb-potw-tag">Player of the week</span>
          <span className="yb-potw-name">
            {top.name}
            <span className={`yb-pos ${top.position ?? ""}`}>{top.position}</span>
          </span>
          <span className="yb-potw-line">
            {top.team} vs {top.opponent} · {top.stat_line}
          </span>
        </div>
        <div className="yb-potw-pts">
          <span className="n">{top.fantasy_points_ppr.toFixed(1)}</span>
          <span className="u">PPR</span>
        </div>
      </a>

      <ol className="yb-performers">
        {rest.map((p) => (
          <li key={p.player_id}>
            <a className="yb-performer" href={`/players/${encodeURIComponent(p.player_id)}`}>
              <span className="rk">{p.rank}</span>
              <Headshot src={p.headshot_url} name={p.name} size={34} />
              <span className="who">
                <span className="nm">
                  {p.name}
                  <span className={`yb-pos ${p.position ?? ""}`}>{p.position}</span>
                </span>
                <span className="ln">
                  vs {p.opponent} · {p.stat_line}
                </span>
              </span>
              <span className="pts">{p.fantasy_points_ppr.toFixed(1)}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
