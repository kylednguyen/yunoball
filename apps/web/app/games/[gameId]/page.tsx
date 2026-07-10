"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Crumbs } from "../../components/Crumbs";
import { Headshot } from "../../components/Headshot";
import { TeamLogo } from "../../components/TeamLogo";
import { useBoxScore, useTitle } from "../../lib/hooks";
import { passerRating } from "../../lib/rating";
import { friendlyError } from "../../lib/api";
import type { BoxScorePlayer, BoxScoreTeam } from "../../lib/api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(d: string | null): string | null {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null;
}

function PlayerCell({ p }: { p: BoxScorePlayer }) {
  return (
    <Link
      href={`/players/${encodeURIComponent(p.player_id)}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <Headshot src={p.headshot_url} name={p.name} size={24} />
      {p.name}
      {p.position && (
        <span className="yb-muted" style={{ fontSize: 12 }}>
          {p.position}
        </span>
      )}
    </Link>
  );
}

function StatSection({
  title,
  players,
  columns,
}: {
  title: string;
  players: BoxScorePlayer[];
  columns: { label: string; value: (p: BoxScorePlayer) => string | number }[];
}) {
  if (players.length === 0) return null;
  return (
    <section className="yb-split-group">
      <h3>{title}</h3>
      <div className="yb-table-scroll">
        <table className="yb-table">
          <thead>
            <tr>
              <th>Player</th>
              {columns.map((c) => (
                <th key={c.label} className="num">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.player_id}>
                <td>
                  <PlayerCell p={p} />
                </td>
                {columns.map((c) => (
                  <td key={c.label} className="num">
                    {c.value(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TeamBox({ team }: { team: BoxScoreTeam }) {
  const passers = team.players.filter((p) => p.attempts > 0);
  const rushers = team.players.filter((p) => p.carries > 0);
  const receivers = team.players.filter((p) => p.targets > 0 || p.receptions > 0);
  const defenders = team.players.filter(
    (p) => p.tackles > 0 || p.def_sacks > 0 || p.def_interceptions > 0 || p.passes_defended > 0,
  );

  return (
    <div>
      <h2 className="yb-conf-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <TeamLogo team={team.team_id} size={22} /> {team.name}
      </h2>
      <StatSection
        title="Passing"
        players={passers}
        columns={[
          { label: "CMP/ATT", value: (p) => `${p.completions}/${p.attempts}` },
          { label: "YDS", value: (p) => p.passing_yards.toLocaleString() },
          { label: "TD", value: (p) => p.passing_tds },
          { label: "INT", value: (p) => p.interceptions },
          { label: "SCK", value: (p) => p.sacks },
          {
            label: "RTG",
            value: (p) =>
              passerRating(p.completions, p.attempts, p.passing_yards, p.passing_tds, p.interceptions) ??
              "-",
          },
        ]}
      />
      <StatSection
        title="Rushing"
        players={rushers}
        columns={[
          { label: "CAR", value: (p) => p.carries },
          { label: "YDS", value: (p) => p.rushing_yards.toLocaleString() },
          {
            label: "AVG",
            value: (p) => (p.carries ? (p.rushing_yards / p.carries).toFixed(1) : "-"),
          },
          { label: "TD", value: (p) => p.rushing_tds },
        ]}
      />
      <StatSection
        title="Receiving"
        players={receivers}
        columns={[
          { label: "REC", value: (p) => p.receptions },
          { label: "TGT", value: (p) => p.targets },
          { label: "YDS", value: (p) => p.receiving_yards.toLocaleString() },
          { label: "TD", value: (p) => p.receiving_tds },
        ]}
      />
      <StatSection
        title="Defense"
        players={defenders}
        columns={[
          { label: "TKL", value: (p) => p.tackles },
          { label: "SCK", value: (p) => p.def_sacks },
          { label: "INT", value: (p) => p.def_interceptions },
          { label: "FF", value: (p) => p.forced_fumbles },
          { label: "PD", value: (p) => p.passes_defended },
        ]}
      />
    </div>
  );
}

export default function BoxScorePage() {
  const params = useParams<{ gameId: string }>();
  const gameId = params?.gameId ? decodeURIComponent(params.gameId) : undefined;
  const { data: box, error, loading } = useBoxScore(gameId);
  const notFound = !loading && !error && box === null;
  useTitle(box ? `${box.away.team_id} @ ${box.home.team_id} box score` : undefined);

  return (
    <>
      <main id="main" className="yb-page" style={{ maxWidth: 980 }}>
        {loading && (
          <>
            <div className="yb-skel" style={{ height: 90, borderRadius: 14, marginBottom: 20 }} />
            <div className="yb-skel" style={{ height: 340, borderRadius: 14 }} />
          </>
        )}

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Couldn’t load this game</h2>
            <p>{friendlyError(error)}</p>
          </div>
        )}

        {notFound && (
          <div className="yb-state">
            <h2>Game not found</h2>
            <p>
              That game isn’t in the warehouse. Head back to{" "}
              <Link href="/scores">Scores</Link>.
            </p>
          </div>
        )}

        {box && (
          <>
            <Crumbs
              items={[
                { label: "NFL", href: "/" },
                { label: `${box.season} Week ${box.week}`, href: `/scores?season=${box.season}` },
                { label: `${box.away.team_id} @ ${box.home.team_id}` },
              ]}
            />
            {/* Page-level heading for the outline; the boxhead carries the
                visible scoreline. */}
            <h1 className="yb-sr-only">
              {box.away.name} {box.away.score ?? ""} at {box.home.name} {box.home.score ?? ""},{" "}
              box score
            </h1>
            <div className="yb-boxhead">
              {[box.away, box.home].map((t, i) => {
                const other = i === 0 ? box.home : box.away;
                const won =
                  t.score !== null && other.score !== null && t.score > other.score;
                return (
                  <div key={t.team_id} className={`side${won ? " won" : ""}`}>
                    <Link href={`/teams/${t.team_id}?season=${box.season}`} className="tm">
                      <TeamLogo team={t.team_id} size={40} />
                      <span>
                        <span className="nm">{t.nickname ?? t.name}</span>
                        <span className="sub">{i === 0 ? "Away" : "Home"}</span>
                      </span>
                    </Link>
                    <span className="score">{t.score ?? "-"}</span>
                  </div>
                );
              })}
              <p className="meta">
                {box.season_type === "POST" ? "Postseason" : "Week"} {box.week} ·{" "}
                {fmtDate(box.date) ?? box.season}
                {box.stadium ? ` · ${box.stadium}` : ""}
              </p>
            </div>

            <div className="yb-box-teams">
              <TeamBox team={box.away} />
              <TeamBox team={box.home} />
            </div>
          </>
        )}
      </main>
    </>
  );
}
