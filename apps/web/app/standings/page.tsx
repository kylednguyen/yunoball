"use client";

import Link from "next/link";

import { Crumbs } from "../components/Crumbs";
import { Nav } from "../components/Nav";
import { SeasonSelect } from "../components/SeasonSelect";
import { SortTable, type SortColumn } from "../components/SortTable";
import { TeamLogo } from "../components/TeamLogo";
import { useSeasonParam, useStandings, useTitle } from "../lib/hooks";
import { friendlyError } from "../lib/api";
import type { StandingsResponse } from "../lib/api";

type TeamRow = StandingsResponse["conferences"][number]["divisions"][number]["teams"][number];

function StreakCell({ streak }: { streak: string }) {
  const cls = streak.startsWith("W") ? "yb-streak-w" : streak.startsWith("L") ? "yb-streak-l" : "";
  return <span className={cls}>{streak}</span>;
}

/** "W3" -> 3, "L2" -> -2, so streaks sort from hottest to coldest. */
function streakValue(streak: string): number {
  const n = Number(streak.slice(1)) || 0;
  return streak.startsWith("L") ? -n : n;
}

const columnsFor = (season: number): SortColumn<TeamRow>[] => [
  {
    key: "team",
    label: "Team",
    value: (t) => t.name,
    render: (t) => (
      <Link
        href={`/teams/${t.team_id}?season=${season}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
      >
        <TeamLogo team={t.team_id} />
        {t.name}
      </Link>
    ),
  },
  { key: "wins", label: "W", numeric: true, value: (t) => t.wins },
  { key: "losses", label: "L", numeric: true, value: (t) => t.losses },
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
  {
    key: "streak",
    label: "STRK",
    numeric: true,
    value: (t) => streakValue(t.streak),
    render: (t) => <StreakCell streak={t.streak} />,
  },
];

export default function StandingsPage() {
  useTitle("Standings");
  const [season, setSeason] = useSeasonParam();
  const { data, error, loading } = useStandings(season);

  return (
    <>
      <Nav />
      <main id="main" className="yb-page">
        <Crumbs
          items={[
            { label: "NFL", href: "/" },
            ...(data ? [{ label: String(data.season) }] : []),
            { label: "Standings" },
          ]}
        />
        <div className="yb-page-head">
          <h1 className="yb-page-title">Standings</h1>
          {data && <SeasonSelect seasons={data.seasons} value={data.season} onChange={setSeason} />}
        </div>
        <p className="yb-page-sub">Computed live from game results. Click a column to sort.</p>

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Couldn’t load standings</h2>
            <p>{friendlyError(error)}</p>
          </div>
        )}

        {loading && !data && (
          <div className="yb-standings-grid">
            {[0, 1].map((i) => (
              <div key={i} className="yb-skel" style={{ height: 480, borderRadius: 14 }} />
            ))}
          </div>
        )}

        {data && !error && (
          <div className="yb-standings-grid" style={{ opacity: loading ? 0.6 : 1 }}>
            {data.conferences.map((conf) => (
              <section key={conf.conference} aria-label={`${conf.conference} standings`}>
                <h2 className="yb-conf-title">{conf.conference}</h2>
                {conf.divisions.map((div) => {
                  const leader = div.teams[0]?.team_id;
                  return (
                    <div key={div.division} className="yb-division">
                      <h3>{div.division}</h3>
                      <SortTable<TeamRow>
                        rows={div.teams}
                        rowKey={(t) => t.team_id}
                        rowClass={(t) => (t.team_id === leader ? "yb-div-leader" : undefined)}
                        columns={columnsFor(data.season)}
                      />
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
