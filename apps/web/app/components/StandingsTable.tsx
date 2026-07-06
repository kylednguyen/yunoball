"use client";

import type { StandingRow } from "../lib/api";

/** Standings as a proper table — W/L/T, points, differential, win pct.
 *  `compact` trims to the top rows and hides the volume columns. */
export function StandingsTable({
  rows,
  compact = false,
}: {
  rows: StandingRow[];
  compact?: boolean;
}) {
  const shown = compact ? rows.slice(0, 6) : rows;
  return (
    <div className="yb-table-scroll">
      <table className="yb-table yb-standings">
        <thead>
          <tr>
            <th scope="col" className="num">
              #
            </th>
            <th scope="col">Team</th>
            <th scope="col" className="num">
              W
            </th>
            <th scope="col" className="num">
              L
            </th>
            <th scope="col" className="num">
              T
            </th>
            <th scope="col" className="num">
              Pct
            </th>
            {!compact && (
              <>
                <th scope="col" className="num">
                  PF
                </th>
                <th scope="col" className="num">
                  PA
                </th>
              </>
            )}
            <th scope="col" className="num">
              Diff
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.team_id}>
              <td className="num yb-faint">{r.rank}</td>
              <td>
                <span className="yb-team-abbr" aria-hidden="true">
                  {r.team_id}
                </span>
                {r.team}
              </td>
              <td className="num">{r.wins}</td>
              <td className="num">{r.losses}</td>
              <td className="num">{r.ties}</td>
              <td className="num">{r.pct.toFixed(3).replace(/^0/, "")}</td>
              {!compact && (
                <>
                  <td className="num">{r.points_for}</td>
                  <td className="num">{r.points_against}</td>
                </>
              )}
              <td className={`num ${r.diff > 0 ? "yb-pos" : r.diff < 0 ? "yb-neg" : ""}`}>
                {r.diff > 0 ? `+${r.diff}` : r.diff}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
