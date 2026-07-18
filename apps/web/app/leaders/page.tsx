"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Dropdown } from "../components/Dropdown";
import { Headshot } from "../components/Headshot";
import { BoardSkeleton } from "../components/Skeleton";
import { SortTable } from "../components/SortTable";
import { TeamLogo } from "../components/TeamLogo";
import { PageHeader } from "../components/ui";
import { useLeaderboards, useSeasonParam, useStandings, useStrParam, useTitle } from "../lib/hooks";
import { friendlyError } from "../lib/api";
import { formatPct, formatSigned, formatStatValue } from "../lib/format";
import { teamTheme } from "../lib/teamTheme";
import type { StandingRow } from "../lib/api";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;
const TEAM_TAB = "team_rankings";

/**
 * League leaders hub: every player category as a dense sortable table, plus a
 * whole-league team rankings tab. Every row links to a player or team page.
 */
export default function LeadersPage() {
  useTitle("League leaders");
  const [season] = useSeasonParam();
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

  const categoryValue = teamTab ? TEAM_TAB : board?.key ?? "";

  return (
    <>
      <main id="main" className="yb-page" style={{ maxWidth: 980 }}>
        <PageHeader
          crumbs={[
            ...(data ? [{ label: String(data.season) }] : []),
            { label: "Leaders" },
          ]}
          title="League Leaders"
        />

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Couldn’t load leaders</h2>
            <p>{friendlyError(error)}</p>
          </div>
        )}

        {loading && !data && (
          /* Same surface as the loaded board, so nothing jumps when data lands. */
          <div className="yb-board">
            <BoardSkeleton />
          </div>
        )}

        {data && !error && (
          <>
            <div className="yb-leader-controls" role="group" aria-label="Leaderboard filters">
              <Dropdown
                ariaLabel="Select leaderboard category"
                value={categoryValue}
                onChange={(v) => setActiveKey(v)}
                options={[
                  ...boards.map((b) => ({ value: b.key, label: b.label })),
                  { value: TEAM_TAB, label: "Team rankings" },
                ]}
              />
              {!teamTab && (
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
              )}
            </div>

            {!teamTab && (
              <div className="yb-player-tabs yb-position-pills" role="group" aria-label="Filter by position">
                {POSITIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={position === p}
                    onClick={() => setPosition(p)}
                  >
                    {p === "ALL" ? "All positions" : p}
                  </button>
                ))}
              </div>
            )}

            {!teamTab && (
              <p className="yb-qualification-note">
                Regular-season totals. Qualification follows the warehouse leaderboard rules.
              </p>
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
                      style={teamTheme(r.team)}
                    >
                      <Headshot src={r.headshot_url} name={r.name} scale="feature" />
                      <span className="who">
                        <span className="nm">
                          {r.name}
                        </span>
                        <span className="meta">
                          {r.team && <TeamLogo team={r.team} size={14} />}
                          {r.team ?? ""} · #1 in {board.label.toLowerCase()}
                        </span>
                      </span>
                      <span className="val">
                        {formatStatValue(r.value)}
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
                      <Headshot src={r.headshot_url} name={r.name} scale="row" />
                      <span className="nm">
                        {r.name}
                        {r.team && (
                          <span className="tm tm-team">
                            <TeamLogo team={r.team} size={13} />
                            {r.team}
                          </span>
                        )}
                      </span>
                      <span className="val">
                        {formatStatValue(r.value)}
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
                  <div className="yb-card">
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
                      {
                        key: "record",
                        label: "Record",
                        value: (t) => `${t.wins}-${t.losses}-${t.ties}`,
                        render: (t) => (
                          <>
                            {t.wins}-{t.losses}
                            {t.ties ? `-${t.ties}` : ""}
                          </>
                        ),
                      },
                      {
                        key: "pct",
                        label: "PCT",
                        numeric: true,
                        value: (t) => t.pct,
                        render: (t) => <>{formatPct(t.pct)}</>,
                      },
                      { key: "pf", label: "PF", numeric: true, value: (t) => t.points_for },
                      { key: "pa", label: "PA", numeric: true, value: (t) => t.points_against },
                      {
                        key: "diff",
                        label: "DIFF",
                        numeric: true,
                        value: (t) => t.point_diff,
                        render: (t) => <>{formatSigned(t.point_diff)}</>,
                      },
                    ]}
                  />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
