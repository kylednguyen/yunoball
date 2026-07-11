"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Crumbs } from "../../components/Crumbs";
import { Headshot } from "../../components/Headshot";
import { SortTable } from "../../components/SortTable";
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
      className="inline-flex items-center gap-2"
    >
      <Headshot src={p.headshot_url} name={p.name} size={24} />
      {p.name}
      {p.position && (
        <span className="text-xs font-bold tracking-wide text-muted-foreground">{p.position}</span>
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
    <section className="mt-4">
      <h3 className="mb-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <SortTable
        rows={players}
        rowKey={(p) => p.player_id}
        columns={[
          {
            key: "player",
            label: "Player",
            value: (p) => p.name,
            render: (p) => <PlayerCell p={p} />,
          },
          ...columns.map((c) => ({
            key: c.label,
            label: c.label,
            numeric: true,
            value: (p: BoxScorePlayer) => c.value(p),
          })),
        ]}
      />
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
      <h2 className="flex items-center gap-2.5 font-heading text-xl font-bold tracking-tight">
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
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {/* One page-level heading present in every state (loading, error,
          not-found, success) so the document outline never starts at an
          orphan <h2>. The boxhead carries the visible scoreline. */}
      <h1 className="sr-only">
        {box
          ? `${box.away.name} ${box.away.score ?? ""} at ${box.home.name} ${box.home.score ?? ""}, box score`
          : "Box score"}
      </h1>
      {loading && (
        <>
          <Skeleton className="mb-5 h-[90px] rounded-xl" />
          <Skeleton className="h-[340px] rounded-xl" />
        </>
      )}

      {error && (
        <div
          className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-10 text-center text-destructive"
          role="alert"
        >
          <h2 className="text-lg font-semibold">Couldn’t load this game</h2>
          <p className="max-w-prose">{friendlyError(error)}</p>
        </div>
      )}

      {notFound && (
        <div className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">Game not found</h2>
          <p className="max-w-prose">
            That game isn’t in the warehouse. Head back to{" "}
            <Link href="/scores" className="text-primary hover:underline">
              Scores
            </Link>
            .
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
          <Card className="mt-4 flex-row flex-wrap items-center justify-center gap-x-8 gap-y-2 p-6">
            {[box.away, box.home].map((t, i) => {
              const other = i === 0 ? box.home : box.away;
              const won = t.score !== null && other.score !== null && t.score > other.score;
              return (
                <div key={t.team_id} className="flex items-center gap-4">
                  <Link
                    href={`/teams/${t.team_id}?season=${box.season}`}
                    className="flex items-center gap-2.5 hover:text-primary"
                  >
                    <TeamLogo team={t.team_id} size={40} />
                    <span className="flex flex-col leading-tight">
                      <span className="font-heading text-lg font-bold tracking-tight">
                        {t.nickname ?? t.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {i === 0 ? "Away" : "Home"}
                      </span>
                    </span>
                  </Link>
                  <span
                    className={cn(
                      "font-heading text-4xl font-bold tabular-nums",
                      won ? "text-primary" : "text-foreground",
                    )}
                  >
                    {t.score ?? "-"}
                  </span>
                </div>
              );
            })}
            <p className="w-full text-center text-sm text-muted-foreground">
              {box.season_type === "POST" ? "Postseason" : "Week"} {box.week} ·{" "}
              {fmtDate(box.date) ?? box.season}
              {box.stadium ? ` · ${box.stadium}` : ""}
            </p>
          </Card>

          <div className="mt-6 grid gap-8 lg:grid-cols-2">
            <TeamBox team={box.away} />
            <TeamBox team={box.home} />
          </div>
        </>
      )}
    </main>
  );
}
