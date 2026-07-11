"use client";

import Link from "next/link";
import { Headshot } from "./Headshot";
import { Skel } from "./Skeleton";
import { Card } from "@/components/ui/card";
import type { Performer } from "../lib/api";

/** Performers of the week: the top calculated fantasy player(s) for a week,
 *  each shown with headshot, PPR total and full stat line. */
export function Performers({
  performers,
  loading,
  count = 5,
}: {
  performers: Performer[] | null;
  loading?: boolean;
  count?: number;
}) {
  if (loading && !performers) {
    return (
      <ol className="space-y-2">
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>
            <Skel h={64} r={14} />
          </li>
        ))}
      </ol>
    );
  }
  // The section heading renders above this component — an empty week needs a
  // line under it, not a silent gap.
  if (!performers || performers.length === 0) {
    return <p className="text-muted-foreground">No completed games this week yet.</p>;
  }

  const top = performers[0]!;
  const rest = performers.slice(1, count);

  return (
    <div className="space-y-3">
      {/* Player of the week — the single best calculated fantasy line. */}
      <Card className="p-0">
        <Link
          className="flex items-center gap-4 rounded-xl p-4 transition-colors hover:bg-muted"
          href={`/players/${encodeURIComponent(top.player_id)}`}
          aria-label={`Player of the week: ${top.name}`}
        >
          <Headshot src={top.headshot_url} name={top.name} size={64} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xs font-bold uppercase tracking-wide text-primary">
              Player of the week
            </span>
            <span className="flex items-center gap-2 truncate">
              <span className="font-heading text-lg font-bold tracking-tight">{top.name}</span>
              <span className="text-xs font-bold tracking-wide text-muted-foreground">
                {top.position}
              </span>
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {top.team} vs {top.opponent} · {top.stat_line}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="font-heading text-3xl font-bold tabular-nums text-primary">
              {top.fantasy_points_ppr.toFixed(1)}
            </span>
            <span className="text-xs font-bold tracking-wide text-muted-foreground">PPR</span>
          </div>
        </Link>
      </Card>

      <ol className="space-y-1.5">
        {rest.map((p) => (
          <li key={p.player_id}>
            <Link
              className="flex items-center gap-3 rounded-lg border p-2.5 transition-colors hover:bg-muted"
              href={`/players/${encodeURIComponent(p.player_id)}`}
            >
              <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-muted-foreground">
                {p.rank}
              </span>
              <Headshot src={p.headshot_url} name={p.name} size={34} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 truncate">
                  <span className="truncate font-semibold">{p.name}</span>
                  <span className="text-xs font-bold tracking-wide text-muted-foreground">
                    {p.position}
                  </span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  vs {p.opponent} · {p.stat_line}
                </span>
              </span>
              <span className="font-heading text-lg font-bold tabular-nums">
                {p.fantasy_points_ppr.toFixed(1)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
