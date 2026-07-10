"use client";

import { useEffect, useState } from "react";

import { Headshot } from "./Headshot";
import { Performers } from "./Performers";
import { TeamLogo } from "./TeamLogo";
import {
  fetchFantasyPlayers,
  fetchPerformers,
  fetchStandings,
  type FantasyPlayersResponse,
  type PerformersResponse,
  type StandingsResponse,
} from "../lib/api";

/** The sports-platform front page below the ticker: performers of the week,
 *  the standings picture and the top fantasy performers. Every panel is a
 *  doorway into its full page. */
export function HomeDashboard() {
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [fantasy, setFantasy] = useState<FantasyPlayersResponse | null>(null);
  const [performers, setPerformers] = useState<PerformersResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetchStandings(),
      fetchFantasyPlayers(),
      fetchPerformers(undefined, undefined, 4),
    ]).then(([s, f, p]) => {
      if (!active) return;
      if (s.status === "fulfilled") setStandings(s.value);
      if (f.status === "fulfilled") setFantasy(f.value);
      if (p.status === "fulfilled") setPerformers(p.value);
      setFailed(
        s.status === "rejected" && f.status === "rejected" && p.status === "rejected",
      );
    });
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null; // API down — the hero search still explains itself

  const leaders = standings?.conferences.flatMap((c) =>
    c.divisions.map((d) => ({ division: d.division, team: d.teams[0]! })),
  );
  const topFantasy = fantasy?.players.slice(0, 6);

  return (
    <div className="yb-dash">
      {/* Performers of the week */}
      <section aria-label="Performers of the week">
        <div className="yb-dash-head">
          <h2>Performers of the week</h2>
          <a href="/scores">Full board →</a>
        </div>
        <Performers performers={performers?.performers ?? null} loading={!performers} count={4} />
      </section>

      <div className="yb-dash-grid">
        {/* Division leaders */}
        <section className="yb-card" aria-label="Division leaders">
          <div className="yb-dash-head">
            <h2>Division leaders</h2>
            <a href="/teams">All teams →</a>
          </div>
          {leaders ? (
            <table className="yb-mini-table">
              <tbody>
                {leaders.map(({ division, team }) => (
                  <tr key={division}>
                    <td className="dim">{division}</td>
                    <td>
                      <a
                        href={`/teams/${team.team_id}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                      >
                        <TeamLogo team={team.team_id} size={18} />
                        {team.nickname ?? team.name}
                      </a>
                    </td>
                    <td className="num">
                      {team.wins}-{team.losses}
                      {team.ties ? `-${team.ties}` : ""}
                    </td>
                    <td
                      className={`num ${
                        team.streak.startsWith("W")
                          ? "yb-streak-w"
                          : team.streak.startsWith("L")
                            ? "yb-streak-l"
                            : ""
                      }`}
                    >
                      {team.streak}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="yb-skel" style={{ height: 300 }} />
          )}
        </section>

        {/* Fantasy leaders */}
        <section className="yb-card" aria-label="Top fantasy performers">
          <div className="yb-dash-head">
            <h2>Fantasy leaders</h2>
            <a href="/fantasy">Build a lineup →</a>
          </div>
          {topFantasy ? (
            <table className="yb-mini-table">
              <tbody>
                {topFantasy.map((p, i) => (
                  <tr key={p.player_id}>
                    <td className="dim num" style={{ width: 24 }}>
                      {i + 1}
                    </td>
                    <td>
                      <a
                        href={`/players/${encodeURIComponent(p.player_id)}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                      >
                        <Headshot src={p.headshot_url} name={p.name} size={26} />
                        {p.name}
                      </a>
                    </td>
                    <td>
                      <span className={`yb-pos ${p.position ?? ""}`}>{p.position}</span>
                    </td>
                    <td className="num strong">{p.points_per_game.toFixed(1)}</td>
                    <td className="dim num">pts/gm</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="yb-skel" style={{ height: 300 }} />
          )}

          <div className="yb-dash-foot">
            <span className="yb-muted" style={{ fontSize: 13 }}>
              Not sure who to start?
            </span>
            <a className="yb-btn sm" href="/assistant">
              Ask the Fantasy Assistant
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
