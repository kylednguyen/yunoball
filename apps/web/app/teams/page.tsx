"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Crumbs } from "../components/Crumbs";
import { SeasonSelect } from "../components/SeasonSelect";
import { TeamLogo } from "../components/TeamLogo";
import { friendlyError } from "../lib/api";
import { useSeasonParam, useStandings, useTitle } from "../lib/hooks";

/** All 32 teams as clickable cards, grouped by division. Records come from the
 *  standings endpoint so this page needs no API of its own. */
export default function TeamsPage() {
  useTitle("Teams");
  const [season, setSeason] = useSeasonParam();
  const { data, error, loading } = useStandings(season);

  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Crumbs
        items={[
          { label: "NFL", href: "/" },
          ...(data ? [{ label: String(data.season) }] : []),
          { label: "Teams" },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Teams</h1>
        {data && <SeasonSelect seasons={data.seasons} value={data.season} onChange={setSeason} />}
      </div>
      <p className="mt-1 mb-6 max-w-prose text-muted-foreground">
        Pick a team to open its season page.
      </p>

      {error && (
        <div
          className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed border-destructive/50 bg-destructive/5 p-10 text-center text-destructive"
          role="alert"
        >
          <h2 className="text-lg font-semibold">Couldn&rsquo;t load teams</h2>
          <p className="max-w-prose">{friendlyError(error)}</p>
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {data &&
        !error &&
        data.conferences.map((conf) => (
          <section key={conf.conference} aria-label={`${conf.conference} teams`}>
            {conf.divisions.map((div) => (
              <div key={div.division} className={cn(loading && "opacity-60")}>
                <h2 className="mt-6 mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {div.division}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {div.teams.map((t) => (
                    <Link
                      key={t.team_id}
                      href={`/teams/${t.team_id}?season=${data.season}`}
                      className="flex items-center gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-muted"
                    >
                      <TeamLogo team={t.team_id} size={40} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-bold">{t.nickname ?? t.name}</span>
                        <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
                          {t.wins}-{t.losses}
                          {t.ties ? `-${t.ties}` : ""}
                          <span
                            className={cn(
                              "text-xs font-semibold",
                              t.streak.startsWith("W")
                                ? "text-primary"
                                : t.streak.startsWith("L")
                                  ? "text-destructive"
                                  : "",
                            )}
                          >
                            {t.streak}
                          </span>
                        </span>
                      </span>
                      <ChevronRight
                        className="size-5 flex-none text-muted-foreground"
                        aria-hidden="true"
                      />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
    </main>
  );
}
