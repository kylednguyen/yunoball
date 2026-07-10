"use client";

import Link from "next/link";

import { Crumbs } from "../components/Crumbs";
import { Nav } from "../components/Nav";
import { SeasonSelect } from "../components/SeasonSelect";
import { TeamLogo } from "../components/TeamLogo";
import { useSeasonParam, useStandings } from "../lib/hooks";

/** All 32 teams as clickable cards, grouped by division. Records come from the
 *  standings endpoint so this page needs no API of its own. */
export default function TeamsPage() {
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
            { label: "Teams" },
          ]}
        />
        <div className="yb-page-head">
          <h1 className="yb-page-title">Teams</h1>
          {data && <SeasonSelect seasons={data.seasons} value={data.season} onChange={setSeason} />}
        </div>
        <p className="yb-page-sub">Pick a team to open its season page.</p>

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Couldn’t load teams</h2>
            <p>{error}</p>
          </div>
        )}

        {loading && !data && (
          <div className="yb-team-grid">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="yb-skel" style={{ height: 96, borderRadius: 14 }} />
            ))}
          </div>
        )}

        {data &&
          !error &&
          data.conferences.map((conf) => (
            <section key={conf.conference} aria-label={`${conf.conference} teams`}>
              {conf.divisions.map((div) => (
                <div key={div.division} style={{ opacity: loading ? 0.6 : 1 }}>
                  <h2 className="yb-conf-title" style={{ marginTop: 22 }}>
                    {div.division}
                  </h2>
                  <div className="yb-team-grid">
                    {div.teams.map((t) => (
                      <Link
                        key={t.team_id}
                        className="yb-team-card"
                        href={`/teams/${t.team_id}?season=${data.season}`}
                      >
                        <TeamLogo team={t.team_id} size={40} />
                        <span className="yb-team-card-body">
                          <span className="nm">{t.nickname ?? t.name}</span>
                          <span className="rec">
                            {t.wins}-{t.losses}
                            {t.ties ? `-${t.ties}` : ""}
                            <span
                              className={
                                t.streak.startsWith("W")
                                  ? "yb-streak-w"
                                  : t.streak.startsWith("L")
                                    ? "yb-streak-l"
                                    : ""
                              }
                              style={{ marginLeft: 8 }}
                            >
                              {t.streak}
                            </span>
                          </span>
                        </span>
                        <span className="go" aria-hidden="true">
                          →
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
      </main>
    </>
  );
}
