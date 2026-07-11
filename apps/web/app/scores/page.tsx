"use client";

import { useNumParam, useTitle } from "../lib/hooks";

import { tablistKeys } from "../components/tablist";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { Performers } from "../components/Performers";
import { TeamLogo } from "../components/TeamLogo";
import {
  friendlyError,
  fetchGames,
  fetchPerformers,
  type GamesResponse,
  type GameRow,
  type PerformersResponse,
} from "../lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function GameCard({ game }: { game: GameRow }) {
  const homeWon = game.final && (game.home.score ?? 0) > (game.away.score ?? 0);
  const awayWon = game.final && (game.away.score ?? 0) > (game.home.score ?? 0);
  return (
    <Card className="gap-0 overflow-hidden p-0">
      {[
        { side: game.away, won: awayWon },
        { side: game.home, won: homeWon },
      ].map(({ side, won }) => (
        <div
          key={side.team_id}
          className={cn(
            "flex items-center gap-3 px-4 py-3",
            won && "bg-muted/40",
          )}
        >
          <Link
            className="flex min-w-0 flex-1 items-center gap-2.5 hover:text-primary"
            href={`/teams/${side.team_id}?season=${game.season}`}
          >
            <TeamLogo team={side.team_id} />
            <span className={cn("text-sm font-bold tracking-wide", won && "text-foreground")}>
              {side.team_id}
            </span>
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {side.nickname ?? side.name}
            </span>
          </Link>
          <span
            className={cn(
              "font-heading text-xl tabular-nums",
              won ? "font-bold text-primary" : "text-foreground",
            )}
          >
            {side.score ?? "-"}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
        <span>{formatDate(game.date)}</span>
        {game.final ? (
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link href={`/games/${encodeURIComponent(game.game_id)}`}>Box score →</Link>
          </Button>
        ) : (
          <Badge variant="outline">UPCOMING</Badge>
        )}
      </div>
    </Card>
  );
}

export default function ScoresPage() {
  useTitle("Scores");
  const [data, setData] = useState<GamesResponse | null>(null);
  // Season/week live in the URL: refresh, share and back-nav keep the view.
  const [season, setSeason] = useNumParam("season");
  const [week, setWeek] = useNumParam("week");
  const [performers, setPerformers] = useState<PerformersResponse | null>(null);
  // Settles true once the performers fetch resolves (success OR failure), so a
  // failed fetch shows the empty state instead of a permanent skeleton.
  const [perfLoaded, setPerfLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchGames(season, week)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
      })
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [season, week]);

  // Performers follow the games panel's resolved season/week.
  useEffect(() => {
    if (!data) return;
    let active = true;
    setPerformers(null);
    setPerfLoaded(false);
    fetchPerformers(data.season, data.week, 5)
      .then((p) => active && setPerformers(p))
      .catch(() => active && setPerformers(null))
      .finally(() => active && setPerfLoaded(true));
    return () => {
      active = false;
    };
  }, [data]);

  const totalPoints = data?.games.reduce(
    (sum, g) => sum + (g.home.score ?? 0) + (g.away.score ?? 0),
    0,
  );
  const topGame = data?.games.reduce<GameRow | null>((best, g) => {
    const t = (g.home.score ?? 0) + (g.away.score ?? 0);
    const bt = best ? (best.home.score ?? 0) + (best.away.score ?? 0) : -1;
    return t > bt ? g : best;
  }, null);

  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          Scores &amp; Results
        </h1>
        {data && (
          <Select
            value={String(data.season)}
            onValueChange={(v) => {
              setSeason(Number(v));
              setWeek(undefined);
            }}
          >
            <SelectTrigger className="w-[160px]" aria-label="Select season">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.seasons.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} season
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <p className="mt-1 mb-6 max-w-prose text-muted-foreground">Every final, week by week.</p>

      {data && (
        <div
          className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-2"
          role="tablist"
          aria-label="Week"
          onKeyDown={tablistKeys}
        >
          {data.weeks.map((w) => {
            const selected = w === data.week;
            return (
              <button
                key={w}
                role="tab"
                aria-selected={selected}
                onClick={() => setWeek(w)}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold tabular-nums transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground",
                )}
                ref={(el) => {
                  // The selected week must be visible, not parked off-screen
                  // to the right of the scrolling strip.
                  if (el && selected) el.scrollIntoView({ block: "nearest", inline: "center" });
                }}
              >
                Wk {w}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div
          className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-10 text-center text-destructive"
          role="alert"
        >
          <h2 className="text-lg font-semibold">Couldn&rsquo;t load scores</h2>
          <p className="max-w-prose">{friendlyError(error)}</p>
        </div>
      )}

      {data && !error && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Card className="gap-1 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Games
              </div>
              <div className="font-heading text-3xl font-bold tabular-nums">{data.games.length}</div>
              <div className="text-xs text-muted-foreground">
                week {data.week}, {data.season}
              </div>
            </Card>
            <Card className="gap-1 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Points scored
              </div>
              <div className="font-heading text-3xl font-bold tabular-nums">{totalPoints}</div>
              <div className="text-xs text-muted-foreground">across the week</div>
            </Card>
            {topGame && (
              <Card className="gap-1 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Highest scoring
                </div>
                <div className="font-heading text-3xl font-bold tabular-nums">
                  {(topGame.home.score ?? 0) + (topGame.away.score ?? 0)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {topGame.away.team_id} @ {topGame.home.team_id}
                </div>
              </Card>
            )}
          </div>

          <section aria-label="Performers of the week" className="mt-6 mb-6">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-heading text-xl font-bold tracking-tight">
                Performers of the week
              </h2>
              <span className="text-sm text-muted-foreground">
                top PPR fantasy lines · week {data.week}
              </span>
            </div>
            <Performers performers={performers?.performers ?? null} loading={!perfLoaded} count={5} />
          </section>

          {data.games.length === 0 ? (
            <div className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
              <h2 className="text-lg font-semibold text-foreground">No games this week</h2>
              <p className="max-w-prose">
                Nothing final for week {data.week} yet. Pick another week above.
              </p>
            </div>
          ) : (
            <div
              className={cn(
                "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
                loading && "opacity-60",
              )}
            >
              {data.games.map((g) => (
                <GameCard key={g.game_id} game={g} />
              ))}
            </div>
          )}
        </>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[110px] rounded-xl" />
          ))}
        </div>
      )}
    </main>
  );
}
