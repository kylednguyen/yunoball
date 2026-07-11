"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { Headshot } from "./Headshot";
import { Performers } from "./Performers";
import { TeamLogo } from "./TeamLogo";
import {
  fetchFantasyPlayers,
  fetchPerformers,
  fetchStandings,
  type FantasyPlayersResponse,
  type PerformersResponse,
  type StandingsResponse,
} from "../lib/api";

/** Section header: a heading with a "see all" link to its full page. */
function SectionHead({ title, href, label }: { title: string; href: string; label: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-heading text-lg font-bold tracking-tight">{title}</h2>
      <Button asChild variant="link" size="sm" className="h-auto p-0">
        <Link href={href}>{label} →</Link>
      </Button>
    </div>
  );
}

/** The sports-platform front page below the ticker: performers of the week,
 *  the standings picture and the top fantasy performers. Every panel is a
 *  doorway into its full page. */
export function HomeDashboard() {
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [fantasy, setFantasy] = useState<FantasyPlayersResponse | null>(null);
  const [performers, setPerformers] = useState<PerformersResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetchStandings(),
      fetchFantasyPlayers(),
      fetchPerformers(undefined, undefined, 4),
    ]).then(([s, f, p]) => {
      if (!active) return;
      if (s.status === "fulfilled") setStandings(s.value);
      if (f.status === "fulfilled") setFantasy(f.value);
      if (p.status === "fulfilled") setPerformers(p.value);
      setFailed(
        s.status === "rejected" && f.status === "rejected" && p.status === "rejected",
      );
    });
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null; // API down — the hero search still explains itself

  const leaders = standings?.conferences.flatMap((c) =>
    c.divisions.map((d) => ({ division: d.division, team: d.teams[0]! })),
  );
  const topFantasy = fantasy?.players.slice(0, 6);

  return (
    <div className="flex flex-col gap-8">
      {/* Performers of the week */}
      <section aria-label="Performers of the week">
        <SectionHead title="Performers of the week" href="/scores" label="Full board" />
        <Performers performers={performers?.performers ?? null} loading={!performers} count={4} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Division leaders */}
        <Card aria-label="Division leaders">
          <CardContent>
            <SectionHead title="Division leaders" href="/teams" label="All teams" />
            {leaders ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableBody>
                    {leaders.map(({ division, team }) => (
                      <TableRow key={division}>
                        <TableCell className="text-muted-foreground">{division}</TableCell>
                        <TableCell>
                          <Link
                            href={`/teams/${team.team_id}`}
                            className="inline-flex items-center gap-2 hover:text-primary"
                          >
                            <TeamLogo team={team.team_id} size={18} />
                            {team.nickname ?? team.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {team.wins}-{team.losses}
                          {team.ties ? `-${team.ties}` : ""}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums font-semibold",
                            team.streak.startsWith("W") && "text-primary",
                            team.streak.startsWith("L") && "text-destructive",
                          )}
                        >
                          {team.streak}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <Skeleton className="h-[300px] w-full rounded-lg" />
            )}
          </CardContent>
        </Card>

        {/* Fantasy leaders */}
        <Card aria-label="Top fantasy performers">
          <CardContent>
            <SectionHead title="Fantasy leaders" href="/fantasy" label="Build a lineup" />
            {topFantasy ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableBody>
                    {topFantasy.map((p, i) => (
                      <TableRow key={p.player_id}>
                        <TableCell className="w-6 text-right tabular-nums text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/players/${encodeURIComponent(p.player_id)}`}
                            className="inline-flex items-center gap-2 hover:text-primary"
                          >
                            <Headshot src={p.headshot_url} name={p.name} size={26} />
                            {p.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-bold tracking-wide text-muted-foreground">
                            {p.position}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {p.points_per_game.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          pts/gm
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <Skeleton className="h-[300px] w-full rounded-lg" />
            )}

            <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
              <span className="text-sm text-muted-foreground">Not sure who to start?</span>
              <Button asChild variant="secondary" size="sm">
                <Link href="/assistant">Ask the Fantasy Assistant</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
