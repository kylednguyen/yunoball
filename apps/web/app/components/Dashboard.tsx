"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  fetchLeaderboards,
  fetchStandings,
  type LeaderboardsResponse,
  type StandingsResponse,
} from "../lib/api";
import { StandingsTable } from "./StandingsTable";

/** Landing-page dashboard: stat tiles, live leaderboard modules, and a
 *  standings snapshot — all from the same warehouse that answers search.
 *  Progressive enhancement: if the API is unreachable it renders nothing
 *  rather than an error wall (search still reports its own errors). */

const TILE_KEYS = ["passing_yards", "rushing_yards", "receiving_yards", "passing_tds"];
const MODULE_KEYS = ["passing_tds", "receiving_yards"];

function askQuestion(q: string) {
  window.dispatchEvent(new CustomEvent("yb:ask", { detail: q }));
}

export function Dashboard() {
  const [boards, setBoards] = useState<LeaderboardsResponse | null>(null);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([fetchLeaderboards(undefined, 5), fetchStandings()])
      .then(([b, s]) => {
        if (!active) return;
        setBoards(b);
        setStandings(s);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null;

  const season = boards?.season;
  const tiles =
    boards?.boards
      .filter((b) => TILE_KEYS.includes(b.key) && b.rows.length > 0)
      .sort((a, b) => TILE_KEYS.indexOf(a.key) - TILE_KEYS.indexOf(b.key)) ?? [];
  const modules =
    boards?.boards.filter((b) => MODULE_KEYS.includes(b.key) && b.rows.length > 0) ?? [];

  return (
    <div className="yb-dash">
      {/* ---- Season-at-a-glance stat tiles ---- */}
      {tiles.length > 0 && (
        <section className="yb-dash-section" aria-label="Season leaders at a glance">
          <div className="yb-dash-head">
            <h2 className="yb-dash-title">{season} at a glance</h2>
            <Link className="yb-dash-more" href="/leaderboards">
              All leaderboards →
            </Link>
          </div>
          <div className="yb-tiles">
            {tiles.map((b) => {
              const top = b.rows[0];
              if (!top) return null;
              return (
                <button
                  key={b.key}
                  className="yb-tile"
                  onClick={() => askQuestion(`Most ${b.label.toLowerCase()} in ${season}`)}
                  title={`Ask: most ${b.label.toLowerCase()} in ${season}`}
                >
                  <span className="yb-tile-label">{b.label} leader</span>
                  <span className="yb-tile-value">
                    {top.value.toLocaleString()}
                    <span className="yb-tile-unit"> {b.unit}</span>
                  </span>
                  <span className="yb-tile-who">
                    {top.name}
                    {top.team ? <span className="yb-tile-team"> · {top.team}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- Standings snapshot + live top-5 modules ---- */}
      {(standings || modules.length > 0) && (
        <section className="yb-modules" aria-label="Standings and leaders">
          {standings && standings.rows.length > 0 && (
            <div className="yb-card yb-module">
              <div className="yb-dash-head">
                <h2 className="yb-dash-title">Standings · {standings.season}</h2>
                <Link className="yb-dash-more" href="/standings">
                  Full standings →
                </Link>
              </div>
              <StandingsTable rows={standings.rows} compact />
            </div>
          )}

          {modules.map((b) => {
            const max = Math.max(...b.rows.map((r) => r.value)) || 1;
            return (
              <div key={b.key} className="yb-card yb-module">
                <div className="yb-dash-head">
                  <h2 className="yb-dash-title">
                    {b.label} · {season}
                  </h2>
                  <Link className="yb-dash-more" href="/leaderboards">
                    More →
                  </Link>
                </div>
                <ol className="yb-mini-lb">
                  {b.rows.map((r, i) => (
                    <li key={r.name}>
                      <button
                        className="yb-mini-row"
                        onClick={() =>
                          askQuestion(`${r.name} ${b.label.toLowerCase()} in ${season}`)
                        }
                        title={`Ask about ${r.name}`}
                      >
                        <span className="yb-mini-rank">{i + 1}</span>
                        <span className="yb-mini-name">
                          {r.name}
                          {r.team ? <span className="yb-mini-team"> {r.team}</span> : null}
                        </span>
                        <span className="yb-mini-track" aria-hidden="true">
                          <span
                            className="yb-mini-fill"
                            style={{ width: `${(r.value / max) * 100}%` }}
                          />
                        </span>
                        <span className="yb-mini-value">{r.value.toLocaleString()}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
