"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { GameCard } from "./GameCard";
import { Headshot } from "./Headshot";
import { Performers } from "./Performers";
import { TeamLogo } from "./TeamLogo";
import {
  fetchExamples,
  fetchFantasyPlayers,
  fetchGames,
  fetchLeaderboards,
  fetchPerformers,
  fetchStandings,
  type ConferenceStandings,
  type FantasyPlayersResponse,
  type GameRow,
  type GamesResponse,
  type LeaderboardsResponse,
  type PerformersResponse,
  type StandingsResponse,
} from "../lib/api";
import { formatRecord, formatStatValue } from "../lib/format";
import { seedConference } from "../lib/playoff";
import { NFL_TEAM_NAMES, teamTheme } from "../lib/teamTheme";

/** The NFL homepage below the search bar and score ticker. One data pass feeds
 *  every panel in the recommended order: featured matchup, performers, division
 *  leaders, league leaders, fantasy leaders, playoff picture, trending questions
 *  and team shortcuts. Each panel is a doorway into its full route, and every
 *  player, team and game is clickable. Panels render independently, so one dead
 *  endpoint never blanks the rest of the page. */
export function HomeDashboard() {
  const [games, setGames] = useState<GamesResponse | null>(null);
  const [performers, setPerformers] = useState<PerformersResponse | null>(null);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [fantasy, setFantasy] = useState<FantasyPlayersResponse | null>(null);
  const [boards, setBoards] = useState<LeaderboardsResponse | null>(null);
  const [examples, setExamples] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetchGames(),
      fetchPerformers(undefined, undefined, 4),
      fetchStandings(),
      fetchFantasyPlayers(),
      fetchLeaderboards(undefined, 5),
      fetchExamples(8),
    ]).then(([g, p, s, f, b, e]) => {
      if (!active) return;
      if (g.status === "fulfilled") setGames(g.value);
      if (p.status === "fulfilled") setPerformers(p.value);
      if (s.status === "fulfilled") setStandings(s.value);
      if (f.status === "fulfilled") setFantasy(f.value);
      if (b.status === "fulfilled") setBoards(b.value);
      setExamples(e.status === "fulfilled" ? e.value : []);
    });
    return () => {
      active = false;
    };
  }, []);

  const featured = games ? pickFeatured(games.games) : null;

  return (
    <div className="yb-dash">
      {/* 4 — Featured matchup: a live game if any, else the week's headline final. */}
      {featured && (
        <section aria-label="Featured matchup">
          <div className="yb-dash-head">
            <h2>Featured matchup</h2>
            <Link href="/scores">All scores →</Link>
          </div>
          <div className="yb-featured">
            <GameCard game={featured} />
          </div>
        </section>
      )}

      {/* 5 — Performers of the week */}
      <section aria-label="Performers of the week">
        <div className="yb-dash-head">
          <h2>Performers of the week</h2>
          <Link href="/scores">Full board →</Link>
        </div>
        <Performers performers={performers?.performers ?? null} loading={!performers} count={4} />
      </section>

      {/* 6 — Division leaders, split by conference */}
      <section aria-label="Division leaders">
        <div className="yb-dash-head">
          <h2>Division leaders</h2>
          <span className="yb-dash-links">
            <Link href="/standings">Standings</Link>
            <Link href="/teams">All teams →</Link>
          </span>
        </div>
        {standings ? (
          <div className="yb-dash-grid">
            {standings.conferences.map((conf) => (
              <DivisionTable key={conf.conference} conf={conf} />
            ))}
          </div>
        ) : (
          <div className="yb-skel" style={{ height: 220 }} />
        )}
      </section>

      {/* 7 — League leaders: one compact card, every category, #1 in an accent pill */}
      <section className="yb-card" aria-label="League leaders">
        <div className="yb-dash-head">
          <h2>League leaders</h2>
          <Link href="/leaders">Live leaderboards →</Link>
        </div>
        {boards ? (
          <div className="yb-lead-groups">
            {boards.boards
              .filter((b) => b.rows.length > 0)
              .slice(0, 6)
              .map((b) => (
                <div key={b.key} className="yb-lead-group">
                  <span className="yb-lead-cat">{b.label}</span>
                  <ol className="yb-lead-list">
                    {b.rows.slice(0, 3).map((r, i) => (
                      <li key={r.player_id} className={`yb-lead-row${i === 0 ? " is-leader" : ""}`} style={i === 0 ? teamTheme(r.team) : undefined}>
                        {i === 0 ? (
                          <span className="yb-lead-pill">{formatStatValue(r.value)}</span>
                        ) : (
                          <span className="yb-lead-val">{formatStatValue(r.value)}</span>
                        )}
                        <Link
                          className="nm"
                          href={`/players/${encodeURIComponent(r.player_id)}?season=${boards.season}`}
                        >
                          {r.name}
                        </Link>
                        <span className="tm">{r.team}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
          </div>
        ) : (
          <div className="yb-skel" style={{ height: 260 }} />
        )}
      </section>

      {/* 8 — Fantasy leaders */}
      <section className="yb-card" aria-label="Top fantasy performers">
        <div className="yb-dash-head">
          <h2>Fantasy leaders</h2>
          <Link href="/fantasy">Build a lineup →</Link>
        </div>
        {fantasy ? (
          <div className="yb-scroll-x">
            <table className="yb-mini-table">
              <tbody>
                {fantasy.players.slice(0, 8).map((p, i) => (
                  <tr key={p.player_id} className="yb-team-row" style={teamTheme(p.team)}>
                    <td className="dim num" style={{ width: 24 }}>
                      {i + 1}
                    </td>
                    <td>
                      <Link
                        href={`/players/${encodeURIComponent(p.player_id)}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                      >
                        <Headshot src={p.headshot_url} name={p.name} scale="compact" />
                        {p.name}
                      </Link>
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
          </div>
        ) : (
          <div className="yb-skel" style={{ height: 300 }} />
        )}
        <div className="yb-dash-foot">
          <span className="yb-muted" style={{ fontSize: 13 }}>
            Not sure who to start?
          </span>
          <Link className="yb-btn sm" href="/assistant">
            Ask the Fantasy Assistant
          </Link>
        </div>
      </section>

      {/* 9 — Playoff picture, seeded per conference */}
      <section aria-label="Playoff picture">
        <div className="yb-dash-head">
          <h2>Playoff picture</h2>
          <Link href="/standings">Full standings →</Link>
        </div>
        {standings ? (
          <div className="yb-dash-grid">
            {standings.conferences.map((conf) => (
              <PlayoffColumn key={conf.conference} conf={conf} />
            ))}
          </div>
        ) : (
          <div className="yb-skel" style={{ height: 220 }} />
        )}
      </section>

      {/* 10 — Trending questions: tap to run the question in the search above */}
      {examples && examples.length > 0 && (
        <section aria-label="Trending questions">
          <div className="yb-dash-head">
            <h2>Trending questions</h2>
          </div>
          <div className="yb-trending-list">
            {examples.map((q) => (
              <button
                key={q}
                type="button"
                className="yb-chip"
                onClick={() => window.dispatchEvent(new CustomEvent("yb:ask", { detail: q }))}
              >
                {q}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 11 — Browse teams: all 32, straight to each team page */}
      <section aria-label="Browse teams">
        <div className="yb-dash-head">
          <h2>Browse teams</h2>
          <Link href="/teams">All teams →</Link>
        </div>
        <div className="yb-team-shortcuts">
          {Object.entries(NFL_TEAM_NAMES).map(([id, name]) => (
            <Link key={id} className="yb-team-shortcut" href={`/teams/${id}`} style={teamTheme(id)}>
              <TeamLogo team={id} size={30} />
              <span className="who">
                <span className="ab">{id}</span>
                <span className="nk">{name}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Live game if one is in progress, else the highest-scoring final of the
 *  week, else the first scheduled game. */
function pickFeatured(games: GameRow[]): GameRow | null {
  if (games.length === 0) return null;
  const live = games.find((g) => !g.final && (g.home.score !== null || g.away.score !== null));
  if (live) return live;
  const finals = games.filter((g) => g.final);
  if (finals.length > 0) {
    return finals.reduce((best, g) => {
      const t = (g.home.score ?? 0) + (g.away.score ?? 0);
      const bt = (best.home.score ?? 0) + (best.away.score ?? 0);
      return t > bt ? g : best;
    });
  }
  return games[0]!;
}

/** One conference's four division leaders. */
function DivisionTable({ conf }: { conf: ConferenceStandings }) {
  return (
    <div className="yb-card">
      <div className="yb-dash-head">
        <h2 style={{ fontSize: 15 }}>{conf.conference}</h2>
      </div>
      <table className="yb-mini-table">
        <tbody>
          {conf.divisions.map((d) => {
            const team = d.teams[0]!;
            return (
              <tr key={d.division} className="yb-team-row" style={teamTheme(team.team_id)}>
                <td className="dim">{d.division}</td>
                <td>
                  <Link
                    href={`/teams/${team.team_id}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                  >
                    <TeamLogo team={team.team_id} size={22} />
                    {team.nickname ?? team.name}
                  </Link>
                </td>
                <td className="num">{formatRecord(team.wins, team.losses, team.ties)}</td>
                <td className={`num ${streakClass(team.streak)}`}>{team.streak}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One conference's projected seven-team playoff field (see lib/playoff). */
function PlayoffColumn({ conf }: { conf: ConferenceStandings }) {
  return (
    <div className="yb-card">
      <div className="yb-dash-head">
        <h2 style={{ fontSize: 15 }}>{conf.conference}</h2>
        <span className="yb-muted" style={{ fontSize: 12 }}>
          projected
        </span>
      </div>
      <table className="yb-mini-table">
        <tbody>
          {seedConference(conf).map(({ team, seed, kind }) => (
            <tr key={team.team_id} className="yb-team-row" style={teamTheme(team.team_id)}>
              <td className="dim num" style={{ width: 20 }}>
                {seed}
              </td>
              <td>
                <Link
                  href={`/teams/${team.team_id}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  <TeamLogo team={team.team_id} size={22} />
                  {team.nickname ?? team.name}
                </Link>
              </td>
              <td className="dim">{kind === "wc" ? "WC" : "Div"}</td>
              <td className="num">{formatRecord(team.wins, team.losses, team.ties)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function streakClass(streak: string): string {
  if (streak.startsWith("W")) return "yb-streak-w";
  if (streak.startsWith("L")) return "yb-streak-l";
  return "";
}
