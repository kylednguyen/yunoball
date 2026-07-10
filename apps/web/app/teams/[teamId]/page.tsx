"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Crumbs } from "../../components/Crumbs";
import { Headshot } from "../../components/Headshot";
import { Nav } from "../../components/Nav";
import { SeasonSelect } from "../../components/SeasonSelect";
import { SortTable } from "../../components/SortTable";
import { TeamLogo } from "../../components/TeamLogo";
import { useSeasonParam, useTeam, useTitle } from "../../lib/hooks";
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

  return (
    <>
      <Nav />
      <main id="main" className="yb-page" style={{ maxWidth: 980 }}>
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
            <p>{error}</p>
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
            <Crumbs
              items={[
                { label: "NFL", href: "/" },
                { label: String(team.season), href: `/teams?season=${team.season}` },
                { label: team.nickname ?? team.name },
              ]}
            />

            <div className="yb-page-head" style={{ alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <TeamLogo team={team.team_id} size={64} />
                <h1 className="yb-page-title">{team.name}</h1>
              </div>
              <SeasonSelect seasons={team.seasons} value={team.season} onChange={setSeason} />
            </div>
            <p className="yb-page-sub">
              {team.division} · {team.record.wins}-{team.record.losses}
              {team.record.ties ? `-${team.record.ties}` : ""} ({ord(team.record.division_rank)} of{" "}
              {team.record.division_size} in the {team.division}) · streak{" "}
              <span
                className={
                  team.record.streak.startsWith("W")
                    ? "yb-streak-w"
                    : team.record.streak.startsWith("L")
                      ? "yb-streak-l"
                      : ""
                }
              >
                {team.record.streak}
              </span>
            </p>

            <div className="yb-tiles">
              <div className="yb-tile">
                <div className="yb-tile-label">Record</div>
                <div className="yb-tile-value">
                  {team.record.wins}-{team.record.losses}
                  {team.record.ties ? `-${team.record.ties}` : ""}
                </div>
                <div className="yb-tile-meta">
                  .{String(Math.round(team.record.pct * 1000)).padStart(3, "0")} win pct
                </div>
              </div>
              <div className="yb-tile">
                <div className="yb-tile-label">Points scored</div>
                <div className="yb-tile-value">{team.record.points_for}</div>
                <div className="yb-tile-meta">
                  {ord(team.offense.find((s) => s.key === "points_for")?.rank ?? 0)} in the NFL
                </div>
              </div>
              <div className="yb-tile">
                <div className="yb-tile-label">Points allowed</div>
                <div className="yb-tile-value">{team.record.points_against}</div>
                <div className="yb-tile-meta">
                  {ord(team.defense.find((s) => s.key === "points_against")?.rank ?? 0)} in the NFL
                </div>
              </div>
              <div className="yb-tile">
                <div className="yb-tile-label">Point differential</div>
                <div className="yb-tile-value">
                  {team.record.point_diff > 0 ? `+${team.record.point_diff}` : team.record.point_diff}
                </div>
                <div className="yb-tile-meta">{team.conference}</div>
              </div>
            </div>

            {team.leaders.length > 0 && (
              <>
                <h2 className="yb-conf-title" style={{ marginTop: 24 }}>
                  Team leaders
                </h2>
                <div className="yb-leader-cards">
                  {team.leaders.map((l) => (
                    <Link
                      key={l.key}
                      className="yb-leader-card"
                      href={`/players/${encodeURIComponent(l.player_id)}?season=${team.season}`}
                    >
                      <Headshot src={l.headshot_url} name={l.name} size={44} />
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
              </>
            )}

            <div className="yb-standings-grid" style={{ marginTop: 24 }}>
              <section aria-label="Offense">
                <h2 className="yb-conf-title">Offense</h2>
                <StatTable stats={team.offense} caption="Offense" />
              </section>
              <section aria-label="Defense">
                <h2 className="yb-conf-title">Defense</h2>
                <StatTable stats={team.defense} caption="Defense" />
                <p className="yb-muted" style={{ fontSize: 13, marginTop: 8 }}>
                  Defensive player stats aren’t in the warehouse yet. Points allowed is the
                  defensive picture for now.
                </p>
              </section>
            </div>

            {team.key_players.length > 0 && (
              <>
                <h2 className="yb-conf-title" style={{ marginTop: 28 }}>
                  Key players
                </h2>
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
                          <Headshot src={p.headshot_url} name={p.name} size={26} />
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
              </>
            )}

            {team.games.length > 0 && (
              <>
                <h2 className="yb-conf-title" style={{ marginTop: 28 }}>
                  Schedule &amp; results
                </h2>
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
              </>
            )}
          </div>
        )}
      </main>
    </>
  );
}
