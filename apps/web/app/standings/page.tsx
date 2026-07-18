"use client";

import Link from "next/link";
import { useState } from "react";

import { TeamLogo } from "../components/TeamLogo";
import { PageHeader } from "../components/ui";
import { friendlyError } from "../lib/api";
import type { ConferenceStandings } from "../lib/api";
import { divisionShortName, formatPct } from "../lib/format";
import { useSeasonParam, useStandings, useTitle } from "../lib/hooks";
import { CLINCH_TAG, clinchByTeam, seedConference, type ClinchKind } from "../lib/playoff";
import { teamTheme } from "../lib/teamTheme";

/** Standard divisional standings behind AFC / NFC / Playoff tabs. Conference
 *  tabs show the four division tables (W-L-T-PCT) with clinch tags; the Playoff
 *  tab shows each conference's projected seven-team field. Every row is themed
 *  in its team's colors and links to the team page. */
export default function StandingsPage() {
  useTitle("Standings");
  const [season] = useSeasonParam();
  const { data, error, loading } = useStandings(season);
  const [tab, setTab] = useState("AFC");

  const conferences = data?.conferences ?? [];
  const activeConf = conferences.find((c) => c.conference === tab) ?? null;
  const tabs = [...conferences.map((c) => c.conference), "Playoff"];

  return (
    <main id="main" className="yb-page" style={{ maxWidth: 900 }}>
      <PageHeader
        crumbs={[
          ...(data ? [{ label: String(data.season) }] : []),
          { label: "Standings" },
        ]}
        title="Standings"
      />

      {error && (
        <div className="yb-state error" role="alert">
          <h2>Couldn’t load standings</h2>
          <p>{friendlyError(error)}</p>
        </div>
      )}

      {loading && !data && (
        <div className="yb-standings-grid">
          {[0, 1].map((i) => (
            <div key={i} className="yb-skel" style={{ height: 420, borderRadius: "var(--r-xl)" }} />
          ))}
        </div>
      )}

      {data && !error && (
        <>
          <div className="yb-pill-seg yb-standings-tabs" role="group" aria-label="Standings view">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div style={{ opacity: loading ? 0.6 : 1 }}>
            {tab === "Playoff" ? (
              <div className="yb-standings-grid">
                {conferences.map((conf) => (
                  <PlayoffField key={conf.conference} conf={conf} season={data.season} />
                ))}
              </div>
            ) : activeConf ? (
              <div className="yb-division-grid">
                {activeConf.divisions.map((div) => (
                  <DivisionTable
                    key={div.division}
                    division={div.division}
                    teams={div.teams}
                    clinch={clinchByTeam(activeConf)}
                    season={data.season}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}

function ClinchTag({ kind }: { kind: ClinchKind }) {
  const title: Record<ClinchKind, string> = {
    bye: "Projected #1 seed (first-round bye)",
    div: "Projected division winner",
    wc: "Projected Wild Card",
    out: "Projected to miss the playoffs",
  };
  return (
    <span className={`yb-clinch ${kind}`} title={title[kind]}>
      {CLINCH_TAG[kind]}
    </span>
  );
}

/** One division: standard W-L-T-PCT table, team-color themed rows, leader on
 *  top with a stronger tint. */
function DivisionTable({
  division,
  teams,
  clinch,
  season,
}: {
  division: string;
  teams: ConferenceStandings["divisions"][number]["teams"];
  clinch: Map<string, ClinchKind>;
  season: number;
}) {
  return (
    <table className="yb-div-table">
      <thead>
        <tr>
          {/* The conference tab above already sets context: "East", not "AFC East". */}
          <th className="team">{divisionShortName(division)}</th>
          <th className="num">W</th>
          <th className="num">L</th>
          <th className="num">T</th>
          <th className="num">PCT</th>
        </tr>
      </thead>
      <tbody>
        {teams.map((t, i) => (
          <tr key={t.team_id} className={i === 0 ? "is-leader" : undefined} style={teamTheme(t.team_id)}>
            <td className="team">
              <Link href={`/teams/${t.team_id}?season=${season}`}>
                <TeamLogo team={t.team_id} size={28} />
                <span className="nm">{t.nickname ?? t.name}</span>
                <ClinchTag kind={clinch.get(t.team_id) ?? "out"} />
              </Link>
            </td>
            <td className="num">{t.wins}</td>
            <td className="num">{t.losses}</td>
            <td className="num">{t.ties}</td>
            <td className="num pct">{formatPct(t.pct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One conference's projected seven-team playoff field as team-color blocks,
 *  with a cutline under the division winners and after the last wildcard. */
function PlayoffField({ conf, season }: { conf: ConferenceStandings; season: number }) {
  const seeds = seedConference(conf);
  return (
    <section aria-label={`${conf.conference} playoff picture`}>
      <h2 className="yb-conf-title">{conf.conference}</h2>
      <ol className="yb-seed-list">
        {seeds.map((s) => (
          <li
            key={s.team.team_id}
            className={`yb-seed-block${s.kind === "wc" ? " is-wc" : ""}`}
            style={teamTheme(s.team.team_id)}
          >
            <span className="sd">{s.seed}</span>
            <TeamLogo team={s.team.team_id} size={30} />
            <Link className="tm" href={`/teams/${s.team.team_id}?season=${season}`}>
              {s.team.nickname ?? s.team.name}
            </Link>
            <span className="kd">{s.kind === "wc" ? "Wild Card" : s.kind === "bye" ? "#1 seed" : `${conf.conference} ${s.seed}`}</span>
            <span className="rc">
              {s.team.wins}-{s.team.losses}
              {s.team.ties ? `-${s.team.ties}` : ""}
            </span>
          </li>
        ))}
      </ol>
      <p className="yb-seed-note">Seeds 1-4 win the division, 5-7 are Wild Cards. Projected by win pct.</p>
    </section>
  );
}
