"use client";

import { tablistKeys } from "../components/tablist";

import Link from "next/link";
import { useMemo, useState } from "react";

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
    <>
      <main id="main" className="yb-page" style={{ maxWidth: 980 }}>
        <Crumbs
          items={[
            { label: "NFL", href: "/" },
            ...(data ? [{ label: String(data.season) }] : []),
            { label: "Leaders" },
          ]}
        />
        <div className="yb-page-head">
          <h1 className="yb-page-title">League Leaders</h1>
          {data && <SeasonSelect seasons={data.seasons} value={data.season} onChange={setSeason} />}
        </div>
        <p className="yb-page-sub">
          Explore every category. Click a player or team to go deeper, a column to sort.
        </p>

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Couldn’t load leaders</h2>
            <p>{friendlyError(error)}</p>
          </div>
        )}

        {loading && !data && (
          <div className="yb-card">
            <BoardSkeleton />
          </div>
        )}

        {data && (
          <>
            <div className="yb-tabs" role="tablist" aria-label="Stat category" onKeyDown={tablistKeys}>
              {boards.map((b) => (
                <button
                  key={b.key}
                  role="tab"
                  aria-selected={!teamTab && b.key === board?.key}
                  className="yb-tab"
                  onClick={() => setActiveKey(b.key)}
                >
                  {b.label}
                </button>
              ))}
              <button
                role="tab"
                aria-selected={teamTab}
                className="yb-tab"
                onClick={() => setActiveKey(TEAM_TAB)}
              >
                Team rankings
              </button>
            </div>

            {!teamTab && (
              <div className="yb-filters">
                <label>
                  <span className="yb-muted">Team</span>
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
                <label>
                  <span className="yb-muted">Position</span>
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
              <div className="yb-state">
                <h2>No leaders match</h2>
                <p>No stats for this season and filter combination. Try widening the filters.</p>
              </div>
            )}

            {!teamTab && board && (
              <div role="tabpanel" aria-label={board.label} style={{ opacity: loading ? 0.6 : 1 }}>
                <div className="yb-board">
                  {board.rows.slice(0, 1).map((r) => (
                    <Link
                      key={r.player_id}
                      className="yb-board-top"
                      href={`/players/${encodeURIComponent(r.player_id)}?season=${data.season}`}
                    >
                      <Headshot src={r.headshot_url} name={r.name} size={64} />
                      <span className="who">
                        <span className="nm">
                          {r.name}
                          {r.position && <span className="yb-pos">{r.position}</span>}
                        </span>
                        <span className="meta">
                          {r.team && <TeamLogo team={r.team} size={14} />}
                          {r.team ?? ""} · #1 in {board.label.toLowerCase()}
                        </span>
                      </span>
                      <span className="val">
                        {formatValue(r.value)}
                        <span className="yb-lb-unit"> {board.unit}</span>
                      </span>
                    </Link>
                  ))}
                  {board.rows.slice(1, 10).map((r) => (
                    <Link
                      key={r.player_id}
                      className="yb-board-row"
                      href={`/players/${encodeURIComponent(r.player_id)}?season=${data.season}`}
                    >
                      <span className="rk">{r.rank}</span>
                      <Headshot src={r.headshot_url} name={r.name} size={30} />
                      <span className="nm">
                        {r.name}
                        {r.position && (
                          <span className="tm">{r.position}</span>
                        )}
                        {r.team && (
                          <span className="tm">
                            <TeamLogo team={r.team} size={13} />
                            {r.team}
                          </span>
                        )}
                      </span>
                      <span className="val">
                        {formatValue(r.value)}
                        <span className="yb-lb-unit"> {board.unit}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {teamTab && (
              <div role="tabpanel" aria-label="Team rankings">
                {leagueTable.length === 0 ? (
                  <div className="yb-card">
                    <BoardSkeleton />
                  </div>
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
                            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
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
    </>
  );
}
