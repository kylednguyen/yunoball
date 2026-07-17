"use client";

import Link from "next/link";

import { TeamLogo } from "../components/TeamLogo";
import { Badge, PageHeader, SectionHeader } from "../components/ui";
import { friendlyError } from "../lib/api";
import { formatRank, formatRecord } from "../lib/format";
import { useSeasonParam, useStandings, useTitle } from "../lib/hooks";

/** All 32 teams as clickable cards, grouped by division. Records come from the
 *  standings endpoint so this page needs no API of its own. */
export default function TeamsPage() {
  useTitle("Teams");
  const [season] = useSeasonParam();
  const { data, error, loading } = useStandings(season);

  return (
    <>
      <main id="main" className="yb-page">
        <PageHeader
          crumbs={[
            ...(data ? [{ label: String(data.season) }] : []),
            { label: "Teams" },
          ]}
          title="Teams"
          filters={
            data && (
              <nav className="yb-conf-nav" aria-label="Conference navigation">
                {data.conferences.map((conf) => (
                  <a key={conf.conference} href={`#${conf.conference.toLowerCase()}`}>
                    {conf.conference}
                  </a>
                ))}
              </nav>
            )
          }
        />

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Couldn’t load teams</h2>
            <p>{friendlyError(error)}</p>
          </div>
        )}

        {loading && !data && (
          <div className="yb-team-grid">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="yb-skel" style={{ height: 96, borderRadius: "var(--r-xl)" }} />
            ))}
          </div>
        )}

        {data &&
          !error &&
          data.conferences.map((conf) => (
            <section
              key={conf.conference}
              id={conf.conference.toLowerCase()}
              aria-label={`${conf.conference} teams`}
              className="yb-conference-section"
            >
              <SectionHeader title={conf.conference} />
              {conf.divisions.map((div) => (
                <div key={div.division} style={{ opacity: loading ? 0.6 : 1 }}>
                  <h3 className="yb-conf-title">{div.division}</h3>
                  <div className="yb-team-grid">
                    {div.teams.map((t, index) => (
                      <Link
                        key={t.team_id}
                        className="yb-team-card"
                        href={`/teams/${t.team_id}?season=${data.season}`}
                      >
                        <span className="yb-team-card-rank">{formatRank(index + 1)}</span>
                        <TeamLogo team={t.team_id} size={38} />
                        <span className="yb-team-card-body">
                          <span className="nm">{t.nickname ?? t.name}</span>
                          <span className="rec">
                            <span>{formatRecord(t.wins, t.losses, t.ties)}</span>
                            <span
                              className={
                                t.streak.startsWith("W")
                                  ? "yb-streak-w"
                                  : t.streak.startsWith("L")
                                    ? "yb-streak-l"
                                    : ""
                              }
                            >
                              {t.streak}
                            </span>
                            {index === 0 && <Badge tone="accent">Division leader</Badge>}
                          </span>
                        </span>
                        <span className="go" aria-hidden="true">Open</span>
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
