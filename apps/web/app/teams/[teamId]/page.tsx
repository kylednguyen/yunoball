"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Crumbs } from "../../components/Crumbs";
import { Headshot } from "../../components/Headshot";
import { SeasonSelect } from "../../components/SeasonSelect";
import { SortTable } from "../../components/SortTable";
import { TeamLogo } from "../../components/TeamLogo";
import { useSeasonParam, useTeam, useTitle } from "../../lib/hooks";
import { friendlyError } from "../../lib/api";
import type { TeamGame, TeamKeyPlayer, TeamStat } from "../../lib/api";

/** 1 -> "1st", 22 -> "22nd" — league rank chips. */
function ord(n: number): string {
  const s = ["th", "st", "nd", "rd"] as const;
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? "th"}`;
}

/** Win-ish streaks/results read as the accent, losses as destructive. */
function outcomeClass(v: string): string | undefined {
  if (v.startsWith("W")) return "font-semibold text-primary";
  if (v.startsWith("L")) return "font-semibold text-destructive";
  return undefined;
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
          render: (s) => <span className="font-bold">{s.value.toLocaleString()}</span>,
        },
        { key: "pg", label: "Per game", numeric: true, value: (s) => s.per_game },
        {
          key: "rank",
          label: "NFL rank",
          numeric: true,
          value: (s) => s.rank,
          render: (s) => (
            <span
              className={cn(
                s.rank <= 5 && "font-semibold text-primary",
                s.rank >= 28 && "font-semibold text-destructive",
              )}
            >
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
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {loading && !team && (
        <>
          <Skeleton className="mb-5 h-[60px] w-[380px]" />
          <Skeleton className="mb-5 h-[110px] rounded-xl" />
          <Skeleton className="h-[300px] rounded-xl" />
        </>
      )}

      {error && (
        <div
          className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-10 text-center text-destructive"
          role="alert"
        >
          <h2 className="text-lg font-semibold">Couldn’t load this team</h2>
          <p className="max-w-prose">{friendlyError(error)}</p>
        </div>
      )}

      {notFound && (
        <div className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">Team not found</h2>
          <p className="max-w-prose">
            That team isn’t in the warehouse. Browse the{" "}
            <Link href="/teams" className="text-primary hover:underline">
              team list
            </Link>
            .
          </p>
        </div>
      )}

      {team && (
        <div className={cn(loading && "opacity-60")}>
          <Crumbs
            items={[
              { label: "NFL", href: "/" },
              { label: String(team.season), href: `/teams?season=${team.season}` },
              { label: team.nickname ?? team.name },
            ]}
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <TeamLogo team={team.team_id} size={64} />
              <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
                {team.name}
              </h1>
            </div>
            <SeasonSelect seasons={team.seasons} value={team.season} onChange={setSeason} />
          </div>
          <p className="mt-1 mb-6 max-w-prose text-muted-foreground">
            {team.division} · {team.record.wins}-{team.record.losses}
            {team.record.ties ? `-${team.record.ties}` : ""} ({ord(team.record.division_rank)} of{" "}
            {team.record.division_size} in the {team.division}) · streak{" "}
            <span className={outcomeClass(team.record.streak)}>{team.record.streak}</span>
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "Record",
                value: `${team.record.wins}-${team.record.losses}${team.record.ties ? `-${team.record.ties}` : ""}`,
                meta: `.${String(Math.round(team.record.pct * 1000)).padStart(3, "0")} win pct`,
              },
              {
                label: "Points scored",
                value: team.record.points_for,
                meta: `${ord(team.offense.find((s) => s.key === "points_for")?.rank ?? 0)} in the NFL`,
              },
              {
                label: "Points allowed",
                value: team.record.points_against,
                meta: `${ord(team.defense.find((s) => s.key === "points_against")?.rank ?? 0)} in the NFL`,
              },
              {
                label: "Point differential",
                value:
                  team.record.point_diff > 0
                    ? `+${team.record.point_diff}`
                    : team.record.point_diff,
                meta: team.conference ?? "",
              },
            ].map((tile) => (
              <Card key={tile.label}>
                <CardContent className="px-4">
                  <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {tile.label}
                  </div>
                  <div className="font-heading text-2xl font-bold tabular-nums">{tile.value}</div>
                  <div className="text-sm text-muted-foreground">{tile.meta}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {team.leaders.length > 0 && (
            <>
              <h2 className="mt-6 mb-3 text-sm font-bold tracking-wide text-muted-foreground uppercase">
                Team leaders
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {team.leaders.map((l) => (
                  <Link
                    key={l.key}
                    href={`/players/${encodeURIComponent(l.player_id)}?season=${team.season}`}
                    className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3 transition-colors hover:bg-muted"
                  >
                    <Headshot src={l.headshot_url} name={l.name} size={44} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {l.label}
                      </span>
                      <span className="truncate font-bold">{l.name}</span>
                      <span className="text-sm tabular-nums">
                        {l.value.toLocaleString()}{" "}
                        <span className="text-xs text-muted-foreground">{l.unit}</span>
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}

          <div className="mt-6 grid gap-8 lg:grid-cols-2">
            <section aria-label="Offense">
              <h2 className="mb-3 text-sm font-bold tracking-wide text-muted-foreground uppercase">
                Offense
              </h2>
              <StatTable stats={team.offense} caption="Offense" />
            </section>
            <section aria-label="Defense">
              <h2 className="mb-3 text-sm font-bold tracking-wide text-muted-foreground uppercase">
                Defense
              </h2>
              <StatTable stats={team.defense} caption="Defense" />
              <p className="mt-2 text-sm text-muted-foreground">
                Defensive player stats aren’t in the warehouse yet. Points allowed is the defensive
                picture for now.
              </p>
            </section>
          </div>

          {team.key_players.length > 0 && (
            <>
              <h2 className="mt-7 mb-3 text-sm font-bold tracking-wide text-muted-foreground uppercase">
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
                        className="inline-flex items-center gap-2"
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
                    render: (p) => (
                      <span className="text-xs font-bold tracking-wide text-muted-foreground">
                        {p.position}
                      </span>
                    ),
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
                      <span className="font-bold">{p.fantasy_points_ppr.toFixed(1)}</span>
                    ),
                  },
                ]}
              />
            </>
          )}

          {team.games.length > 0 && (
            <>
              <h2 className="mt-7 mb-3 text-sm font-bold tracking-wide text-muted-foreground uppercase">
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
                        className="inline-flex items-center gap-2"
                      >
                        <span className="text-muted-foreground">{g.home ? "vs" : "@"}</span>
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
                      <span className={outcomeClass(g.result)}>
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
  );
}
