"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { AnswerResult, PlayerGameLogRow, PlayerProfile } from "../lib/api";
import { fetchLeaderboards, fetchPlayer } from "../lib/api";
import { passerRating } from "../lib/rating";
import { NFL_TEAM_NAMES, teamTheme } from "../lib/teamTheme";
import { Headshot } from "./Headshot";
import { ResultMethodology } from "./ResultMethodology";
import { TeamLogo } from "./TeamLogo";

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
};

type StatCell = {
  key: string;
  label: string;
  value: string;
  metricKeys?: string[];
};

const integer = (value: number) => value.toLocaleString();
const decimal = (value: number) => value.toFixed(1);
const ratio = (value: number, denominator: number) => denominator ? decimal(value / denominator) : "—";
const percent = (value: number, denominator: number) => denominator ? `${decimal(value / denominator * 100)}%` : "—";

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
  };
}

function answerValue(result: AnswerResult): number | string {
  if (result.answer_value != null) return result.answer_value;
  const rowValue = result.rows[0]?.value ?? result.rows[0]?.total;
  if (typeof rowValue === "number" || typeof rowValue === "string") return rowValue;
  const narrated = result.narration.match(/(?:had|has|totaled)\s+([\d,.]+)/i)?.[1];
  return narrated ? Number(narrated.replace(/,/g, "")) : "—";
}

function displayValue(value: number | string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return Number.isInteger(number) ? integer(number) : decimal(number);
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
}

function scopedLogs(profile: PlayerProfile, result: AnswerResult): PlayerGameLogRow[] {
  const gameIds = new Set(result.rows.map((row) => String(row.game_id ?? "")).filter(Boolean));
  if (gameIds.size) return profile.game_log.filter((game) => gameIds.has(game.game_id));
  return profile.game_log.filter((game) => {
    if (result.query_context?.season_type && game.season_type !== result.query_context.season_type) return false;
    if (result.query_context?.season != null && game.season !== result.query_context.season) return false;
    return true;
  });
}

export function SinglePlayerResult({ result }: { result: AnswerResult }) {
  const playerId = result.player_card?.player_id ?? String(result.rows[0]?.player_id ?? "");
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [leagueRank, setLeagueRank] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetchPlayer(playerId).then((value) => active && setProfile(value)).catch(() => undefined);
    return () => { active = false; };
  }, [playerId]);

  useEffect(() => {
    const season = result.query_context?.season;
    const metric = result.query_context?.metric;
    if (!season || !metric || result.query_context?.season_type === "POST") return;
    let active = true;
    fetchLeaderboards(season, 50, { category: metric })
      .then((data) => {
        const row = data.boards[0]?.rows.find((item) => item.player_id === playerId);
        if (active) setLeagueRank(row?.rank ?? null);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [playerId, result.query_context]);

  const logs = useMemo(() => profile ? scopedLogs(profile, result) : [], [profile, result]);
  const totals = useMemo(() => aggregate(logs), [logs]);
  const context = result.query_context;
  const season = context?.season;
  const seasonLine = profile && season != null
    ? (context?.season_type === "POST" ? profile.postseasons : profile.seasons).find((line) => line.season === season)
    : null;
  const team = seasonLine?.team ?? profile?.team ?? result.player_card?.team ?? null;
  const teamName = team ? NFL_TEAM_NAMES[team] ?? result.player_card?.team_name ?? team : "NFL";
  const isGame = Boolean(result.rows[0]?.game_id);
  const scopeLabel = isGame
    ? "Single game"
    : season != null
      ? `${season} ${context?.season_type === "POST" ? "Postseason" : "Regular Season"}`
      : "Career";
  const rating = passerRating(
    totals.completions,
    totals.attempts,
    totals.passing_yards,
    totals.passing_tds,
    totals.interceptions,
  );
  const category = context?.category ?? "other";
  const statCells: StatCell[] = category === "passing"
    ? [
        { key: "games", label: "Games", value: integer(totals.games) },
        { key: "comp-att", label: "Comp/Att", value: `${integer(totals.completions)}/${integer(totals.attempts)}` },
        { key: "completion-pct", label: "Comp%", value: percent(totals.completions, totals.attempts), metricKeys: ["completion_percentage"] },
        { key: "passing-yards", label: "Pass yds", value: integer(totals.passing_yards), metricKeys: ["passing_yards"] },
        { key: "passing-tds", label: "Pass TD", value: integer(totals.passing_tds), metricKeys: ["passing_tds"] },
        { key: "interceptions", label: "INT", value: integer(totals.interceptions), metricKeys: ["interceptions"] },
        { key: "rating", label: "Rating", value: rating == null ? "—" : decimal(rating), metricKeys: ["passer_rating"] },
      ]
    : category === "rushing"
      ? [
          { key: "games", label: "Games", value: integer(totals.games) },
          { key: "carries", label: "Carries", value: integer(totals.carries), metricKeys: ["carries"] },
          { key: "rushing-yards", label: "Rush yds", value: integer(totals.rushing_yards), metricKeys: ["rushing_yards"] },
          { key: "rushing-tds", label: "Rush TD", value: integer(totals.rushing_tds), metricKeys: ["rushing_tds"] },
          { key: "yards-per-carry", label: "YPC", value: ratio(totals.rushing_yards, totals.carries), metricKeys: ["yards_per_carry"] },
          { key: "yards-per-game", label: "Yds/game", value: ratio(totals.rushing_yards, totals.games), metricKeys: ["rushing_yards_per_game"] },
        ]
      : category === "receiving"
        ? [
            { key: "games", label: "Games", value: integer(totals.games) },
            { key: "targets", label: "Targets", value: integer(totals.targets), metricKeys: ["targets"] },
            { key: "receptions", label: "Rec", value: integer(totals.receptions), metricKeys: ["receptions"] },
            { key: "receiving-yards", label: "Rec yds", value: integer(totals.receiving_yards), metricKeys: ["receiving_yards"] },
            { key: "receiving-tds", label: "Rec TD", value: integer(totals.receiving_tds), metricKeys: ["receiving_tds"] },
            { key: "yards-per-reception", label: "Yds/rec", value: ratio(totals.receiving_yards, totals.receptions), metricKeys: ["yards_per_reception"] },
          ]
        : category === "defense"
          ? [
              { key: "games", label: "Games", value: integer(totals.games) },
              { key: "tackles", label: "Tackles", value: integer(totals.tackles), metricKeys: ["tackles"] },
              { key: "sacks", label: "Sacks", value: decimal(totals.def_sacks), metricKeys: ["def_sacks"] },
              { key: "interceptions", label: "INT", value: integer(totals.def_interceptions), metricKeys: ["def_interceptions"] },
              { key: "forced-fumbles", label: "FF", value: integer(totals.forced_fumbles), metricKeys: ["forced_fumbles"] },
              { key: "passes-defended", label: "PD", value: integer(totals.passes_defended), metricKeys: ["passes_defended"] },
            ]
          : [
              { key: "games", label: "Games", value: integer(totals.games) },
              { key: "fantasy-points", label: "Fantasy pts", value: decimal(totals.fantasy_points_ppr), metricKeys: ["fantasy_points_ppr"] },
              { key: "points-per-game", label: "Pts/game", value: ratio(totals.fantasy_points_ppr, totals.games), metricKeys: ["fantasy_points_per_game"] },
            ];
  const name = profile?.name ?? result.player_card?.name ?? "Player";
  const metricLabel = context?.metric_label?.toLowerCase() ?? "the requested stat";
  const responseScope = isGame
    ? "in this game"
    : season != null
      ? `in the ${season} ${context?.season_type === "POST" ? "postseason" : "regular season"}`
      : "over the requested career span";
  const response = `${name} had ${displayValue(answerValue(result))} ${metricLabel} ${responseScope}.`;
  const categoryLabel = category === "passing" ? "Passing"
    : category === "rushing" ? "Rushing"
      : category === "receiving" ? "Receiving"
        : category === "defense" ? "Defensive" : "Fantasy";
  const statsTitle = `${season ?? (isGame ? "Game" : "Career")} ${categoryLabel} stats`;
  const searchedMetric = context?.metric;
  const gameLogLabel = isGame
    ? "View game box score"
    : season != null
      ? `View ${season} game log`
      : "View career game log";
  const gameLogHref = isGame
    ? `/games/${encodeURIComponent(String(result.rows[0]?.game_id))}`
    : `/players/${encodeURIComponent(playerId)}${season != null ? `?season=${season}` : ""}#game-log`;

  return (
    <section className="yb-single-player-answer yb-enter" style={teamTheme(team)}>
      <div className="yb-single-response-block">
        <span className="yb-single-response-label">Response</span>
        <p className="yb-single-response">{response}</p>
      </div>

      <article className="yb-single-player-strip">
        <Headshot
          src={profile?.headshot_url ?? result.player_card?.headshot_url}
          name={name}
          scale="comparison"
        />
        <div>
          <h2>{name}</h2>
          <p>
            {team && <TeamLogo team={team} size={22} />}
            {[profile?.position ?? result.player_card?.position, teamName].filter(Boolean).join(" · ")}
          </p>
          <span>{scopeLabel.toLowerCase()}</span>
        </div>
        <Link href={`/players/${encodeURIComponent(playerId)}`} className="yb-btn ghost">View profile</Link>
      </article>

      <section className="yb-single-stat-section">
        <h2>{statsTitle}</h2>
        <div className="yb-table-scroll">
          <table className="yb-single-stat-table" aria-label={statsTitle}>
            <thead>
              <tr>
                {statCells.map((stat) => (
                  <th
                    key={stat.key}
                    className={stat.metricKeys?.includes(searchedMetric ?? "") ? "is-query-metric" : undefined}
                  >
                    {stat.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {statCells.map((stat) => (
                  <td
                    key={stat.key}
                    data-label={stat.label}
                    className={stat.metricKeys?.includes(searchedMetric ?? "") ? "is-query-metric" : undefined}
                  >
                    {stat.value}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="yb-single-context">
        <span>Context</span>
        <p>
          {leagueRank != null
            ? `${ordinal(leagueRank)} in the NFL for ${context?.metric_label ?? "this metric"} in ${season}.`
            : `${scopeLabel} production across ${totals.games} game${totals.games === 1 ? "" : "s"}.`}
        </p>
      </div>

      <div className="yb-single-links">
        <Link href={gameLogHref} className="yb-btn ghost">{gameLogLabel}</Link>
      </div>
      <ResultMethodology result={result} />
    </section>
  );
}
