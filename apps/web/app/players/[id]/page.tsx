"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { Crumbs } from "../../components/Crumbs";
import { Dropdown } from "../../components/Dropdown";
import { Headshot } from "../../components/Headshot";
import { SortTable } from "../../components/SortTable";
import { TeamLogo } from "../../components/TeamLogo";
import { usePlayer, usePlayerSplits, useSeasonParam, useTitle } from "../../lib/hooks";
import { passerRating } from "../../lib/rating";
import { friendlyError } from "../../lib/api";
import type { PlayerProfile, PlayerSeasonLine, SplitRow } from "../../lib/api";

type SeasonRow = PlayerProfile["seasons"][number];
type GameRow = PlayerProfile["game_log"][number];

const TABS = ["Overview", "Splits", "Game Log", "Career", "Playoffs"] as const;
type Tab = (typeof TABS)[number];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** '2016-10-27' -> 'Oct 27, 2016' — string math, no timezone surprises. */
function fmtDate(d: string | null): string | null {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null;
}

function fmtHeight(inches: number | null): string | null {
  if (!inches) return null;
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function ageFrom(birthDate: string | null): number | null {
  const m = birthDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const now = new Date();
  const age = now.getFullYear() - Number(m[1]);
  const hadBirthday =
    now.getMonth() + 1 > Number(m[2]) ||
    (now.getMonth() + 1 === Number(m[2]) && now.getDate() >= Number(m[3]));
  return hadBirthday ? age : age - 1;
}

const TD_KIND: Record<string, string> = {
  pass: "Receiving",
  run: "Rushing",
  kickoff: "Kick return",
  punt: "Punt return",
};

/** Position decides which stat family leads the tiles and tables. */
function tiles(
  p: PlayerProfile,
  line: PlayerSeasonLine | PlayerProfile["career"],
  meta: string,
): { label: string; value: string; meta: string }[] {
  const fmt = (n: number) => n.toLocaleString();
  const games = "games_played" in line ? line.games_played : 0;
  const ppg = games ? (line.fantasy_points_ppr / games).toFixed(1) : "0.0";
  const fantasy = {
    label: "Fantasy PPG",
    value: ppg,
    meta: `${line.fantasy_points_ppr.toFixed(1)} total (PPR)`,
  };
  if (p.position === "QB") {
    return [
      { label: "Passing yards", value: fmt(line.passing_yards), meta },
      { label: "Passing TDs", value: fmt(line.passing_tds), meta: `${line.interceptions} INT` },
      { label: "Rushing yards", value: fmt(line.rushing_yards), meta: `${line.rushing_tds} TD` },
      fantasy,
    ];
  }
  if (p.position === "RB") {
    return [
      { label: "Rushing yards", value: fmt(line.rushing_yards), meta },
      { label: "Rushing TDs", value: fmt(line.rushing_tds), meta },
      { label: "Receptions", value: fmt(line.receptions), meta: `${fmt(line.receiving_yards)} yds` },
      fantasy,
    ];
  }
  return [
    { label: "Receptions", value: fmt(line.receptions), meta },
    { label: "Receiving yards", value: fmt(line.receiving_yards), meta: `${line.receiving_tds} TD` },
    { label: "Rushing yards", value: fmt(line.rushing_yards), meta: `${line.rushing_tds} TD` },
    fantasy,
  ];
}

interface SeasonCol {
  key: string;
  label: string;
  /** Custom value (derived stats). Defaults to the raw column. */
  val?: (s: SeasonRow) => number | null;
  /** Rate stats render as-is — never divided by games in per-game mode. */
  rate?: boolean;
  /** Decimal places (default 0). */
  dp?: number;
}

const DEFENSIVE = new Set(["LB", "ILB", "OLB", "MLB", "DE", "DT", "NT", "CB", "S", "FS", "SS", "DB", "EDGE"]);

function seasonColumns(position: string | null): SeasonCol[] {
  if (position === "QB") {
    return [
      { key: "completions", label: "CMP" },
      { key: "attempts", label: "ATT" },
      { key: "pct", label: "PCT", rate: true, dp: 1,
        val: (s) => (s.attempts ? (s.completions / s.attempts) * 100 : null) },
      { key: "att_g", label: "ATT/G", rate: true, dp: 1,
        val: (s) => (s.games_played ? s.attempts / s.games_played : null) },
      { key: "passing_yards", label: "YDS" },
      { key: "avg", label: "AVG", rate: true, dp: 1,
        val: (s) => (s.attempts ? s.passing_yards / s.attempts : null) },
      { key: "yds_g", label: "YDS/G", rate: true, dp: 1,
        val: (s) => (s.games_played ? s.passing_yards / s.games_played : null) },
      { key: "passing_tds", label: "TD" },
      { key: "interceptions", label: "INT" },
      { key: "rtg", label: "RTG", rate: true, dp: 1,
        val: (s) => passerRating(s.completions, s.attempts, s.passing_yards, s.passing_tds, s.interceptions) },
      { key: "td_pct", label: "TD%", rate: true, dp: 1,
        val: (s) => (s.attempts ? (s.passing_tds / s.attempts) * 100 : null) },
      { key: "int_pct", label: "INT%", rate: true, dp: 1,
        val: (s) => (s.attempts ? (s.interceptions / s.attempts) * 100 : null) },
      { key: "sacks", label: "SCK" },
      { key: "sack_yards", label: "SCKY" },
      { key: "rushing_yards", label: "RUSH YDS" },
      { key: "rushing_tds", label: "RUSH TD" },
      { key: "fumbles", label: "FUM" },
      { key: "fumbles_lost", label: "LOST" },
    ];
  }
  if (position && DEFENSIVE.has(position)) {
    return [
      { key: "tackles", label: "TKL" },
      { key: "def_sacks", label: "SCK", dp: 1 },
      { key: "def_interceptions", label: "INT" },
      { key: "forced_fumbles", label: "FF" },
      { key: "passes_defended", label: "PD" },
    ];
  }
  if (position === "RB") {
    return [
      { key: "rushing_yards", label: "Rush yds" },
      { key: "rushing_tds", label: "Rush TD" },
      { key: "receptions", label: "Rec" },
      { key: "receiving_yards", label: "Rec yds" },
      { key: "receiving_tds", label: "Rec TD" },
      { key: "fumbles_lost", label: "FUM lost" },
    ];
  }
  return [
    { key: "receptions", label: "Rec" },
    { key: "receiving_yards", label: "Rec yds" },
    { key: "receiving_tds", label: "Rec TD" },
    { key: "rushing_yards", label: "Rush yds" },
    { key: "rushing_tds", label: "Rush TD" },
    { key: "fumbles_lost", label: "FUM lost" },
  ];
}

/** Season-by-season table shared by Career (REG) and Playoffs (POST) tabs. */
function SeasonTable({
  rows,
  position,
  perGame,
  showRank,
}: {
  rows: PlayerSeasonLine[];
  position: string | null;
  perGame: boolean;
  showRank: boolean;
}) {
  const cols = seasonColumns(position);
  return (
    <SortTable<SeasonRow>
      rows={rows}
      rowKey={(s) => String(s.season)}
      defaultSort={{ key: "season", dir: "desc" }}
      columns={[
        { key: "season", label: "Season", numeric: true, value: (s) => s.season },
        {
          key: "team",
          label: "Team",
          value: (s) => s.team,
          render: (s) =>
            s.team ? (
              <Link
                href={`/teams/${s.team}?season=${s.season}`}
                className="inline-flex items-center gap-1.5 font-normal text-muted-foreground"
              >
                <TeamLogo team={s.team} size={16} />
                {s.team}
              </Link>
            ) : (
              "-"
            ),
        },
        { key: "gp", label: "GP", numeric: true, value: (s) => s.games_played },
        ...cols.map((c) => ({
          key: c.key,
          label: !c.rate && perGame ? `${c.label}/G` : c.label,
          numeric: true,
          value: (s: SeasonRow) => {
            const raw = c.val ? c.val(s) : (s[c.key as keyof SeasonRow] as number);
            if (raw === null) return null;
            return !c.rate && perGame ? (s.games_played ? raw / s.games_played : 0) : raw;
          },
          render: (s: SeasonRow) => {
            const raw = c.val ? c.val(s) : (s[c.key as keyof SeasonRow] as number);
            if (raw === null) return <>-</>;
            if (!c.rate && perGame) {
              return <>{s.games_played ? (raw / s.games_played).toFixed(1) : "-"}</>;
            }
            return <>{c.dp ? raw.toFixed(c.dp) : raw.toLocaleString()}</>;
          },
        })),
        {
          key: "ppg",
          label: "PPG",
          numeric: true,
          value: (s) => s.points_per_game,
          render: (s) => (
            <span className="font-bold">{s.points_per_game.toFixed(1)}</span>
          ),
        },
        ...(showRank
          ? [
              {
                key: "pos_rank",
                label: "Rank",
                numeric: true,
                value: (s: SeasonRow) => s.position_rank,
                render: (s: SeasonRow) =>
                  s.position_rank ? (
                    <span className={s.position_rank <= 5 ? "font-semibold text-primary" : undefined}>
                      #{s.position_rank}
                      <span className="text-muted-foreground"> of {s.position_players}</span>
                    </span>
                  ) : (
                    <>-</>
                  ),
              },
            ]
          : []),
      ]}
    />
  );
}

/** Game log table shared by Overview (recent), Game Log and Playoffs tabs. */
function GameLogTable({ rows, position }: { rows: GameRow[]; position: string | null }) {
  return (
    <SortTable<GameRow>
      rows={rows}
      rowKey={(g) => g.game_id}
      columns={[
        {
          key: "game",
          label: "Game",
          value: (g) => g.season * 100 + g.week,
          render: (g) => (
            <Link
              href={`/games/${encodeURIComponent(g.game_id)}`}
              title="Open box score"
              className="inline-flex items-center gap-1.5"
            >
              {fmtDate(g.date) ?? `${g.season} Wk ${g.week}`} {g.home ? "vs" : "@"}
              <TeamLogo team={g.opponent} size={16} /> {g.opponent}
            </Link>
          ),
        },
        {
          key: "result",
          label: "Result",
          value: (g) => g.result,
          render: (g) => (
            <span
              className={
                g.result === "W"
                  ? "font-semibold text-primary"
                  : g.result === "L"
                    ? "font-semibold text-destructive"
                    : undefined
              }
            >
              {g.result} {g.team_score ?? "-"}-{g.opp_score ?? "-"}
            </span>
          ),
        },
        ...(position === "QB"
          ? [
              {
                key: "pass_yds",
                label: "Pass yds",
                numeric: true,
                value: (g: GameRow) => g.passing_yards,
                render: (g: GameRow) => <>{g.passing_yards.toLocaleString()}</>,
              },
              {
                key: "pass_td",
                label: "Pass TD",
                numeric: true,
                value: (g: GameRow) => g.passing_tds,
              },
            ]
          : []),
        { key: "rush_yds", label: "Rush yds", numeric: true, value: (g) => g.rushing_yards },
        { key: "rush_td", label: "Rush TD", numeric: true, value: (g) => g.rushing_tds },
        { key: "rec", label: "Rec", numeric: true, value: (g) => g.receptions },
        { key: "rec_yds", label: "Rec yds", numeric: true, value: (g) => g.receiving_yards },
        { key: "rec_td", label: "Rec TD", numeric: true, value: (g) => g.receiving_tds },
      ]}
    />
  );
}

/** One splits group as a table with derived PCT / yds-per-game columns. */
function SplitsGroup({ title, rows, position }: { title: string; rows: SplitRow[]; position: string | null }) {
  const per = (v: number, gp: number) => (gp ? (v / gp).toFixed(1) : "-");
  const isQB = position === "QB";
  return (
    <section className="mt-6">
      <h2 className="mb-3 font-heading text-lg font-semibold">{title}</h2>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap text-xs uppercase tracking-wide">
                {title === "Overall" ? "Season" : title}
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wide">GP</TableHead>
              {isQB && (
                <>
                  <TableHead className="text-right text-xs uppercase tracking-wide">CMP</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">ATT</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">PCT</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">Pass yds</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">Yds/G</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">TD</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">INT</TableHead>
                </>
              )}
              {!isQB && (
                <>
                  <TableHead className="text-right text-xs uppercase tracking-wide">Rush yds</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">Rush TD</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">Rec</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">Rec yds</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">Yds/G</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">Rec TD</TableHead>
                </>
              )}
              <TableHead className="text-right text-xs uppercase tracking-wide">Rush yds</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wide">Rush TD</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wide">PPG</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{r.gp}</TableCell>
                {isQB && (
                  <>
                    <TableCell className="text-right tabular-nums">{r.completions.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.attempts.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.attempts ? ((r.completions / r.attempts) * 100).toFixed(1) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.passing_yards.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{per(r.passing_yards, r.gp)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.passing_tds}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.interceptions}</TableCell>
                  </>
                )}
                {!isQB && (
                  <>
                    <TableCell className="text-right tabular-nums">{r.rushing_yards.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.rushing_tds}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.receptions}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.receiving_yards.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {per(
                        position === "RB" ? r.rushing_yards : r.receiving_yards,
                        r.gp,
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.receiving_tds}</TableCell>
                  </>
                )}
                <TableCell className="text-right tabular-nums">{r.rushing_yards.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.rushing_tds}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {per(r.fantasy_points_ppr, r.gp)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/** Stat tiles grid — season and career overview. */
function Tiles({ items }: { items: { label: string; value: string; meta: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((t) => (
        <Card key={t.label} className="gap-1 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.label}</div>
          <div className="font-heading text-2xl font-bold tabular-nums">{t.value}</div>
          <div className="text-xs text-muted-foreground">{t.meta}</div>
        </Card>
      ))}
    </div>
  );
}

/** Section heading shared across tabs. */
function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("mb-3 font-heading text-xl font-semibold tracking-tight", className)}>
      {children}
    </h2>
  );
}

export default function PlayerPage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id ? decodeURIComponent(params.id) : undefined;
  const [season, setSeason] = useSeasonParam();
  const [tab, setTab] = useState<Tab>("Overview");
  const [perGame, setPerGame] = useState(false);
  const { data: profile, error, loading } = usePlayer(playerId);
  useTitle(profile?.name);
  const { data: splits, loading: splitsLoading } = usePlayerSplits(
    playerId,
    season,
    tab === "Splits",
  );
  const notFound = !loading && !error && profile === null;

  const latest = profile?.seasons[0];
  const regLog = profile?.game_log.filter((g) => g.season_type === "REG") ?? [];
  const postLog = profile?.game_log.filter((g) => g.season_type === "POST") ?? [];
  const hasPlayoffs = (profile?.postseasons.length ?? 0) > 0 || postLog.length > 0;
  const gameLog = season ? regLog.filter((g) => g.season === season) : regLog;
  const logSeasons = [...new Set(regLog.map((g) => g.season))];

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {loading && (
        <>
          <Skeleton className="mb-5 h-[60px] w-[380px] max-w-full rounded-lg" />
          <Skeleton className="mb-5 h-28 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </>
      )}

      {error && (
        <div
          className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-10 text-center text-destructive"
          role="alert"
        >
          <h2 className="text-lg font-semibold">Couldn’t load this player</h2>
          <p className="max-w-prose">{friendlyError(error)}</p>
        </div>
      )}

      {notFound && (
        <div className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">Player not found</h2>
          <p className="max-w-prose">
            That player isn’t in the warehouse yet. Try the{" "}
            <Link href="/leaders" className="text-primary hover:underline">
              leaders
            </Link>{" "}
            or{" "}
            <Link href="/" className="text-primary hover:underline">
              search
            </Link>
            .
          </p>
        </div>
      )}

      {profile && (
        <>
          <Crumbs
            items={[
              { label: "NFL", href: "/" },
              ...(profile.team ? [{ label: profile.team, href: `/teams/${profile.team}` }] : []),
              { label: profile.name },
            ]}
          />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <Headshot src={profile.headshot_url} name={profile.name} size={72} />
              <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
                {profile.name}
              </h1>
              {profile.position && (
                <span className="text-xs font-bold tracking-wide text-muted-foreground">
                  {profile.position}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={() =>
                (window.location.href = `/?q=${encodeURIComponent(
                  `${profile.name} career stats`,
                )}`)
              }
            >
              Ask about {profile.name.split(" ").pop()} →
            </Button>
          </div>
          <p className="mt-1 mb-6 max-w-prose text-muted-foreground">
            {profile.team ? (
              <Link className="text-primary hover:underline" href={`/teams/${profile.team}`}>
                {profile.team_name ?? profile.team}
              </Link>
            ) : (
              "-"
            )}{" "}
            · {profile.career.seasons} season
            {profile.career.seasons === 1 ? "" : "s"}, {profile.career.games_played} games
            {latest?.position_rank && profile.position ? (
              <>
                {" "}
                · {profile.position} #{latest.position_rank} of {latest.position_players} in{" "}
                {latest.season} (PPR)
              </>
            ) : null}
          </p>

          <Card className="mb-6">
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 md:grid-cols-6">
                {[
                  { label: "Height", value: fmtHeight(profile.bio.height_inches) },
                  {
                    label: "Weight",
                    value: profile.bio.weight_lbs ? `${profile.bio.weight_lbs} lbs` : null,
                  },
                  {
                    label: "Age",
                    value: (() => {
                      const age = ageFrom(profile.bio.birth_date);
                      return age ? `${age} years` : null;
                    })(),
                  },
                  { label: "Born", value: fmtDate(profile.bio.birth_date) },
                  { label: "College", value: profile.bio.college },
                  {
                    label: "Seasons",
                    value:
                      profile.bio.first_season && profile.bio.last_season
                        ? `${profile.bio.first_season}–${profile.bio.last_season}`
                        : null,
                  },
                ]
                  .filter((f) => f.value)
                  .map((f) => (
                    <div key={f.label}>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {f.label}
                      </dt>
                      <dd className="mt-0.5 font-medium">{f.value}</dd>
                    </div>
                  ))}
              </dl>
            </CardContent>
          </Card>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList aria-label="Player views">
              {TABS.filter((t) => t !== "Playoffs" || hasPlayoffs).map((t) => (
                <TabsTrigger key={t} value={t}>
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="Overview" className="mt-6">
              {latest && (
                <>
                  <SectionTitle>{latest.season} season</SectionTitle>
                  <Tiles items={tiles(profile, latest, `${latest.games_played} games`)} />
                </>
              )}
              <SectionTitle className="mt-6">Career</SectionTitle>
              <Tiles items={tiles(profile, profile.career, "career")} />
              {regLog.length > 0 && (
                <>
                  <SectionTitle className="mt-6">Recent games</SectionTitle>
                  <GameLogTable rows={regLog.slice(0, 5)} position={profile.position} />
                </>
              )}
              {profile.scoring_plays.length > 0 && (
                <p className="mt-3.5 text-muted-foreground">
                  {profile.scoring_plays.length} career touchdowns. First on{" "}
                  {fmtDate(profile.scoring_plays.at(-1)!.date)} against{" "}
                  {profile.scoring_plays.at(-1)!.opponent}, most recent on{" "}
                  {fmtDate(profile.scoring_plays[0]!.date)} against{" "}
                  {profile.scoring_plays[0]!.opponent}.
                </p>
              )}
            </TabsContent>

            <TabsContent value="Splits" className="mt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <SectionTitle className="mb-0">Splits</SectionTitle>
                {splits && (
                  <Dropdown
                    ariaLabel="Splits season"
                    value={String(splits.season)}
                    onChange={(v) => setSeason(Number(v))}
                    options={splits.seasons.map((s) => ({
                      value: String(s),
                      label: `${s} season`,
                    }))}
                  />
                )}
              </div>
              {splitsLoading && <Skeleton className="h-64 rounded-xl" />}
              {!splitsLoading && splits === null && (
                <div className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
                  <h2 className="text-lg font-semibold text-foreground">No splits available</h2>
                  <p className="max-w-prose">No per-game data for this player yet.</p>
                </div>
              )}
              {!splitsLoading &&
                splits?.groups.map((g) => (
                  <SplitsGroup
                    key={g.title}
                    title={g.title}
                    rows={g.rows}
                    position={profile.position}
                  />
                ))}
            </TabsContent>

            <TabsContent value="Game Log" className="mt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <SectionTitle className="mb-0">Game log</SectionTitle>
                <Dropdown
                  ariaLabel="Filter game log by season"
                  value={season ? String(season) : "all"}
                  onChange={(v) => setSeason(v === "all" ? undefined : Number(v))}
                  options={[
                    { value: "all", label: "All seasons" },
                    ...logSeasons.map((s) => ({ value: String(s), label: `${s} season` })),
                  ]}
                />
              </div>
              {gameLog.length === 0 ? (
                <div className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
                  <h2 className="text-lg font-semibold text-foreground">
                    No games{season ? ` for ${season}` : ""}
                  </h2>
                  <p className="max-w-prose">No per-game rows here. Pick another season above.</p>
                </div>
              ) : (
                <GameLogTable rows={gameLog} position={profile.position} />
              )}
            </TabsContent>

            <TabsContent value="Career" className="mt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <SectionTitle className="mb-0">Season by season</SectionTitle>
                <div
                  className="inline-flex overflow-hidden rounded-md border"
                  role="group"
                  aria-label="Stat display mode"
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
              </div>
              <SeasonTable
                rows={profile.seasons}
                position={profile.position}
                perGame={perGame}
                showRank
              />
              {profile.scoring_plays.length > 0 && (
                <>
                  <SectionTitle className="mt-7">Touchdown log</SectionTitle>
                  <SortTable
                    rows={profile.scoring_plays}
                    rowKey={(t) => `${t.game_id}-${t.description?.slice(0, 24)}`}
                    columns={[
                      {
                        key: "game",
                        label: "Game",
                        numeric: true,
                        value: (t) => t.season * 100 + t.week,
                        render: (t) => (
                          <Link
                            href={`/teams/${t.opponent}?season=${t.season}`}
                            className="inline-flex items-center gap-1.5"
                          >
                            {fmtDate(t.date) ?? `${t.season} Wk ${t.week}`} vs
                            <TeamLogo team={t.opponent} size={16} /> {t.opponent}
                          </Link>
                        ),
                      },
                      {
                        key: "kind",
                        label: "Type",
                        value: (t) => TD_KIND[t.play_type ?? ""] ?? t.play_type,
                        render: (t) => <>{TD_KIND[t.play_type ?? ""] ?? t.play_type ?? "-"}</>,
                      },
                      { key: "qtr", label: "Qtr", numeric: true, value: (t) => t.qtr },
                      {
                        key: "desc",
                        label: "Play",
                        value: (t) => t.description,
                        render: (t) => (
                          <span
                            className="inline-block max-w-[420px] overflow-hidden text-ellipsis whitespace-nowrap align-bottom text-muted-foreground"
                            title={t.description ?? undefined}
                          >
                            {t.description ?? "-"}
                          </span>
                        ),
                      },
                    ]}
                  />
                </>
              )}
            </TabsContent>

            {hasPlayoffs && (
              <TabsContent value="Playoffs" className="mt-6">
                {profile.postseasons.length > 0 && (
                  <>
                    <SectionTitle>Postseason, year by year</SectionTitle>
                    <SeasonTable
                      rows={profile.postseasons}
                      position={profile.position}
                      perGame={false}
                      showRank={false}
                    />
                  </>
                )}
                {postLog.length > 0 && (
                  <>
                    <SectionTitle className="mt-6">Playoff game log</SectionTitle>
                    <GameLogTable rows={postLog} position={profile.position} />
                  </>
                )}
                {profile.postseasons.length === 0 && postLog.length === 0 && (
                  <div className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
                    <h2 className="text-lg font-semibold text-foreground">No playoff games</h2>
                    <p className="max-w-prose">This player has no postseason rows in the warehouse.</p>
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
    </main>
  );
}
