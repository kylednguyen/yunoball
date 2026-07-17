"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Headshot } from "../../components/Headshot";
import { SortTable } from "../../components/SortTable";
import { TeamLogo } from "../../components/TeamLogo";
import { EntityHero, SectionHeader } from "../../components/ui";
import { useSeasonParam, useStandings, useTeam, useTitle } from "../../lib/hooks";
import { teamTheme } from "../../lib/teamTheme";
import { formatPct, weekLabel } from "../../lib/format";
import { friendlyError } from "../../lib/api";
import type { StandingsResponse, TeamGame, TeamKeyPlayer, TeamProfile, TeamStat } from "../../lib/api";

/** 1 -> "1st", 22 -> "22nd" — league rank chips. */
function ord(n: number): string {
  const s = ["th", "st", "nd", "rd"] as const;
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? "th"}`;
}

const rankClass = (rank: number) =>
  rank <= 5 ? "yb-streak-w" : rank >= 28 ? "yb-streak-l" : "yb-muted";

// Anchor tabs across the dashboard sections.
const TEAM_TABS: [string, string][] = [
  ["#leaders", "Overview"],
  ["#stats", "Stats"],
  ["#schedule", "Schedule"],
  ["#roster", "Roster"],
];

/** Ranked production table (offense/defense), nested inside the Team Stats card. */
function StatTable({ stats, caption }: { stats: TeamStat[]; caption: string }) {
  return (
    <SortTable<TeamStat>
      rows={stats}
      rowKey={(s) => s.key}
      columns={[
        { key: "label", label: caption, value: (s) => s.label },
        {
          key: "value",
          label: "Total",
          numeric: true,
          value: (s) => s.value,
          render: (s) => <span style={{ fontWeight: 700 }}>{s.value.toLocaleString()}</span>,
        },
        { key: "pg", label: "Per game", numeric: true, value: (s) => s.per_game },
        {
          key: "rank",
          label: "NFL rank",
          numeric: true,
          value: (s) => s.rank,
          render: (s) => <span className={rankClass(s.rank)}>{ord(s.rank)}</span>,
        },
      ]}
    />
  );
}

/** Stat-forward three-tile leader strip: category, big value, player identity. */
function TeamLeaders({ team }: { team: TeamProfile }) {
  return (
    <div className="yb-team-leaders">
      {team.leaders.map((l) => {
        const category = l.label.replace(/\s*yards?$/i, "");
        return (
          <Link
            key={l.key}
            className="yb-team-leader"
            href={`/players/${encodeURIComponent(l.player_id)}?season=${team.season}`}
          >
            <span className="cat">{category}</span>
            <span className="val">
              {l.value.toLocaleString()} <span className="unit">{l.unit}</span>
            </span>
            <span className="nm">{l.name}</span>
            <Headshot src={l.headshot_url} name={l.name} size={104} />
          </Link>
        );
      })}
    </div>
  );
}

/** Compact division standings, current team highlighted. Conference context is
 * already set by the division name, so it isn't repeated. */
function DivisionStandings({ team, standings }: { team: TeamProfile; standings: StandingsResponse | null }) {
  const division = standings?.conferences
    .flatMap((c) => c.divisions)
    .find((d) => d.division === team.division);
  if (!division) return null;
  return (
    <table className="yb-div-standings">
      <thead>
        <tr>
          <th>Team</th>
          <th className="num">W</th>
          <th className="num">L</th>
          <th className="num">T</th>
          <th className="num">PCT</th>
        </tr>
      </thead>
      <tbody>
        {division.teams.map((row) => {
          const isCurrent = row.team_id === team.team_id;
          return (
            <tr key={row.team_id} className={isCurrent ? "is-current" : undefined}>
              <td>
                <Link href={`/teams/${row.team_id}?season=${team.season}`} className="tm">
                  <TeamLogo team={row.team_id} size={20} />
                  <span>{row.nickname ?? row.name}</span>
                </Link>
              </td>
              <td className="num">{row.wins}</td>
              <td className="num">{row.losses}</td>
              <td className="num">{row.ties}</td>
              <td className="num strong">{formatPct(row.pct)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const [season] = useSeasonParam();
  const { data: team, error, loading } = useTeam(params?.teamId, season);
  const { data: standings, error: standingsError } = useStandings(season);
  const [activeTab, setActiveTab] = useState("#leaders");
  useTitle(team?.name);
  const notFound = !loading && !error && team === null;
  const record = team
    ? `${team.record.wins}-${team.record.losses}${team.record.ties ? `-${team.record.ties}` : ""}`
    : "";
  const streakClass = team?.record.streak.startsWith("W")
    ? "yb-streak-w"
    : team?.record.streak.startsWith("L")
      ? "yb-streak-l"
      : undefined;
  // Only games actually played — the schedule is week-ascending and keeps
  // unplayed future games (null scores), so slice the tail of played ones.
  const recent = team
    ? team.games.filter((g) => g.team_score !== null).slice(-5).reverse()
    : [];

  return (
    <main
      id="main"
      className="yb-page yb-entity-page yb-team-dash"
      style={team ? teamTheme(team.team_id) : undefined}
    >
      {loading && !team && (
        <>
          <div className="yb-skel" style={{ height: 60, width: "min(380px, 100%)", marginBottom: 20 }} />
          <div className="yb-skel" style={{ height: 120, borderRadius: 14, marginBottom: 20 }} />
          <div className="yb-skel" style={{ height: 300, borderRadius: 14 }} />
        </>
      )}

      {error && (
        <div className="yb-state error" role="alert">
          <h2>Couldn’t load this team</h2>
          <p>{friendlyError(error)}</p>
        </div>
      )}

      {notFound && (
        <div className="yb-state">
          <h2>Team not found</h2>
          <p>
            That team isn’t in the warehouse. Browse the <Link href="/teams">team list</Link>.
          </p>
        </div>
      )}

      {team && (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          {/* 1 — Compact identity header. Division/record and rank/streak each
              appear once; everything else lives in the sections below. */}
          <EntityHero
            className="yb-team-hero"
            label={`${team.name} profile`}
            media={<TeamLogo team={team.team_id} size={72} />}
            title={team.name}
            meta={
              <>
                <span>{team.division}</span>
                <span>{record}</span>
                <span>
                  {ord(team.record.division_rank)} of {team.record.division_size} in division
                </span>
                <span className={streakClass}>{team.record.streak} streak</span>
              </>
            }
          />

          {/* Anchor tabs — quick jumps within the dashboard. */}
          <nav className="yb-team-tabs" aria-label="Team sections">
            {TEAM_TABS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                aria-current={activeTab === href ? "true" : undefined}
                onClick={() => setActiveTab(href)}
              >
                {label}
              </a>
            ))}
          </nav>

          {/* 2 — Team leaders */}
          {team.leaders.length > 0 && (
            <section id="leaders" className="yb-card yb-team-panel" aria-label="Team leaders">
              <SectionHeader
                title="Team Leaders"
                action={<Link href="/leaders" className="yb-card-action">View all leaders →</Link>}
              />
              <TeamLeaders team={team} />
            </section>
          )}

          {/* 3 — Division standings. The card shell always renders so the
              sections below don't shift when the slower standings fetch lands. */}
          <section className="yb-card yb-team-panel" aria-label={`${team.division} standings`}>
            <SectionHeader
              title={`${team.division} Standings`}
              action={<Link href="/standings" className="yb-card-action">Full standings →</Link>}
            />
            {standingsError ? (
              <p className="yb-muted" role="alert">
                Couldn’t load standings. Refresh to try again.
              </p>
            ) : standings ? (
              <DivisionStandings team={team} standings={standings} />
            ) : (
              <div className="yb-skel" style={{ height: 200, borderRadius: "var(--r-lg)" }} />
            )}
          </section>

          {/* 4 — Team stats: production and league rank. Opponent scoring is the
              only defensive signal in the warehouse, shown as Points allowed. */}
          <section id="stats" className="yb-card yb-team-panel" aria-label="Team stats">
            <SectionHeader
              title="Team Stats"
            />
            <div className="yb-table-scroll">
              <StatTable stats={[...team.offense, ...team.defense]} caption="Category" />
            </div>
            <p className="yb-muted yb-card-note">
              Team defense is measured here as points allowed. Individual defensive leaders
              (sacks, tackles, interceptions) are in Team Leaders above.
            </p>
          </section>

          {/* 5 — Recent games */}
          {recent.length > 0 && (
            <section className="yb-card yb-team-panel" aria-label="Recent games">
              <SectionHeader title="Recent Games" />
              <table className="yb-div-standings yb-recent-games">
                <tbody>
                  {recent.map((g) => (
                    <tr key={g.game_id}>
                      <td className="wk">{weekLabel(g.week, team.season, true)}</td>
                      <td>
                        <Link href={`/teams/${g.opponent}?season=${team.season}`} className="tm">
                          <span className="yb-muted">{g.home ? "vs" : "@"}</span>
                          <TeamLogo team={g.opponent} size={20} />
                          <span>{g.opponent_nickname ?? g.opponent}</span>
                        </Link>
                      </td>
                      <td className="num">
                        <Link
                          href={`/games/${encodeURIComponent(g.game_id)}`}
                          className={g.result === "W" ? "yb-streak-w" : g.result === "L" ? "yb-streak-l" : undefined}
                        >
                          {g.result} {g.team_score ?? "-"}-{g.opp_score ?? "-"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Full schedule */}
          {team.games.length > 0 && (
            <section id="schedule" className="yb-card yb-team-panel" aria-label="Schedule and results">
              <SectionHeader title="Schedule & Results" />
              <SortTable<TeamGame>
                rows={team.games}
                rowKey={(g) => g.game_id}
                columns={[
                  { key: "week", label: "Wk", numeric: true, width: 48, value: (g) => g.week },
                  {
                    key: "opp",
                    label: "Opponent",
                    value: (g) => g.opponent,
                    render: (g) => (
                      <Link
                        href={`/teams/${g.opponent}?season=${team.season}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                      >
                        <span className="yb-muted">{g.home ? "vs" : "@"}</span>
                        <TeamLogo team={g.opponent} size={18} />
                        {g.opponent_nickname ?? g.opponent}
                      </Link>
                    ),
                  },
                  {
                    key: "result",
                    label: "Result",
                    value: (g) => g.result,
                    render: (g) => (
                      <span
                        className={
                          g.result === "W" ? "yb-streak-w" : g.result === "L" ? "yb-streak-l" : undefined
                        }
                      >
                        {g.result} {g.team_score ?? "-"}-{g.opp_score ?? "-"}
                      </span>
                    ),
                  },
                  { key: "date", label: "Date", value: (g) => g.date ?? "" },
                ]}
              />
            </section>
          )}

          {/* 6 — Roster / deeper team data */}
          {team.key_players.length > 0 && (
            <section id="roster" className="yb-card yb-team-panel" aria-label="Roster">
              <SectionHeader
                title="Roster"
              />
              <SortTable<TeamKeyPlayer>
                rows={team.key_players}
                rowKey={(p) => p.player_id}
                defaultSort={{ key: "ppr", dir: "desc" }}
                pageSize={15}
                columns={[
                  {
                    key: "name",
                    label: "Player",
                    value: (p) => p.name,
                    render: (p) => (
                      <Link
                        href={`/players/${encodeURIComponent(p.player_id)}?season=${team.season}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                      >
                        <Headshot src={p.headshot_url} name={p.name} scale="compact" />
                        {p.name}
                      </Link>
                    ),
                  },
                  {
                    key: "num",
                    label: "#",
                    numeric: true,
                    title: "Jersey number",
                    value: (p) => p.jersey_number,
                  },
                  {
                    key: "pos",
                    label: "Pos",
                    value: (p) => p.position,
                  },
                  { key: "gp", label: "GP", numeric: true, value: (p) => p.games_played },
                  {
                    key: "pass",
                    label: "Pass yds",
                    numeric: true,
                    value: (p) => p.passing_yards,
                    render: (p) => <>{p.passing_yards.toLocaleString()}</>,
                  },
                  {
                    key: "rush",
                    label: "Rush yds",
                    numeric: true,
                    value: (p) => p.rushing_yards,
                    render: (p) => <>{p.rushing_yards.toLocaleString()}</>,
                  },
                  { key: "rec", label: "Rec", numeric: true, value: (p) => p.receptions },
                  {
                    key: "rec_yds",
                    label: "Rec yds",
                    numeric: true,
                    value: (p) => p.receiving_yards,
                    render: (p) => <>{p.receiving_yards.toLocaleString()}</>,
                  },
                  { key: "td", label: "TD", numeric: true, value: (p) => p.total_tds },
                  {
                    key: "ppr",
                    label: "PPR",
                    numeric: true,
                    value: (p) => p.fantasy_points_ppr,
                    render: (p) => (
                      <span style={{ fontWeight: 700 }}>{p.fantasy_points_ppr.toFixed(1)}</span>
                    ),
                  },
                ]}
              />
            </section>
          )}
        </div>
      )}
    </main>
  );
}
