"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { AnswerResult, PlayerGameLogRow, PlayerProfile } from "../lib/api";
import { fetchPlayer } from "../lib/api";
import { passerRating } from "../lib/rating";
import { Headshot } from "./Headshot";
import { teamTheme } from "../lib/teamTheme";

type Mode = "rates" | "equal" | "best" | "totals";
type Direction = "higher" | "lower" | "neutral";

type Totals = {
  games: number;
  completions: number;
  attempts: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  tackles: number;
  def_sacks: number;
  def_interceptions: number;
  forced_fumbles: number;
  passes_defended: number;
  fantasy_points_ppr: number;
  pass_plays: number;
  pass_epa: number;
  pass_success: number;
};

type Metric = {
  label: string;
  direction: Direction;
  value: (totals: Totals) => number | null;
  format?: (value: number) => string;
  available?: (a: Totals, b: Totals) => boolean;
};

type StatCategory = "passing" | "rushing" | "receiving" | "defense" | "fantasy" | "other";

const DEFENSIVE_POSITIONS = new Set([
  "DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "DB", "S", "FS", "SS",
]);

function positionCategory(position: string | null): StatCategory {
  if (position === "QB") return "passing";
  if (position === "RB" || position === "FB") return "rushing";
  if (position === "WR" || position === "TE") return "receiving";
  if (position && DEFENSIVE_POSITIONS.has(position)) return "defense";
  return "other";
}

function comparisonCategory(result: AnswerResult, profiles: PlayerProfile[]): StatCategory {
  const requested = result.query_context?.category;
  if (requested === "passing" || requested === "rushing" || requested === "receiving" || requested === "defense" || requested === "fantasy") {
    return requested;
  }
  const text = `${result.question} ${result.narration}`.toLowerCase();
  if (/pass|quarterback|completion|passer rating|interception rate/.test(text)) return "passing";
  if (/rush|carr(?:y|ies)|yards per carry/.test(text)) return "rushing";
  if (/receiv|reception|target|catch/.test(text)) return "receiving";
  if (/tackle|defen|sack|forced fumble|passes defended/.test(text)) return "defense";
  const positional = profiles.map((profile) => positionCategory(profile.position));
  return positional.length > 0 && positional.every((category) => category === positional[0])
    ? positional[0]!
    : "fantasy";
}

const integer = (value: number) => Math.round(value).toLocaleString();
const oneDecimal = (value: number) => value.toFixed(1);
const percentage = (value: number) => `${value.toFixed(1)}%`;
const rate = (value: number, denominator: number) => denominator ? value / denominator : 0;
const shortName = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;

function aggregate(logs: PlayerGameLogRow[]): Totals {
  const sum = (key: keyof PlayerGameLogRow) =>
    logs.reduce((total, game) => total + Number(game[key] ?? 0), 0);
  return {
    games: logs.length,
    completions: sum("completions"), attempts: sum("attempts"),
    passing_yards: sum("passing_yards"), passing_tds: sum("passing_tds"),
    interceptions: sum("interceptions"), carries: sum("carries"),
    rushing_yards: sum("rushing_yards"), rushing_tds: sum("rushing_tds"),
    targets: sum("targets"), receptions: sum("receptions"),
    receiving_yards: sum("receiving_yards"), receiving_tds: sum("receiving_tds"),
    tackles: sum("tackles"), def_sacks: sum("def_sacks"),
    def_interceptions: sum("def_interceptions"), forced_fumbles: sum("forced_fumbles"),
    passes_defended: sum("passes_defended"), fantasy_points_ppr: sum("fantasy_points_ppr"),
    pass_plays: sum("pass_plays"), pass_epa: sum("pass_epa"), pass_success: sum("pass_success"),
  };
}

const qbRateMetrics: Metric[] = [
  { label: "Games", direction: "neutral", value: (s) => s.games, format: integer },
  { label: "Starts", direction: "neutral", value: () => null },
  { label: "Completion percentage", direction: "higher", value: (s) => rate(s.completions, s.attempts) * 100, format: percentage },
  { label: "Passing yards per game", direction: "higher", value: (s) => rate(s.passing_yards, s.games), format: oneDecimal },
  { label: "Passing touchdowns per game", direction: "higher", value: (s) => rate(s.passing_tds, s.games), format: oneDecimal },
  { label: "Interception rate", direction: "lower", value: (s) => rate(s.interceptions, s.attempts) * 100, format: percentage },
  { label: "Yards per attempt", direction: "higher", value: (s) => rate(s.passing_yards, s.attempts), format: oneDecimal },
  {
    label: "Passer rating",
    direction: "higher",
    value: (s) => passerRating(s.completions, s.attempts, s.passing_yards, s.passing_tds, s.interceptions),
    format: oneDecimal,
  },
  {
    label: "EPA per play",
    direction: "higher",
    value: (s) => s.pass_plays ? s.pass_epa / s.pass_plays : null,
    format: (value) => value.toFixed(3),
    available: (a, b) => a.pass_plays > 0 || b.pass_plays > 0,
  },
  {
    label: "Success rate",
    direction: "higher",
    value: (s) => s.pass_plays ? s.pass_success / s.pass_plays * 100 : null,
    format: percentage,
    available: (a, b) => a.pass_plays > 0 || b.pass_plays > 0,
  },
  { label: "Rushing yards per game", direction: "higher", value: (s) => rate(s.rushing_yards, s.games), format: oneDecimal },
  { label: "Rushing touchdowns", direction: "higher", value: (s) => s.rushing_tds, format: integer },
];

const qbTotalMetrics: Metric[] = [
  { label: "Games", direction: "neutral", value: (s) => s.games, format: integer },
  { label: "Starts", direction: "neutral", value: () => null },
  { label: "Completions", direction: "higher", value: (s) => s.completions, format: integer },
  { label: "Attempts", direction: "neutral", value: (s) => s.attempts, format: integer },
  { label: "Passing yards", direction: "higher", value: (s) => s.passing_yards, format: integer },
  { label: "Passing touchdowns", direction: "higher", value: (s) => s.passing_tds, format: integer },
  { label: "Interceptions", direction: "lower", value: (s) => s.interceptions, format: integer },
  { label: "Yards per attempt", direction: "higher", value: (s) => rate(s.passing_yards, s.attempts), format: oneDecimal },
  {
    label: "Passer rating",
    direction: "higher",
    value: (s) => passerRating(s.completions, s.attempts, s.passing_yards, s.passing_tds, s.interceptions),
    format: oneDecimal,
  },
  { label: "Rushing yards", direction: "higher", value: (s) => s.rushing_yards, format: integer },
  { label: "Rushing touchdowns", direction: "higher", value: (s) => s.rushing_tds, format: integer },
];

const rushingMetrics: Metric[] = [
  { label: "Games", direction: "neutral", value: (s) => s.games, format: integer },
  { label: "Carries per game", direction: "neutral", value: (s) => rate(s.carries, s.games), format: oneDecimal },
  { label: "Rushing yards per game", direction: "higher", value: (s) => rate(s.rushing_yards, s.games), format: oneDecimal },
  { label: "Yards per carry", direction: "higher", value: (s) => rate(s.rushing_yards, s.carries), format: oneDecimal },
  { label: "Rushing touchdowns per game", direction: "higher", value: (s) => rate(s.rushing_tds, s.games), format: oneDecimal },
  { label: "Receiving yards per game", direction: "higher", value: (s) => rate(s.receiving_yards, s.games), format: oneDecimal },
];

const rushingTotalMetrics: Metric[] = [
  { label: "Games", direction: "neutral", value: (s) => s.games, format: integer },
  { label: "Carries", direction: "neutral", value: (s) => s.carries, format: integer },
  { label: "Rushing yards", direction: "higher", value: (s) => s.rushing_yards, format: integer },
  { label: "Rushing touchdowns", direction: "higher", value: (s) => s.rushing_tds, format: integer },
  { label: "Yards per carry", direction: "higher", value: (s) => rate(s.rushing_yards, s.carries), format: oneDecimal },
  { label: "Receiving yards", direction: "higher", value: (s) => s.receiving_yards, format: integer },
];

const receivingMetrics: Metric[] = [
  { label: "Games", direction: "neutral", value: (s) => s.games, format: integer },
  { label: "Targets per game", direction: "neutral", value: (s) => rate(s.targets, s.games), format: oneDecimal },
  { label: "Receptions per game", direction: "higher", value: (s) => rate(s.receptions, s.games), format: oneDecimal },
  { label: "Receiving yards per game", direction: "higher", value: (s) => rate(s.receiving_yards, s.games), format: oneDecimal },
  { label: "Yards per reception", direction: "higher", value: (s) => rate(s.receiving_yards, s.receptions), format: oneDecimal },
  { label: "Receiving touchdowns per game", direction: "higher", value: (s) => rate(s.receiving_tds, s.games), format: oneDecimal },
];

const receivingTotalMetrics: Metric[] = [
  { label: "Games", direction: "neutral", value: (s) => s.games, format: integer },
  { label: "Targets", direction: "neutral", value: (s) => s.targets, format: integer },
  { label: "Receptions", direction: "higher", value: (s) => s.receptions, format: integer },
  { label: "Receiving yards", direction: "higher", value: (s) => s.receiving_yards, format: integer },
  { label: "Receiving touchdowns", direction: "higher", value: (s) => s.receiving_tds, format: integer },
  { label: "Yards per reception", direction: "higher", value: (s) => rate(s.receiving_yards, s.receptions), format: oneDecimal },
];

const defenseMetrics: Metric[] = [
  { label: "Games", direction: "neutral", value: (s) => s.games, format: integer },
  { label: "Tackles per game", direction: "higher", value: (s) => rate(s.tackles, s.games), format: oneDecimal },
  { label: "Sacks per game", direction: "higher", value: (s) => rate(s.def_sacks, s.games), format: oneDecimal },
  { label: "Interceptions per game", direction: "higher", value: (s) => rate(s.def_interceptions, s.games), format: oneDecimal },
  { label: "Forced fumbles per game", direction: "higher", value: (s) => rate(s.forced_fumbles, s.games), format: oneDecimal },
  { label: "Passes defended per game", direction: "higher", value: (s) => rate(s.passes_defended, s.games), format: oneDecimal },
];

const defenseTotalMetrics: Metric[] = [
  { label: "Games", direction: "neutral", value: (s) => s.games, format: integer },
  { label: "Tackles", direction: "higher", value: (s) => s.tackles, format: integer },
  { label: "Sacks", direction: "higher", value: (s) => s.def_sacks, format: oneDecimal },
  { label: "Interceptions", direction: "higher", value: (s) => s.def_interceptions, format: integer },
  { label: "Forced fumbles", direction: "higher", value: (s) => s.forced_fumbles, format: integer },
  { label: "Passes defended", direction: "higher", value: (s) => s.passes_defended, format: integer },
];

const fantasyMetrics: Metric[] = [
  { label: "Games", direction: "neutral", value: (s) => s.games, format: integer },
  { label: "Fantasy points per game", direction: "higher", value: (s) => rate(s.fantasy_points_ppr, s.games), format: oneDecimal },
  { label: "Total touchdowns per game", direction: "higher", value: (s) => rate(s.passing_tds + s.rushing_tds + s.receiving_tds, s.games), format: oneDecimal },
];

const fantasyTotalMetrics: Metric[] = [
  { label: "Games", direction: "neutral", value: (s) => s.games, format: integer },
  { label: "Fantasy points", direction: "higher", value: (s) => s.fantasy_points_ppr, format: oneDecimal },
  { label: "Total touchdowns", direction: "higher", value: (s) => s.passing_tds + s.rushing_tds + s.receiving_tds, format: integer },
];

function careerLogs(profile: PlayerProfile, result: AnswerResult): PlayerGameLogRow[] {
  const seasonType = result.query_context?.season_type ?? "REG";
  return profile.game_log.filter((game) => {
    if (game.season_type !== seasonType) return false;
    if (result.query_context?.season != null && game.season !== result.query_context.season) return false;
    return true;
  });
}

function chronological(logs: PlayerGameLogRow[]): PlayerGameLogRow[] {
  return [...logs].sort((a, b) =>
    a.season - b.season || a.week - b.week || a.game_id.localeCompare(b.game_id),
  );
}

function metricTotal(totals: Totals, metric: string | undefined, category: StatCategory): number {
  const key = metric as keyof Totals | undefined;
  return key && typeof totals[key] === "number" ? Number(totals[key]) : primaryProduction(totals, category);
}

function bestSeason(logs: PlayerGameLogRow[], metric: string | undefined, category: StatCategory): { totals: Totals; season: number | null } {
  const groups = new Map<number, PlayerGameLogRow[]>();
  for (const game of logs) groups.set(game.season, [...(groups.get(game.season) ?? []), game]);
  let best: { totals: Totals; season: number | null } = { totals: aggregate([]), season: null };
  for (const [season, games] of groups) {
    const totals = aggregate(games);
    if (best.season == null || metricTotal(totals, metric, category) > metricTotal(best.totals, metric, category)) {
      best = { totals, season };
    }
  }
  return best;
}

function careerIdentity(profile: PlayerProfile): string {
  const teams = [...profile.seasons]
    .sort((a, b) => a.season - b.season)
    .map((season) => season.team)
    .filter((team): team is string => Boolean(team))
    .filter((team, index, all) => all.indexOf(team) === index);
  return `${profile.career.seasons} season${profile.career.seasons === 1 ? "" : "s"} · ${teams.join(", ") || "NFL"}`;
}

function primaryProduction(totals: Totals, category: StatCategory): number {
  if (category === "rushing") return totals.rushing_yards;
  if (category === "receiving") return totals.receiving_yards;
  if (category === "defense") return totals.tackles;
  if (category === "fantasy" || category === "other") return totals.fantasy_points_ppr;
  return totals.passing_yards;
}

function productionLabel(category: StatCategory): string {
  if (category === "rushing") return "rushing production";
  if (category === "receiving") return "receiving production";
  if (category === "defense") return "defensive production";
  if (category === "fantasy" || category === "other") return "fantasy production";
  return "passing production";
}

function modeSummary(mode: Mode, a: PlayerProfile, b: PlayerProfile, ta: Totals, tb: Totals, equalN: number, category: StatCategory): string {
  const valueA = primaryProduction(ta, category);
  const valueB = primaryProduction(tb, category);
  if (mode === "totals") {
    const leader = valueA >= valueB ? a.name : b.name;
    const longer = a.career.games_played >= b.career.games_played ? a : b;
    return `${leader} leads in cumulative ${productionLabel(category)}, largely reflecting ${longer.name}'s substantially longer career.`;
  }
  if (mode === "equal") {
    const leader = valueA >= valueB ? a.name : b.name;
    return `${leader} led the primary ${productionLabel(category)} measure through the same ${equalN} games; the table compares efficiency over that equal window.`;
  }
  if (mode === "best") {
    const ratingA = category === "passing"
      ? passerRating(ta.completions, ta.attempts, ta.passing_yards, ta.passing_tds, ta.interceptions) ?? valueA
      : valueA;
    const ratingB = category === "passing"
      ? passerRating(tb.completions, tb.attempts, tb.passing_yards, tb.passing_tds, tb.interceptions) ?? valueB
      : valueB;
    const leader = ratingA >= ratingB ? a.name : b.name;
    return `${leader} has the stronger efficiency profile across each player's best season for the requested metric.`;
  }
  if (category !== "passing") {
    const perGameA = rate(valueA, ta.games);
    const perGameB = rate(valueB, tb.games);
    const leader = perGameA >= perGameB ? a.name : b.name;
    return `${leader} has the stronger per-game ${productionLabel(category)} in this comparison mode.`;
  }
  const ratingA = passerRating(ta.completions, ta.attempts, ta.passing_yards, ta.passing_tds, ta.interceptions) ?? 0;
  const ratingB = passerRating(tb.completions, tb.attempts, tb.passing_yards, tb.passing_tds, tb.interceptions) ?? 0;
  const ratingLeader = ratingA >= ratingB ? a.name : b.name;
  const yardsLeader = rate(ta.passing_yards, ta.games) >= rate(tb.passing_yards, tb.games) ? a.name : b.name;
  return `${ratingLeader} has the higher passer rating, while ${yardsLeader} averages more passing yards per game.`;
}

function GameLogPreview({
  profile,
  logs,
  category,
}: {
  profile: PlayerProfile;
  logs: PlayerGameLogRow[];
  category: StatCategory;
}) {
  const contextualCategory = category === "fantasy" || category === "other"
    ? positionCategory(profile.position)
    : category;
  const fields = contextualCategory === "passing"
    ? [
        { label: "Cmp/Att", value: (game: PlayerGameLogRow) => `${game.completions}/${game.attempts}` },
        { label: "Pass yds", value: (game: PlayerGameLogRow) => integer(game.passing_yards) },
        { label: "Pass TD", value: (game: PlayerGameLogRow) => integer(game.passing_tds) },
        { label: "INT", value: (game: PlayerGameLogRow) => integer(game.interceptions) },
      ]
    : contextualCategory === "rushing"
      ? [
          { label: "Carries", value: (game: PlayerGameLogRow) => integer(game.carries) },
          { label: "Rush yds", value: (game: PlayerGameLogRow) => integer(game.rushing_yards) },
          { label: "Rush TD", value: (game: PlayerGameLogRow) => integer(game.rushing_tds) },
          { label: "Rec", value: (game: PlayerGameLogRow) => integer(game.receptions) },
        ]
      : contextualCategory === "receiving"
        ? [
            { label: "Targets", value: (game: PlayerGameLogRow) => integer(game.targets) },
            { label: "Rec", value: (game: PlayerGameLogRow) => integer(game.receptions) },
            { label: "Rec yds", value: (game: PlayerGameLogRow) => integer(game.receiving_yards) },
            { label: "Rec TD", value: (game: PlayerGameLogRow) => integer(game.receiving_tds) },
          ]
        : contextualCategory === "defense"
          ? [
              { label: "Tackles", value: (game: PlayerGameLogRow) => integer(game.tackles) },
              { label: "Sacks", value: (game: PlayerGameLogRow) => oneDecimal(game.def_sacks) },
              { label: "INT", value: (game: PlayerGameLogRow) => integer(game.def_interceptions) },
              { label: "FF", value: (game: PlayerGameLogRow) => integer(game.forced_fumbles) },
            ]
          : [{ label: "Fantasy PPR", value: (game: PlayerGameLogRow) => oneDecimal(game.fantasy_points_ppr) }];
  return (
    <section>
      <h3>{profile.name}</h3>
      <div className="yb-table-scroll">
        <table className="yb-table">
          <thead>
            <tr>
              <th>Game</th>
              {fields.map((field) => <th key={field.label} className="num">{field.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {[...logs].reverse().slice(0, 8).map((game) => (
              <tr key={game.game_id}>
                <td><Link href={`/games/${encodeURIComponent(game.game_id)}`}>{game.season} · {game.home ? "vs" : "@"} {game.opponent}</Link></td>
                {fields.map((field) => <td key={field.label} className="num">{field.value(game)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PlayerComparisonResult({ result }: { result: AnswerResult }) {
  const cards = [result.player_card, result.player_card2].filter(
    (card): card is NonNullable<typeof card> => Boolean(card),
  );
  const playerIds = cards.length === 2
    ? cards.map((card) => card.player_id)
    : result.rows.slice(0, 2).map((row) => String(row.player_id));
  const playerIdKey = playerIds.join("|");
  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [mode, setMode] = useState<Mode>(() => /first\s+\d+\s+(?:postseason\s+)?games/i.test(result.question) ? "equal" : "rates");
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all(playerIdKey.split("|").filter(Boolean).map((id) => fetchPlayer(id))).then((loaded) => {
      if (active) setProfiles(loaded.filter((profile): profile is PlayerProfile => Boolean(profile)));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [playerIdKey]);

  const [a, b] = profiles;
  const logsA = useMemo(() => a ? careerLogs(a, result) : [], [a, result]);
  const logsB = useMemo(() => b ? careerLogs(b, result) : [], [b, result]);
  const requestedN = Number(result.question.match(/first\s+(\d+)\s+(?:postseason\s+)?games/i)?.[1] ?? 0);
  const equalN = requestedN || Math.min(logsA.length, logsB.length);
  const equalLabel = `First ${equalN || "N"} games`;

  if (!a || !b) {
    return <div className="yb-state" aria-live="polite">Loading player comparison…</div>;
  }

  const category = comparisonCategory(result, [a, b]);
  const selected = (profile: PlayerProfile, logs: PlayerGameLogRow[]) => {
    if (mode === "equal") return { totals: aggregate(chronological(logs).slice(0, equalN)), season: null };
    if (mode === "best") return bestSeason(logs, result.query_context?.metric, category);
    return { totals: aggregate(logs), season: null };
  };
  const selectedA = selected(a, logsA);
  const selectedB = selected(b, logsB);
  const totalsA = selectedA.totals;
  const totalsB = selectedB.totals;
  const careerDifference = Math.max(logsA.length, logsB.length) / Math.max(1, Math.min(logsA.length, logsB.length));
  const metrics = (
    category === "passing" ? (mode === "totals" ? qbTotalMetrics : qbRateMetrics)
      : category === "rushing" ? (mode === "totals" ? rushingTotalMetrics : rushingMetrics)
        : category === "receiving" ? (mode === "totals" ? receivingTotalMetrics : receivingMetrics)
          : category === "defense" ? (mode === "totals" ? defenseTotalMetrics : defenseMetrics)
            : mode === "totals" ? fantasyTotalMetrics : fantasyMetrics
  ).filter((metric) => metric.available?.(totalsA, totalsB) ?? true);
  const modes: { value: Mode; label: string }[] = [
    { value: "rates", label: "Career rates" },
    { value: "equal", label: equalLabel },
    { value: "best", label: "Best season" },
    { value: "totals", label: "Career totals" },
  ];

  return (
    <section className="yb-player-comparison yb-enter">
      <div className="yb-comparison-matchup" aria-label={`${a.name} versus ${b.name}`}>
        {[a, b].map((profile, index) => (
          <Link
            key={profile.player_id}
            href={`/players/${encodeURIComponent(profile.player_id)}`}
            className={`yb-comparison-identity ${index === 0 ? "is-a" : "is-b"}`}
            style={teamTheme(profile.team)}
          >
            <Headshot src={profile.headshot_url} name={profile.name} scale="comparison" />
            <div>
              <h2>{profile.name}</h2>
              <p>{profile.position ?? "Player"} · {careerIdentity(profile)}</p>
            </div>
          </Link>
        ))}
        <div className="yb-comparison-versus" aria-hidden="true">
          <span>VS</span>
        </div>
      </div>

      {careerDifference >= 1.5 && result.query_context?.season == null && (
        <p className="yb-comparison-notice">
          Career lengths differ significantly, so rate and efficiency statistics are shown by default.
        </p>
      )}

      {result.query_context?.season == null && (
        <div className="yb-comparison-modes" role="group" aria-label="Comparison mode">
          {modes.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onClick={() => setMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {(selectedA.season != null || selectedB.season != null) && (
        <p className="yb-comparison-window">
          Best-season window: {a.name} {selectedA.season ?? "-"} · {b.name} {selectedB.season ?? "-"}
        </p>
      )}

      <div className="yb-comparison-table yb-table-scroll">
        <table className="yb-table">
          <thead>
            <tr>
              <th aria-label={a.name}>{shortName(a.name)}</th>
              <th>Metric</th>
              <th aria-label={b.name}>{shortName(b.name)}</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => {
              const valueA = metric.value(totalsA);
              const valueB = metric.value(totalsB);
              const tied = valueA != null && valueB != null && Math.abs(valueA - valueB) < 0.0001;
              const aWins = valueA != null && valueB != null && !tied && (
                metric.direction === "higher" ? valueA > valueB : metric.direction === "lower" ? valueA < valueB : false
              );
              const bWins = valueA != null && valueB != null && !tied && metric.direction !== "neutral" && !aWins;
              const format = metric.format ?? oneDecimal;
              // The leading value wears its team's pill; ties and context-only
              // metrics stay plain — no row tinting, no separate edge column.
              const cell = (value: number | null, wins: boolean, team: string | null) =>
                value == null ? "–" : wins
                  ? <span className="yb-edge-pill" style={team ? teamTheme(team) : undefined}>{format(value)}</span>
                  : format(value);
              return (
                <tr key={metric.label}>
                  <td>{cell(valueA, aWins, a.team)}</td>
                  <th scope="row">{metric.label}</th>
                  <td>{cell(valueB, bWins, b.team)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="yb-comparison-summary">{modeSummary(mode, a, b, totalsA, totalsB, equalN, category)}</p>

      <div className="yb-comparison-actions">
        <Link href={`/players/${encodeURIComponent(a.player_id)}`} className="yb-btn">View {a.name} profile</Link>
        <Link href={`/players/${encodeURIComponent(b.player_id)}`} className="yb-btn">View {b.name} profile</Link>
        <button type="button" className="yb-btn" aria-expanded={showLogs} onClick={() => setShowLogs((shown) => !shown)}>
          {showLogs ? "Hide game logs" : "Compare game logs"}
        </button>
      </div>

      {showLogs && (
        <div className="yb-comparison-game-logs">
          <GameLogPreview profile={a} logs={mode === "equal" ? chronological(logsA).slice(0, equalN) : logsA} category={category} />
          <GameLogPreview profile={b} logs={mode === "equal" ? chronological(logsB).slice(0, equalN) : logsB} category={category} />
        </div>
      )}

    </section>
  );
}
