"use client";

import { tablistKeys } from "../components/tablist";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Crumbs } from "../components/Crumbs";
import { Dropdown } from "../components/Dropdown";
import { Headshot } from "../components/Headshot";
import { SeasonSelect } from "../components/SeasonSelect";
import { BoardSkeleton } from "../components/Skeleton";
import { SortTable } from "../components/SortTable";
import { TeamLogo } from "../components/TeamLogo";
import { useLeaderboards, useSeasonParam, useStandings, useStrParam, useTitle } from "../lib/hooks";
import { friendlyError } from "../lib/api";
import type { LeaderRow, StandingRow } from "../lib/api";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;
const TEAM_TAB = "team_rankings";

/**
 * League leaders hub: every player category as a dense sortable table, plus a
 * whole-league team rankings tab. Every row links to a player or team page.
 */
export default function LeadersPage() {
  useTitle("League leaders");
  const [season, setSeason] = useSeasonParam();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Filters live in the URL — shareable and stable across back-navigation.
  const [team, setTeam] = useStrParam("team", "ALL");
  const [position, setPosition] = useStrParam("position", "ALL");

  const { data, error, loading } = useLeaderboards(
    season,
    10,
    team === "ALL" ? undefined : team,
    position === "ALL" ? undefined : position,
  );
  // Also powers the team filter dropdown and the team rankings tab.
  const { data: standings } = useStandings(season);

  const boards = useMemo(() => (data?.boards ?? []).filter((b) => b.rows.length > 0), [data]);
  const board = boards.find((b) => b.key === activeKey) ?? boards[0];
  const teamTab = activeKey === TEAM_TAB;

  const allTeams = useMemo(
    () =>
      (standings?.conferences ?? [])
        .flatMap((c) => c.divisions)
        .flatMap((d) => d.teams)
        .sort((a, b) => a.team_id.localeCompare(b.team_id)),
    [standings],
  );
  const leagueTable = useMemo(
    () => [...allTeams].sort((a, b) => b.pct - a.pct || b.point_diff - a.point_diff),
    [allTeams],
  );

  const formatValue = (v: number) => (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1));

  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Crumbs
        items={[
          { label: "NFL", href: "/" },
          ...(data ? [{ label: String(data.season) }] : []),
          { label: "Leaders" },
        ]}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          League Leaders
        </h1>
        {data && <SeasonSelect seasons={data.seasons} value={data.season} onChange={setSeason} />}
      </div>
      <p className="mt-1 mb-6 max-w-prose text-muted-foreground">
        Explore every category. Click a player or team to go deeper, a column to sort.
      </p>

      {error && (
        <div
          className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-10 text-center text-destructive"
          role="alert"
        >
          <h2 className="text-lg font-semibold">Couldn’t load leaders</h2>
          <p className="max-w-prose">{friendlyError(error)}</p>
        </div>
      )}

      {loading && !data && (
        <Card className="p-6">
          <BoardSkeleton />
        </Card>
      )}

      {data && (
        <>
          <div
            className="flex flex-wrap gap-1.5"
            role="tablist"
            aria-label="Stat category"
            onKeyDown={tablistKeys}
          >
            {boards.map((b) => {
              const on = !teamTab && b.key === board?.key;
              return (
                <button
                  key={b.key}
                  role="tab"
                  aria-selected={on}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setActiveKey(b.key)}
                >
                  {b.label}
                </button>
              );
            })}
            <button
              role="tab"
              aria-selected={teamTab}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                teamTab
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setActiveKey(TEAM_TAB)}
            >
              Team rankings
            </button>
          </div>

          {!teamTab && (
            <div className="mt-4 flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Team</span>
                <Dropdown
                  ariaLabel="Filter by team"
                  value={team}
                  onChange={setTeam}
                  options={[
                    { value: "ALL", label: "All teams" },
                    ...allTeams.map((t) => ({
                      value: t.team_id,
                      label: `${t.team_id} · ${t.nickname ?? t.name}`,
                    })),
                  ]}
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Position</span>
                <Dropdown
                  ariaLabel="Filter by position"
                  value={position}
                  onChange={setPosition}
                  options={POSITIONS.map((p) => ({
                    value: p,
                    label: p === "ALL" ? "All positions" : p,
                  }))}
                />
              </label>
            </div>
          )}

          {!teamTab && !loading && boards.length === 0 && (
            <div className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
              <h2 className="text-lg font-semibold text-foreground">No leaders match</h2>
              <p className="max-w-prose">
                No stats for this season and filter combination. Try widening the filters.
              </p>
            </div>
          )}

          {!teamTab && board && (
            <div
              role="tabpanel"
              aria-label={board.label}
              className={cn("mt-6", loading && "opacity-60")}
            >
              <div className="flex flex-col gap-1.5">
                {board.rows.slice(0, 1).map((r) => (
                  <TopRow key={r.player_id} r={r} board={board} season={data.season} format={formatValue} />
                ))}
                {board.rows.slice(1, 10).map((r) => (
                  <Link
                    key={r.player_id}
                    href={`/players/${encodeURIComponent(r.player_id)}?season=${data.season}`}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-muted"
                  >
                    <span className="w-6 text-center font-heading text-sm font-bold tabular-nums text-muted-foreground">
                      {r.rank}
                    </span>
                    <Headshot src={r.headshot_url} name={r.name} size={30} />
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold">
                      {r.name}
                      {r.position && (
                        <span className="text-xs font-bold tracking-wide text-muted-foreground">
                          {r.position}
                        </span>
                      )}
                      {r.team && (
                        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          <TeamLogo team={r.team} size={13} />
                          {r.team}
                        </span>
                      )}
                    </span>
                    <span className="font-heading text-base font-bold tabular-nums">
                      {formatValue(r.value)}
                      <span className="ml-0.5 text-xs font-medium text-muted-foreground">
                        {board.unit}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {teamTab && (
            <div role="tabpanel" aria-label="Team rankings" className="mt-6">
              {leagueTable.length === 0 ? (
                <Card className="p-6">
                  <BoardSkeleton />
                </Card>
              ) : (
                <SortTable<StandingRow>
                  rows={leagueTable}
                  rowKey={(t) => t.team_id}
                  columns={[
                    {
                      key: "rank",
                      label: "#",
                      numeric: true,
                      width: 48,
                      value: (t) => leagueTable.indexOf(t) + 1,
                    },
                    {
                      key: "team",
                      label: "Team",
                      value: (t) => t.name,
                      render: (t) => (
                        <Link
                          href={`/teams/${t.team_id}?season=${data.season}`}
                          className="inline-flex items-center gap-2"
                        >
                          <TeamLogo team={t.team_id} />
                          {t.name}
                        </Link>
                      ),
                    },
                    { key: "w", label: "W", numeric: true, value: (t) => t.wins },
                    { key: "l", label: "L", numeric: true, value: (t) => t.losses },
                    {
                      key: "pct",
                      label: "PCT",
                      numeric: true,
                      value: (t) => t.pct,
                      render: (t) => <>{t.pct.toFixed(3).replace(/^0/, "")}</>,
                    },
                    { key: "pf", label: "PF", numeric: true, value: (t) => t.points_for },
                    { key: "pa", label: "PA", numeric: true, value: (t) => t.points_against },
                    {
                      key: "diff",
                      label: "DIFF",
                      numeric: true,
                      value: (t) => t.point_diff,
                      render: (t) => <>{t.point_diff > 0 ? `+${t.point_diff}` : t.point_diff}</>,
                    },
                  ]}
                />
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

/** #1 in a category — bigger headshot, accent value, its own card-like row. */
function TopRow({
  r,
  board,
  season,
  format,
}: {
  r: LeaderRow;
  board: { label: string; unit: string };
  season: number;
  format: (v: number) => string;
}) {
  return (
    <Link
      href={`/players/${encodeURIComponent(r.player_id)}?season=${season}`}
      className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 transition-colors hover:bg-muted"
    >
      <Headshot src={r.headshot_url} name={r.name} size={64} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 font-heading text-lg font-bold">
          {r.name}
          {r.position && (
            <span className="text-xs font-bold tracking-wide text-muted-foreground">
              {r.position}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {r.team && <TeamLogo team={r.team} size={14} />}
          {r.team ?? ""} · #1 in {board.label.toLowerCase()}
        </span>
      </span>
      <span className="font-heading text-2xl font-bold tabular-nums text-primary">
        {format(r.value)}
        <span className="ml-1 text-xs font-medium text-muted-foreground">{board.unit}</span>
      </span>
    </Link>
  );
}
