"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchGames, type GamesResponse } from "../lib/api";
import { TeamLogo } from "./TeamLogo";

function TeamLine({
  team,
  score,
  won,
}: {
  team: string;
  score: number | null;
  won: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-1.5", won && "font-bold text-primary")}>
      <TeamLogo team={team} size={16} />
      <span className="w-8 text-xs font-semibold">{team}</span>
      <span className="ml-auto text-sm tabular-nums">{score}</span>
    </span>
  );
}

/** Slim ESPN-style scoreboard strip pinned to the top of the front page. */
export function ScoreTicker() {
  const [games, setGames] = useState<GamesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchGames()
      .then((g) => {
        if (active) setGames(g);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null; // API down: the page works without the strip

  return (
    <div
      className="flex overflow-x-auto border-b bg-card [scrollbar-width:none]"
      aria-label="Latest scores"
    >
      <a
        className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 border-r bg-card px-4 py-2 text-xs hover:text-primary"
        href="/scores"
      >
        {games ? (
          <>
            <strong className="font-heading text-sm font-bold">Week {games.week}</strong>
            <span className="text-muted-foreground">{games.season}</span>
          </>
        ) : (
          <strong className="font-heading text-sm font-bold">Scores</strong>
        )}
      </a>
      <div className="flex">
        {games
          ? games.games.map((g) => {
              const homeWon = (g.home.score ?? 0) > (g.away.score ?? 0);
              return (
                <a
                  key={g.game_id}
                  className="flex w-32 shrink-0 flex-col justify-center gap-0.5 border-r px-3 py-2 transition-colors hover:bg-muted"
                  href="/scores"
                >
                  <TeamLine team={g.away.team_id} score={g.away.score} won={!homeWon} />
                  <TeamLine team={g.home.team_id} score={g.home.score} won={homeWon} />
                  <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.final ? "Final" : "Live"}
                  </span>
                </a>
              );
            })
          : Array.from({ length: 14 }, (_, i) => (
              <div key={i} className="w-32 shrink-0 border-r px-3 py-2">
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
      </div>
    </div>
  );
}
