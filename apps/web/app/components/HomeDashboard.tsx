"use client";

import { useEffect, useState } from "react";

import { Headshot } from "./Headshot";
import {
  fetchFantasyPlayers,
  fetchGames,
  fetchStandings,
  type FantasyPlayersResponse,
  type GamesResponse,
  type StandingsResponse,
} from "../lib/api";

/** The sports-platform front page: latest scores, the standings picture and
 *  the top fantasy performers — every panel a doorway into its full page. */
export function HomeDashboard() {
  const [games, setGames] = useState<GamesResponse | null>(null);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [fantasy, setFantasy] = useState<FantasyPlayersResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.allSettled([fetchGames(), fetchStandings(), fetchFantasyPlayers()]).then(
      ([g, s, f]) => {
        if (!active) return;
        if (g.status === "fulfilled") setGames(g.value);
        if (s.status === "fulfilled") setStandings(s.value);
        if (f.status === "fulfilled") setFantasy(f.value);
        setFailed(g.status === "rejected" && s.status === "rejected" && f.status === "rejected");
      },
    );
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
      {/* This week's finals */}
      <section aria-label="Latest scores">
        <div className="yb-dash-head">
          <h2>
            {games ? `Week ${games.week} · ${games.season}` : "This week"}
          </h2>
          <a href="/scores">All scores →</a>
        </div>
        <div className="yb-strip">
          {games
            ? games.games.map((g) => {
                const homeWon = (g.home.score ?? 0) > (g.away.score ?? 0);
                return (
                  <a key={g.game_id} className="yb-strip-card" href="/scores">
                    <span className={`row${homeWon ? "" : " win"}`}>
                      <span>{g.away.team_id}</span>
                      <span className="pts">{g.away.score}</span>
                    </span>
                    <span className={`row${homeWon ? " win" : ""}`}>
                      <span>{g.home.team_id}</span>
                      <span className="pts">{g.home.score}</span>
                    </span>
                    <span className="tag">{g.final ? "Final" : "—"}</span>
                  </a>
                );
              })
            : Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="yb-skel yb-strip-card" style={{ height: 86 }} />
              ))}
        </div>
      </section>

      <div className="yb-dash-grid">
        {/* Division leaders */}
        <section className="yb-card" aria-label="Division leaders">
          <div className="yb-dash-head">
            <h2>Division leaders</h2>
            <a href="/standings">Standings →</a>
          </div>
          {leaders ? (
            <table className="yb-mini-table">
              <tbody>
                {leaders.map(({ division, team }) => (
                  <tr key={division}>
                    <td className="dim">{division}</td>
                    <td>{team.nickname ?? team.name}</td>
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
