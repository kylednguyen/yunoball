"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  type ExampleQuestion,
  type FantasyPlayersResponse,
  type GameRow,
  type GamesResponse,
  type LeaderboardsResponse,
  type PerformersResponse,
  type StandingsResponse,
} from "../lib/api";
import { divisionShortName, formatGameDate, formatRecord, formatStatValue, weekLabel } from "../lib/format";
import { seedConference } from "../lib/playoff";
import { teamTheme } from "../lib/teamTheme";

/** The NFL homepage below the search bar and score ticker. One data pass feeds
 *  every card: featured matchup, performers, division leaders, league leaders,
 *  fantasy leaders, playoff picture and trending questions. Each card is a
 *  doorway into its full route; panels render independently so one dead
 *  endpoint never blanks the rest of the page. */
export function HomeDashboard() {
  const [games, setGames] = useState<GamesResponse | null>(null);
  const [performers, setPerformers] = useState<PerformersResponse | null>(null);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [fantasy, setFantasy] = useState<FantasyPlayersResponse | null>(null);
  const [boards, setBoards] = useState<LeaderboardsResponse | null>(null);
  const [examples, setExamples] = useState<ExampleQuestion[] | null>(null);
  // A failed fetch must degrade to an error line, never an eternal skeleton.
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [divConf, setDivConf] = useState("AFC");
  const [playoffConf, setPlayoffConf] = useState("AFC");

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetchGames(),
      fetchPerformers(undefined, undefined, 4),
      fetchStandings(),
      fetchFantasyPlayers(),
      fetchLeaderboards(undefined, 5),
      // A balanced sample (server round-robins across categories); the card
      // shows up to 4 per group, so this budget comfortably covers every group.
      fetchExamples(40),
    ]).then(([g, p, s, f, b, e]) => {
      if (!active) return;
      if (g.status === "fulfilled") setGames(g.value);
      if (p.status === "fulfilled") setPerformers(p.value);
      if (s.status === "fulfilled") setStandings(s.value);
      if (f.status === "fulfilled") setFantasy(f.value);
      if (b.status === "fulfilled") setBoards(b.value);
      setExamples(e.status === "fulfilled" ? e.value : []);
      setFailed({
        games: g.status === "rejected",
        performers: p.status === "rejected",
        standings: s.status === "rejected",
        fantasy: f.status === "rejected",
        boards: b.status === "rejected",
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const cardError = (what: string) => (
    <p className="yb-muted" role="alert">
      Couldn’t load {what}. Refresh to try again.
    </p>
  );

  const featured = games ? pickFeatured(games.games) : null;
  const divisionConf = standings?.conferences.find((c) => c.conference === divConf) ?? standings?.conferences[0];
  const playoffConfData =
    standings?.conferences.find((c) => c.conference === playoffConf) ?? standings?.conferences[0];

  return (
    <div className="yb-dash">
      {/* Featured matchup: bold score line, no card chrome. */}
      <section aria-label="Featured Matchup">
        <div className="yb-dash-head">
          <h2>Featured Matchup</h2>
        </div>
        {failed.games ? (
          cardError("scores")
        ) : !games ? (
          <div className="yb-skel" style={{ height: 64, borderRadius: "var(--r-lg)" }} />
        ) : featured ? (
          <FeaturedMatchup game={featured} />
        ) : (
          <p className="yb-muted">No games at this time</p>
        )}
      </section>

      {/* Performers of the week */}
      <section className="yb-card" aria-label="Performers of the Week">
        <div className="yb-dash-head">
          <h2>Performers of the Week</h2>
          <Link href="/scores#performers">Full board →</Link>
        </div>
        {failed.performers ? (
          cardError("performers")
        ) : (
          <Performers performers={performers?.performers ?? null} loading={!performers} count={4} />
        )}
      </section>

      {/* Division leaders: one card, conference picked by pill */}
      <section className="yb-card" aria-label="Division Leaders">
        <div className="yb-dash-head">
          <h2>Division Leaders</h2>
          <span className="yb-dash-links">
            {standings && (
              <ConfPills
                label="Division leaders conference"
                value={divConf}
                onChange={setDivConf}
                options={standings.conferences.map((c) => c.conference)}
              />
            )}
            <Link href="/standings">Full standings →</Link>
          </span>
        </div>
        {failed.standings ? (
          cardError("standings")
        ) : divisionConf ? (
          <DivisionTable conf={divisionConf} />
        ) : (
          <div className="yb-skel" style={{ height: 220 }} />
        )}
      </section>

      {/* League leaders: one line per category */}
      <section className="yb-card" aria-label="League Leaders">
        <div className="yb-dash-head">
          <h2>League Leaders</h2>
          <Link href="/leaders">View all leaders →</Link>
        </div>
        {failed.boards ? (
          cardError("league leaders")
        ) : boards ? (
          <div className="yb-lead-lines">
            {boards.boards
              .filter((b) => b.rows.length > 0)
              .slice(0, 6)
              .map((b) => {
                const r = b.rows[0]!;
                return (
                  <Link
                    key={b.key}
                    className="yb-lead-line"
                    href={`/players/${encodeURIComponent(r.player_id)}?season=${boards.season}`}
                    style={teamTheme(r.team)}
                  >
                    <span className="cat">{b.label}</span>
                    <span className="nm">{r.name}</span>
                    <span className="tm">{r.team}</span>
                    <span className="val">{formatStatValue(r.value)}</span>
                  </Link>
                );
              })}
          </div>
        ) : (
          <div className="yb-skel" style={{ height: 220 }} />
        )}
      </section>

      {/* Fantasy leaders */}
      <section className="yb-card" aria-label="Fantasy Leaders">
        <div className="yb-dash-head">
          <h2>Fantasy Leaders</h2>
          <Link href="/fantasy">Build a lineup →</Link>
        </div>
        {failed.fantasy ? (
          cardError("fantasy leaders")
        ) : fantasy ? (
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
          <Link className="yb-btn" href="/assistant">
            Ask the Fantasy Assistant
          </Link>
        </div>
      </section>

      {/* Playoff picture: same one-card pill system as the standings */}
      <section className="yb-card" aria-label="Playoff Picture">
        <div className="yb-dash-head">
          <h2>Playoff Picture</h2>
          <span className="yb-dash-links">
            {standings && (
              <ConfPills
                label="Playoff picture conference"
                value={playoffConf}
                onChange={setPlayoffConf}
                options={standings.conferences.map((c) => c.conference)}
              />
            )}
            <Link href="/standings">Full standings →</Link>
          </span>
        </div>
        {failed.standings ? (
          cardError("the playoff picture")
        ) : playoffConfData ? (
          <PlayoffTable conf={playoffConfData} />
        ) : (
          <div className="yb-skel" style={{ height: 220 }} />
        )}
      </section>

      {/* Trending questions, grouped by what they ask about */}
      {examples && examples.length > 0 && (
        <section className="yb-card" aria-label="Trending Questions">
          <div className="yb-dash-head">
            <h2>Trending Questions</h2>
          </div>
          <TrendingQuestions items={examples} />
        </section>
      )}
    </div>
  );
}

/** AFC/NFC pill toggle shared by the standings-flavored cards. */
function ConfPills({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="yb-pill-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** Featured game as one bold line: teams and score, status, date, box score. */
function FeaturedMatchup({ game }: { game: GameRow }) {
  const hasScore = game.home.score !== null || game.away.score !== null;
  const status = game.final ? "Final" : hasScore ? "Live" : "Scheduled";
  return (
    <Link
      className="yb-featured-line"
      href={game.final ? `/games/${encodeURIComponent(game.game_id)}` : "/scores"}
    >
      <span className="teams">
        <span className="side">
          <TeamLogo team={game.away.team_id} size={26} />
          <span className="abbr">{game.away.team_id}</span>
          <strong className="score">{game.away.score ?? "-"}</strong>
        </span>
        <span className="at">@</span>
        <span className="side">
          <TeamLogo team={game.home.team_id} size={26} />
          <span className="abbr">{game.home.team_id}</span>
          <strong className="score">{game.home.score ?? "-"}</strong>
        </span>
      </span>
      <span className="meta">
        <strong className="status">{status}</strong>
        <span className="date">
          {formatGameDate(game.date)} · {weekLabel(game.week, game.season)}
        </span>
        {game.final && <span className="go">Full box score →</span>}
      </span>
    </Link>
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

/** One conference's four division leaders. The conference is already picked by
 *  the pill above, so rows carry just the division: East, North, South, West. */
function DivisionTable({ conf }: { conf: ConferenceStandings }) {
  return (
    <div className="yb-scroll-x">
    <table className="yb-mini-table">
      <tbody>
        {conf.divisions.map((d) => {
          const team = d.teams[0]!;
          return (
            <tr key={d.division} className="yb-team-row" style={teamTheme(team.team_id)}>
              <td className="dim">{divisionShortName(d.division)}</td>
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
function PlayoffTable({ conf }: { conf: ConferenceStandings }) {
  return (
    <div className="yb-scroll-x">
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
            <td className="dim">{kind === "wc" ? "Wild Card" : "Division"}</td>
            <td className="num">{formatRecord(team.wins, team.losses, team.ties)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

// Category -> display label, in reading order. The category itself is derived
// server-side from the engine's own taxonomy (see common_questions.json), so
// there is no client-side re-classification of question text.
const CATEGORY_LABELS: [string, string][] = [
  ["passing", "Passing"],
  ["rushing", "Rushing"],
  ["receiving", "Receiving"],
  ["defense", "Defense"],
  ["head_to_head", "Head to Head"],
  ["playoffs", "Playoffs"],
  ["fantasy", "Fantasy"],
  ["other", "More"],
];

function groupExamples(items: ExampleQuestion[]): { name: string; questions: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const { question, category } of items) {
    let bucket = buckets.get(category);
    if (!bucket) buckets.set(category, (bucket = []));
    bucket.push(question);
  }
  return CATEGORY_LABELS.flatMap(([key, label]) => {
    const qs = buckets.get(key);
    return qs && qs.length > 0 ? [{ name: label, questions: qs.slice(0, 4) }] : [];
  });
}

/** Trending questions as one card of tap-to-run groups. */
function TrendingQuestions({ items }: { items: ExampleQuestion[] }) {
  const groups = groupExamples(items);
  return (
    <div className="yb-trend-groups">
      {groups.map((g) => (
        <div key={g.name} className="yb-trend-group">
          <span className="yb-trend-cat">{g.name}</span>
          <ul className="yb-trending">
            {g.questions.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  className="yb-trending-q"
                  onClick={() => window.dispatchEvent(new CustomEvent("yb:ask", { detail: q }))}
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function streakClass(streak: string): string {
  if (streak.startsWith("W")) return "yb-streak-w";
  if (streak.startsWith("L")) return "yb-streak-l";
  return "";
}
