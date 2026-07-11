"use client";

import { useTitle } from "../lib/hooks";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { Headshot } from "../components/Headshot";
import { Skel } from "../components/Skeleton";
import {
  friendlyError, fetchFantasyPlayers, type FantasyPlayer, type FantasyPlayersResponse } from "../lib/api";

const SLOTS = [
  { id: "QB", label: "QB", accepts: ["QB"] },
  { id: "RB1", label: "RB", accepts: ["RB"] },
  { id: "RB2", label: "RB", accepts: ["RB"] },
  { id: "WR1", label: "WR", accepts: ["WR"] },
  { id: "WR2", label: "WR", accepts: ["WR"] },
  { id: "TE", label: "TE", accepts: ["TE"] },
  { id: "FLEX", label: "FLEX", accepts: ["RB", "WR", "TE"] },
] as const;

type SlotId = (typeof SLOTS)[number]["id"];
type Lineup = Partial<Record<SlotId, string>>;

const STORAGE_KEY = "yunoball_lineup_v1";
const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;

function loadLineup(season: number): Lineup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { season: number; slots: Lineup };
    return parsed.season === season ? parsed.slots : {};
  } catch {
    return {};
  }
}

function statLine(p: FantasyPlayer): string {
  if (p.position === "QB") {
    return `${p.passing_yards.toLocaleString()} pass yds · ${p.passing_tds} TD · ${p.interceptions} INT`;
  }
  if (p.position === "RB") {
    return `${p.rushing_yards.toLocaleString()} rush yds · ${p.rushing_tds + p.receiving_tds} TD · ${p.receptions} rec`;
  }
  return `${p.receptions} rec · ${p.receiving_yards.toLocaleString()} yds · ${p.receiving_tds} TD`;
}

export default function FantasyPage() {
  useTitle("Fantasy lineup builder");
  const [data, setData] = useState<FantasyPlayersResponse | null>(null);
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("ALL");
  const [query, setQuery] = useState("");
  const [lineup, setLineup] = useState<Lineup>({});
  // Clearing 7 picks deserves a takeback, not a confirm dialog.
  const [undoLineup, setUndoLineup] = useState<Lineup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchFantasyPlayers(season)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
        setLineup(loadLineup(d.season));
      })
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [season]);

  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ season: data.season, slots: lineup }));
    } catch {
      // storage full/blocked — lineup just won't persist
    }
  }, [lineup, data]);

  const byId = useMemo(() => {
    const m = new Map<string, FantasyPlayer>();
    data?.players.forEach((p) => m.set(p.player_id, p));
    return m;
  }, [data]);

  const rostered = useMemo(() => new Set(Object.values(lineup)), [lineup]);

  const pool = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.players.filter(
      (p) =>
        (position === "ALL" || p.position === position) &&
        (!q || p.name.toLowerCase().includes(q) || (p.team ?? "").toLowerCase().includes(q)),
    );
  }, [data, position, query]);

  const openSlotFor = (p: FantasyPlayer): SlotId | null => {
    for (const s of SLOTS) {
      if (!lineup[s.id] && s.accepts.includes(p.position as never)) return s.id;
    }
    return null;
  };

  const add = (p: FantasyPlayer) => {
    const slot = openSlotFor(p);
    if (!slot || rostered.has(p.player_id)) return;
    setLineup((prev) => ({ ...prev, [slot]: p.player_id }));
  };

  const remove = (slot: SlotId) => {
    setLineup((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  };

  const autoFill = () => {
    if (!data) return;
    const next: Lineup = { ...lineup };
    const taken = new Set(Object.values(next));
    for (const s of SLOTS) {
      if (next[s.id]) continue;
      const best = data.players.find(
        (p) =>
          !taken.has(p.player_id) &&
          s.accepts.includes(p.position as never) &&
          p.points_per_game > 0,
      );
      if (best) {
        next[s.id] = best.player_id;
        taken.add(best.player_id);
      }
    }
    setLineup(next);
  };

  const picks = SLOTS.map((s) => (lineup[s.id] ? byId.get(lineup[s.id]!) : undefined));
  const totalPpg = picks.reduce((sum, p) => sum + (p?.points_per_game ?? 0), 0);
  const totalSeason = picks.reduce((sum, p) => sum + (p?.fantasy_points_ppr ?? 0), 0);
  const filled = picks.filter(Boolean).length;
  const complete = filled === SLOTS.length;

  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          Fantasy Lineup Builder
        </h1>
        {data && (
          <Select
            value={String(data.season)}
            onValueChange={(v) => setSeason(Number(v))}
          >
            <SelectTrigger aria-label="Select season" className="w-[160px]">
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
      <p className="mt-1 mb-6 max-w-prose text-muted-foreground">
        Build a PPR lineup from real season production. Your picks save locally.
      </p>

      {error && (
        <div
          className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-10 text-center text-destructive"
          role="alert"
        >
          <h2 className="text-lg font-semibold">Couldn’t load the player pool</h2>
          <p className="max-w-prose">{friendlyError(error)}</p>
        </div>
      )}

      {loading && !data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skel h={480} r={14} />
          <Skel h={480} r={14} />
        </div>
      )}

      {data && !error && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-label="Your lineup">
            {/* role=status: lineup edits announce the recalculated total. */}
            <Card
              className={cn(
                "mb-4 gap-1 p-5 text-center",
                complete && "border-primary/50 bg-primary/5",
              )}
              role="status"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Projected points per game
              </div>
              <div className="font-heading text-5xl font-bold tabular-nums text-primary">
                {totalPpg.toFixed(1)}
              </div>
              <div className="text-sm text-muted-foreground">
                {filled}/{SLOTS.length} slots · {totalSeason.toFixed(1)} total PPR pts in{" "}
                {data.season}
              </div>
            </Card>

            <div className="flex flex-col gap-2">
              {SLOTS.map((s, i) => {
                const p = picks[i];
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "grid grid-cols-[3rem_1fr_auto_auto] items-center gap-3 rounded-lg border p-3",
                      p ? "bg-card" : "border-dashed bg-muted/30",
                    )}
                  >
                    <span className="text-xs font-bold tracking-wide text-muted-foreground">
                      {s.label}
                    </span>
                    {p ? (
                      <>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">
                            <Link
                              href={`/players/${encodeURIComponent(p.player_id)}`}
                              className="text-foreground hover:text-primary"
                            >
                              {p.name}
                            </Link>
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.team} · {statLine(p)}
                          </span>
                        </span>
                        <span className="text-sm font-semibold tabular-nums">
                          {p.points_per_game.toFixed(1)}/gm
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${p.name}`}
                          onClick={() => remove(s.id)}
                        >
                          <X className="size-4" />
                        </Button>
                      </>
                    ) : (
                      <span className="col-span-3 text-sm text-muted-foreground">
                        Add a {s.accepts.join("/")} from the pool →
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button variant="secondary" onClick={autoFill} disabled={complete}>
                Auto-fill best available
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setUndoLineup(lineup);
                  setLineup({});
                  setTimeout(() => setUndoLineup(null), 8000);
                }}
                disabled={filled === 0}
              >
                Clear
              </Button>
              {undoLineup && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => {
                    setLineup(undoLineup);
                    setUndoLineup(null);
                  }}
                >
                  Undo clear
                </Button>
              )}
            </div>
          </section>

          <section aria-label="Player pool">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                {POSITIONS.map((pos) => (
                  <Badge
                    key={pos}
                    asChild
                    variant={position === pos ? "default" : "outline"}
                  >
                    <button
                      aria-selected={position === pos}
                      onClick={() => setPosition(pos)}
                    >
                      {pos}
                    </button>
                  </Badge>
                ))}
              </div>
              <Input
                className="min-w-40 flex-1"
                placeholder="Search player or team…"
                aria-label="Search players"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="max-h-[560px] overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Pos</TableHead>
                    <TableHead className="text-right tabular-nums">PPR</TableHead>
                    <TableHead className="text-right tabular-nums">Pts/gm</TableHead>
                    <TableHead aria-label="Add" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pool.map((p) => {
                    const inLineup = rostered.has(p.player_id);
                    const slot = openSlotFor(p);
                    return (
                      <TableRow key={p.player_id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Headshot src={p.headshot_url} name={p.name} size={32} />
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                <Link
                                  href={`/players/${encodeURIComponent(p.player_id)}`}
                                  className="text-foreground hover:text-primary"
                                >
                                  {p.name}
                                </Link>
                              </div>
                              <div className="truncate text-xs font-normal text-muted-foreground">
                                {p.team} · {statLine(p)}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-bold tracking-wide text-muted-foreground">
                            {p.position}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.fantasy_points_ppr.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.points_per_game.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right">
                          {inLineup ? (
                            <Badge variant="secondary">In lineup</Badge>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!slot}
                              title={slot ? `Add to ${slot}` : "No open slot"}
                              onClick={() => add(p)}
                            >
                              + Add
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {pool.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        No players match that filter.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
