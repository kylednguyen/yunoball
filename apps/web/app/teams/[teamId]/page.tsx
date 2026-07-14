"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Crumbs } from "../../components/Crumbs";
import { Headshot } from "../../components/Headshot";
import { SeasonSelect } from "../../components/SeasonSelect";
import { SortTable } from "../../components/SortTable";
import { TeamLogo } from "../../components/TeamLogo";
import { EntityHero, InfoGrid, SectionHeader, StatSummary } from "../../components/ui";
import { useSeasonParam, useTeam, useTitle } from "../../lib/hooks";
import { friendlyError } from "../../lib/api";
import { teamTheme } from "../../lib/teamTheme";
import type { TeamGame, TeamKeyPlayer, TeamStat } from "../../lib/api";

/** 1 -> "1st", 22 -> "22nd" — league rank chips. */
function ord(n: number): string {
  const s = ["th", "st", "nd", "rd"] as const;
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? "th"}`;
}

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
          render: (s) => (
            <span className={s.rank <= 5 ? "yb-streak-w" : s.rank >= 28 ? "yb-streak-l" : undefined}>
              {ord(s.rank)}
            </span>
          ),
        },
      ]}
    />
  );
}

export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const [season, setSeason] = useSeasonParam();
  const { data: team, error, loading } = useTeam(params?.teamId, season);
  useTitle(team?.name);
  const notFound = !loading && !error && team === null;
  const record = team
    ? `${team.record.wins}-${team.record.losses}${team.record.ties ? `-${team.record.ties}` : ""}`
    : "";
  const winPct = team
    ? `.${String(Math.round(team.record.pct * 1000)).padStart(3, "0")}`
    : "";
  const offenseRank = team?.offense.find((stat) => stat.key === "points_for")?.rank ?? 0;
  const defenseRank = team?.defense.find((stat) => stat.key === "points_against")?.rank ?? 0;
  const pointDiff = team
    ? team.record.point_diff > 0
      ? `+${team.record.point_diff}`
      : String(team.record.point_diff)
    : "";
  const streakClass = team?.record.streak.startsWith("W")
    ? "yb-streak-w"
    : team?.record.streak.startsWith("L")
      ? "yb-streak-l"
      : undefined;

  return (
    <>
      <main id="main" className="yb-page yb-entity-page">
        {loading && !team && (
          <>
            <div className="yb-skel" style={{ height: 60, width: 380, marginBottom: 20 }} />
            <div className="yb-skel" style={{ height: 110, borderRadius: 14, marginBottom: 20 }} />
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
          <div style={{ opacity: loading ? 0.6 : 1, ...teamTheme(team.team_id) }}>
            <Crumbs
              items={[
                { label: "NFL", href: "/" },
                { label: String(team.season), href: `/teams?season=${team.season}` },
                { label: team.nickname ?? team.name },
              ]}
            />

            <EntityHero
              label={`${team.name} profile`}
              media={<TeamLogo team={team.team_id} size={80} />}
              eyebrow={team.conference}
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
              utilities={
                <SeasonSelect seasons={team.seasons} value={team.season} onChange={setSeason} />
              }
              details={
                <InfoGrid
                  items={[
                    { label: "Division", value: team.division },
                    { label: "Conference", value: team.conference },
                    { label: "Record", value: record },
                    {
                      label: "Division rank",
                      value: `${ord(team.record.division_rank)} of ${team.record.division_size}`,
                    },
                    { label: "Point differential", value: pointDiff },
                    { label: "Season", value: team.season },
                  ]}
                />
              }
            />

            <StatSummary
              title={`${team.season} season summary`}
              className="yb-team-summary"
              items={[
                { label: "Record", value: record, meta: `${winPct} win pct` },
                {
                  label: "Points scored",
                  value: team.record.points_for,
                  meta: `${ord(offenseRank)} in the NFL`,
                },
                {
                  label: "Points allowed",
                  value: team.record.points_against,
                  meta: `${ord(defenseRank)} in the NFL`,
                },
                { label: "Point differential", value: pointDiff, meta: team.conference },
              ]}
            />

            {team.leaders.length > 0 && (
              <section className="yb-entity-section" aria-label="Team leaders">
                <SectionHeader
                  title="Team leaders"
                  meta={`${team.season} regular season leaders`}
                />
                <div className="yb-leader-cards">
                  {team.leaders.map((l) => (
                    <Link
                      key={l.key}
                      className="yb-leader-card"
                      href={`/players/${encodeURIComponent(l.player_id)}?season=${team.season}`}
                    >
                      <Headshot src={l.headshot_url} name={l.name} scale="card" />
                      <span className="body">
                        <span className="lbl">{l.label}</span>
                        <span className="nm">{l.name}</span>
                        <span className="val">
                          {l.value.toLocaleString()} <span className="yb-lb-unit">{l.unit}</span>
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <div className="yb-standings-grid yb-entity-section">
              <section aria-label="Offense">
                <SectionHeader title="Offense" meta="Team production and league rank" />
                <StatTable stats={team.offense} caption="Offense" />
              </section>
              <section aria-label="Defense">
                <SectionHeader title="Defense" meta="Team prevention and league rank" />
                <StatTable stats={team.defense} caption="Defense" />
                <p className="yb-muted" style={{ fontSize: 13, marginTop: 8 }}>
                  Defensive player stats aren’t in the warehouse yet. Points allowed is the
                  defensive picture for now.
                </p>
              </section>
            </div>

            {team.key_players.length > 0 && (
              <section className="yb-entity-section" aria-label="Key players">
                <SectionHeader
                  title="Key players"
                  meta={`${team.key_players.length} players with recorded production`}
                />
                <SortTable<TeamKeyPlayer>
                  rows={team.key_players}
                  rowKey={(p) => p.player_id}
                  defaultSort={{ key: "ppr", dir: "desc" }}
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
                      key: "pos",
                      label: "Pos",
                      value: (p) => p.position,
                      render: (p) => <span className={`yb-pos ${p.position ?? ""}`}>{p.position}</span>,
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

            {team.games.length > 0 && (
              <section className="yb-entity-section" aria-label="Schedule and results">
                <SectionHeader
                  title="Schedule & results"
                  meta={`${team.games.length} regular-season games`}
                />
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
          </div>
        )}
      </main>
    </>
  );
}
