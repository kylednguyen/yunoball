"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AnswerResult } from "../lib/api";
import { Headshot } from "./Headshot";
import { SortTable } from "./SortTable";
import { TeamLogo } from "./TeamLogo";

/** A column is numeric if every non-empty cell parses as a number. */
function isNumericColumn(rows: AnswerResult["rows"], c: string): boolean {
  return rows.every((r) => r[c] === null || r[c] === undefined || r[c] === "" || !isNaN(Number(r[c])));
}

// Columns whose values are team abbreviations — linkable to team pages.
const TEAM_COLS = new Set(["opponent", "team", "team_id"]);

// Head-to-head rows, in display order. INT is a lower-is-better stat;
// rate stats never get divided by games in per-game mode.
const COMPARE_STATS: { key: string; label: string; lowerWins?: boolean; rate?: boolean }[] = [
  { key: "games", label: "Games", rate: true },
  { key: "completion_pct", label: "Comp pct", rate: true },
  { key: "passing_yards", label: "Pass yards" },
  { key: "passing_tds", label: "Pass TD" },
  { key: "interceptions", label: "INT", lowerWins: true },
  { key: "rushing_yards", label: "Rush yards" },
  { key: "rushing_tds", label: "Rush TD" },
  { key: "receptions", label: "Receptions" },
  { key: "receiving_yards", label: "Rec yards" },
  { key: "receiving_tds", label: "Rec TD" },
  { key: "tackles", label: "Tackles" },
  { key: "def_sacks", label: "Sacks" },
  { key: "def_interceptions", label: "Def INT" },
  { key: "forced_fumbles", label: "Forced fum" },
  { key: "passes_defended", label: "Passes def" },
  { key: "fantasy_points_ppr", label: "Fantasy PPR" },
];

// Abbreviated column headers spelled out for the header tooltip.
const HEADER_TITLES: Record<string, string> = {
  gp: "Games played", cmp: "Completions", att: "Attempts",
  pass_yds: "Passing yards", pass_td: "Passing touchdowns", int: "Interceptions",
  rush_yds: "Rushing yards", rush_td: "Rushing touchdowns", car: "Carries",
  rec: "Receptions", rec_yds: "Receiving yards", rec_td: "Receiving touchdowns",
  tkl: "Tackles", sck: "Sacks", ff: "Forced fumbles", pd: "Passes defended",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO-ish date value -> "Nov 17, 2024" (string math, no timezone drift). */
function fmtGameDate(v: unknown): string {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : String(v ?? "");
}

const fmtStat = (v: number, dp = 0) =>
  Number.isInteger(v) && dp === 0 ? v.toLocaleString() : v.toFixed(dp || 1);

// Identifier-like columns must never get thousands separators ("2,025").
const NO_GROUPING = new Set(["season", "week", "year", "round", "pick", "rank", "qtr"]);

/** Table-cell number: separators for real quantities, identity for ids. */
function fmtCell(c: string, v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || NO_GROUPING.has(c)) return String(v);
  return n.toLocaleString("en-US");
}

type MiniCard = NonNullable<AnswerResult["player_card"]>;

/** Head-to-head chart: one compact element — both players (headshot, name,
 * team) in the header with the totals/per-game toggle centered between them,
 * then one mirrored-bar row per stat, the leader's bar in the accent color. */
function CompareChart({ rows, cards }: { rows: AnswerResult["rows"]; cards: MiniCard[] }) {
  const [perGame, setPerGame] = useState(false);
  const [a, b] = rows;
  if (!a || !b) return null;

  const val = (p: typeof a, key: string, rate?: boolean): number => {
    if (key === "completion_pct") {
      const att = Number(p.attempts ?? 0);
      return att ? (Number(p.completions ?? 0) / att) * 100 : 0;
    }
    const raw = Number(p[key] ?? 0);
    const gp = Number(p.games ?? 0);
    return perGame && !rate && gp ? raw / gp : raw;
  };

  // Incidental defensive counts (a QB's tackle after his own interception)
  // don't earn a row; real defensive production does.
  const DEF_KEYS = new Set(["tackles", "def_sacks", "def_interceptions", "forced_fumbles", "passes_defended"]);
  const stats = COMPARE_STATS.filter(({ key }) => {
    if (key === "games") return true;
    if (key === "completion_pct") return Number(a.attempts) > 0 || Number(b.attempts) > 0;
    const max = Math.max(Number(a[key]) || 0, Number(b[key]) || 0);
    return DEF_KEYS.has(key) ? max > 3 : max > 0;
  });

  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b pb-3">
        {[a, b].map((p, i) => {
          const card = cards.find((c) => c.player_id === String(p.player_id));
          const side = (
            <Link
              key={String(p.player_id)}
              className={cn(
                "flex min-w-0 items-center gap-2.5 text-sm font-bold hover:text-primary",
                i === 1 && "flex-row-reverse justify-self-end text-right",
              )}
              href={`/players/${encodeURIComponent(String(p.player_id))}`}
            >
              {card && <Headshot src={card.headshot_url} name={card.name} size={40} />}
              <span className="flex min-w-0 flex-col gap-px">
                <span className={cn("flex items-center gap-1.5", i === 1 && "justify-end")}>
                  {String(p.full_name)}
                  {card?.position && (
                    <span className="text-xs font-bold tracking-wide text-muted-foreground">
                      {card.position}
                    </span>
                  )}
                </span>
                {card?.team && (
                  <span
                    className={cn(
                      "flex items-center gap-1 text-xs font-medium text-muted-foreground",
                      i === 1 && "justify-end",
                    )}
                  >
                    <TeamLogo team={card.team} size={13} />
                    {card.team_name ?? card.team}
                  </span>
                )}
              </span>
            </Link>
          );
          if (i === 0) {
            return (
              // Toggle sits between the two players, in DOM order too.
              <span key="a-and-toggle" style={{ display: "contents" }}>
                {side}
                <div
                  className="inline-flex overflow-hidden rounded-md border"
                  role="group"
                  aria-label="Value mode"
                >
                  {(["Totals", "Per game"] as const).map((m) => {
                    const on = perGame === (m === "Per game");
                    return (
                      <button
                        key={m}
                        aria-pressed={on}
                        onClick={() => setPerGame(m === "Per game")}
                        className={cn(
                          "px-2.5 py-1 text-xs font-semibold transition-colors",
                          on
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </span>
            );
          }
          return side;
        })}
      </div>
      {stats.map(({ key, label, lowerWins, rate }) => {
        const va = val(a, key, rate);
        const vb = val(b, key, rate);
        const max = Math.max(va, vb) || 1;
        // Games sets context, it isn't a contest: no leader highlight.
        const contest = key !== "games" && va !== vb;
        const aLeads = contest && (lowerWins ? va < vb : va > vb);
        const bLeads = contest && !aLeads;
        const dp = key === "completion_pct" || (perGame && !rate) ? 1 : 0;
        const unit = key === "completion_pct" ? "%" : "";
        return (
          <div
            key={key}
            className="grid grid-cols-[64px_1fr_88px_1fr_64px] items-center gap-2.5 py-1 sm:grid-cols-[72px_1fr_96px_1fr_72px]"
          >
            <span className={cn("text-sm font-semibold tabular-nums", aLeads && "font-bold text-primary")}>
              {fmtStat(va, dp)}{unit}
            </span>
            <span className="flex h-2 justify-end overflow-hidden rounded-sm bg-muted" aria-hidden="true">
              <span
                className={cn("block h-full rounded-sm bg-muted-foreground/40", aLeads && "bg-primary")}
                style={{ width: `${(va / max) * 100}%` }}
              />
            </span>
            <span className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            <span className="h-2 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
              <span
                className={cn("block h-full rounded-sm bg-muted-foreground/40", bLeads && "bg-primary")}
                style={{ width: `${(vb / max) * 100}%` }}
              />
            </span>
            <span className={cn("text-right text-sm font-semibold tabular-nums", bLeads && "font-bold text-primary")}>
              {fmtStat(vb, dp)}{unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AnswerCard({ result }: { result: AnswerResult }) {
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const numericCols = useMemo(
    () => new Set(result.columns.filter((c) => isNumericColumn(result.rows, c))),
    [result],
  );

  // When rows carry a player_id, the name column links to the player page and
  // the raw id column stays hidden. Game rows likewise link their date to the
  // box score and hide the raw game_id.
  const linkPlayers =
    result.columns.includes("player_id") && result.columns.includes("full_name");
  const linkGames = result.columns.includes("game_id");
  const columns = result.columns.filter(
    (c) => !(linkPlayers && c === "player_id") && !(linkGames && c === "game_id"),
  );

  function downloadCsv() {
    const esc = (v: unknown) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [
      columns.join(","),
      ...result.rows.map((r) => columns.map((c) => esc(r[c])).join(",")),
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `yunoball-${(result.question || "answer").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copyShareLink() {
    if (!result.share_id) return;
    const url = `${window.location.origin}/a/${result.share_id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const cards = [result.player_card, result.player_card2].filter(
    (c): c is NonNullable<typeof c> => Boolean(c),
  );
  // Head-to-head renders as one compact element: the chart header carries the
  // player identities, so the separate mini cards would be repetition.
  const isCompare = result.intent === "compare" && result.rows.length === 2;
  // Entity chips only add value for entities the mini cards don't already cover.
  const chips = (result.entities ?? []).filter(
    (e) => !(e.entity_type === "player" && cards.some((c) => c.player_id === e.canonical_id)),
  );

  return (
    <Card className="mt-7 gap-4 p-6">
      <p className="font-heading text-2xl font-extrabold leading-tight text-balance sm:text-3xl">
        {result.narration}
      </p>

      {!isCompare && cards.length > 0 && (
        <div className="flex flex-col gap-2">
          {cards.map((card) => (
            <Link
              key={card.player_id}
              href={`/players/${encodeURIComponent(card.player_id)}`}
              className="group flex items-center gap-3 rounded-lg border bg-muted/40 p-3 transition-colors hover:bg-muted"
            >
              <Headshot src={card.headshot_url} name={card.name} size={52} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 font-bold">
                  {card.name}
                  {card.position && (
                    <span className="text-xs font-bold tracking-wide text-muted-foreground">
                      {card.position}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {card.team && <TeamLogo team={card.team} size={14} />}
                  {card.team_name ?? card.team ?? "-"}
                </span>
              </span>
              <span className="text-sm font-medium text-muted-foreground group-hover:text-primary" aria-hidden="true">
                View profile →
              </span>
            </Link>
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((e) => (
            <Badge key={`${e.entity_type}-${e.display_name}`} variant="outline" asChild>
              <Link
                href={
                  e.entity_type === "player"
                    ? `/players/${encodeURIComponent(e.canonical_id)}`
                    : `/teams/${e.canonical_id}`
                }
                title={`View ${e.display_name}'s ${e.entity_type} page`}
              >
                {e.display_name} →
              </Link>
            </Badge>
          ))}
        </div>
      )}

      {isCompare && <CompareChart rows={result.rows} cards={cards} />}

      {!isCompare && result.rows.length > 0 && (
        <SortTable
          rows={result.rows.map((row, i) => ({ row, i }))}
          rowKey={({ i }) => String(i)}
          columns={columns.map((c) => ({
            key: c,
            label:
              c === "full_name" ? "player" : c === "game_date" ? "date" : c.replace(/_/g, " "),
            numeric: numericCols.has(c),
            title: HEADER_TITLES[c],
            value: ({ row }: { row: AnswerResult["rows"][number]; i: number }) => {
              const v = row[c];
              if (v === null || v === undefined || v === "") return null;
              if (c === "game_date") return String(v).slice(0, 10);
              return numericCols.has(c) ? Number(v) : String(v);
            },
            render: ({ row }: { row: AnswerResult["rows"][number]; i: number }) => {
              const v = row[c];
              if (v === null || v === undefined || v === "") return <>{""}</>;
              if (c === "full_name" && linkPlayers && row.player_id) {
                return (
                  <Link href={`/players/${encodeURIComponent(String(row.player_id))}`}>
                    {String(v)}
                  </Link>
                );
              }
              if (c === "game_date") {
                const d = fmtGameDate(v);
                if (linkGames && row.game_id) {
                  return (
                    <Link href={`/games/${encodeURIComponent(String(row.game_id))}`}>{d}</Link>
                  );
                }
                return <>{d}</>;
              }
              if (TEAM_COLS.has(c) && typeof v === "string" && /^[A-Z]{2,3}$/.test(v)) {
                return <Link href={`/teams/${v}`}>{v}</Link>;
              }
              return <>{numericCols.has(c) ? fmtCell(c, v) : String(v)}</>;
            },
          }))}
        />
      )}

      <div className="mt-1 flex items-center gap-4 border-t pt-4">
        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowSql((s) => !s)}>
          {showSql ? "Hide" : "Show"} the query
        </Button>
        {result.rows.length > 0 && (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={downloadCsv}>
            Download CSV
          </Button>
        )}
        {result.share_id && (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={copyShareLink}>
            {copied ? "Link copied ✓" : "Share"}
            <span role="status" className="sr-only">
              {copied ? "Share link copied to clipboard" : ""}
            </span>
          </Button>
        )}
        {result.cached && <span className="text-xs text-muted-foreground">Cached</span>}
      </div>

      {showSql && (
        <pre className="overflow-x-auto rounded-md border bg-muted p-4 font-mono text-xs text-muted-foreground">
          {result.sql}
        </pre>
      )}
    </Card>
  );
}
