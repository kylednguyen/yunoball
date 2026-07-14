"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { AnswerResult, PlayerGameLogRow, PlayerProfile } from "../lib/api";
import { fetchPlayer } from "../lib/api";
import { passerRating } from "../lib/rating";
import { teamTheme } from "../lib/teamTheme";
import { Dropdown } from "./Dropdown";
import { Headshot } from "./Headshot";
import { tablistKeys } from "./tablist";
import { TeamLogo } from "./TeamLogo";

type Tab = "Leaderboard" | "Leader comparison" | "Game logs";
type Category = NonNullable<AnswerResult["query_context"]>["category"];

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
  fumbles: number;
  fumbles_lost: number;
  tackles: number;
  def_sacks: number;
  def_interceptions: number;
  forced_fumbles: number;
  passes_defended: number;
  fantasy_points_ppr: number;
};

type Field = { label: string; value: (totals: Totals) => string };

const DEFENSIVE_POSITIONS = new Set([
  "DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "DB", "S", "FS", "SS",
]);

function positionCategory(position: string | null): Category {
  if (position === "QB") return "passing";
  if (position === "RB" || position === "FB") return "rushing";
  if (position === "WR" || position === "TE") return "receiving";
  if (position && DEFENSIVE_POSITIONS.has(position)) return "defense";
  if (position === "K" || position === "P") return "kicking";
  return "other";
}

const integer = (value: number) => value.toLocaleString();
const decimal = (value: number) => value.toFixed(1);
const perGame = (value: number, games: number) => (games ? decimal(value / games) : "-");

const FIELDS: Record<Category, Field[]> = {
  passing: [
    { label: "Games played", value: (s) => integer(s.games) },
    { label: "Completions", value: (s) => integer(s.completions) },
    { label: "Attempts", value: (s) => integer(s.attempts) },
    { label: "Passing yards", value: (s) => integer(s.passing_yards) },
    { label: "Passing touchdowns", value: (s) => integer(s.passing_tds) },
    { label: "Interceptions", value: (s) => integer(s.interceptions) },
    {
      label: "Passer rating",
      value: (s) =>
        String(
          passerRating(
            s.completions,
            s.attempts,
            s.passing_yards,
            s.passing_tds,
            s.interceptions,
          ) ?? "-",
        ),
    },
    { label: "Passing TDs per game", value: (s) => perGame(s.passing_tds, s.games) },
  ],
  rushing: [
    { label: "Games played", value: (s) => integer(s.games) },
    { label: "Carries", value: (s) => integer(s.carries) },
    { label: "Rushing yards", value: (s) => integer(s.rushing_yards) },
    { label: "Rushing touchdowns", value: (s) => integer(s.rushing_tds) },
    { label: "Yards per carry", value: (s) => (s.carries ? decimal(s.rushing_yards / s.carries) : "-") },
    { label: "Rushing TDs per game", value: (s) => perGame(s.rushing_tds, s.games) },
    { label: "Fumbles lost", value: (s) => integer(s.fumbles_lost) },
  ],
  receiving: [
    { label: "Games played", value: (s) => integer(s.games) },
    { label: "Targets", value: (s) => integer(s.targets) },
    { label: "Receptions", value: (s) => integer(s.receptions) },
    { label: "Receiving yards", value: (s) => integer(s.receiving_yards) },
    { label: "Receiving touchdowns", value: (s) => integer(s.receiving_tds) },
    { label: "Yards per reception", value: (s) => (s.receptions ? decimal(s.receiving_yards / s.receptions) : "-") },
    { label: "Receiving TDs per game", value: (s) => perGame(s.receiving_tds, s.games) },
  ],
  defense: [
    { label: "Games played", value: (s) => integer(s.games) },
    { label: "Tackles", value: (s) => integer(s.tackles) },
    { label: "Sacks", value: (s) => decimal(s.def_sacks) },
    { label: "Interceptions", value: (s) => integer(s.def_interceptions) },
    { label: "Forced fumbles", value: (s) => integer(s.forced_fumbles) },
    { label: "Passes defended", value: (s) => integer(s.passes_defended) },
  ],
  fantasy: [
    { label: "Games played", value: (s) => integer(s.games) },
    { label: "Fantasy PPR", value: (s) => decimal(s.fantasy_points_ppr) },
    { label: "PPR per game", value: (s) => perGame(s.fantasy_points_ppr, s.games) },
    { label: "Passing TDs", value: (s) => integer(s.passing_tds) },
    { label: "Rushing TDs", value: (s) => integer(s.rushing_tds) },
    { label: "Receiving TDs", value: (s) => integer(s.receiving_tds) },
  ],
  kicking: [
    { label: "Games played", value: (s) => integer(s.games) },
    { label: "Fantasy PPR", value: (s) => decimal(s.fantasy_points_ppr) },
  ],
  team: [{ label: "Games played", value: (s) => integer(s.games) }],
  game: [{ label: "Games played", value: (s) => integer(s.games) }],
  other: [
    { label: "Games played", value: (s) => integer(s.games) },
    { label: "Fantasy PPR", value: (s) => decimal(s.fantasy_points_ppr) },
  ],
};

function resultCategory(result: AnswerResult): Category {
  if (result.query_context?.category) return result.query_context.category;
  const text = `${result.question} ${result.narration}`.toLowerCase();
  if (/pass|quarterback|completion|interception thrown/.test(text)) return "passing";
  if (/rush|carr(?:y|ies)/.test(text)) return "rushing";
  if (/receiv|reception|target|catch/.test(text)) return "receiving";
  if (/tackle|defen|sack|forced fumble|pass(?:es)? defended/.test(text)) return "defense";
  if (/kick|field goal|extra point|punt/.test(text)) return "kicking";
  if (/fantasy|ppr/.test(text)) return "fantasy";
  return "other";
}

function scopedLogs(profile: PlayerProfile, result: AnswerResult): PlayerGameLogRow[] {
  const context = result.query_context;
  const rowSeasons = [...new Set(result.rows.map((row) => Number(row.season)).filter(Number.isFinite))];
  const season = context?.season ?? (rowSeasons.length === 1 ? rowSeasons[0] : null);
  const seasonType = context?.season_type ?? (
    /playoff|postseason/i.test(`${result.question} ${result.narration}`) ? "POST" : "REG"
  );
  return profile.game_log.filter((game) => {
    if (game.season_type !== seasonType) return false;
    if (season != null && game.season !== season) return false;
    return true;
  });
}

function total(logs: PlayerGameLogRow[]): Totals {
  const sum = (key: keyof Omit<PlayerGameLogRow, "game_id" | "date" | "opponent" | "result" | "season_type">) =>
    logs.reduce((value, game) => value + Number(game[key] ?? 0), 0);
  return {
    games: logs.length,
    completions: sum("completions"), attempts: sum("attempts"),
    passing_yards: sum("passing_yards"), passing_tds: sum("passing_tds"),
    interceptions: sum("interceptions"), carries: sum("carries"),
    rushing_yards: sum("rushing_yards"), rushing_tds: sum("rushing_tds"),
    targets: sum("targets"), receptions: sum("receptions"),
    receiving_yards: sum("receiving_yards"), receiving_tds: sum("receiving_tds"),
    fumbles: sum("fumbles"), fumbles_lost: sum("fumbles_lost"),
    tackles: sum("tackles"), def_sacks: sum("def_sacks"),
    def_interceptions: sum("def_interceptions"), forced_fumbles: sum("forced_fumbles"),
    passes_defended: sum("passes_defended"), fantasy_points_ppr: sum("fantasy_points_ppr"),
  };
}

function dateLabel(date: string | null): string {
  if (!date) return "Date TBD";
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${Number(match[2])}/${Number(match[3])}/${match[1]}` : date;
}

function GameLogTable({
  profile,
  result,
  category,
}: {
  profile: PlayerProfile;
  result: AnswerResult;
  category: Category;
}) {
  const logs = scopedLogs(profile, result);
  const contextualCategory = category === "fantasy" || category === "other"
    ? positionCategory(profile.position)
    : category;
  const showFantasy = category === "fantasy";
  const categoryCells = (game: PlayerGameLogRow) => {
    const values = contextualCategory === "passing"
      ? [
        `${game.completions}/${game.attempts}`,
        integer(game.passing_yards),
        integer(game.passing_tds),
        integer(game.interceptions),
        String(passerRating(game.completions, game.attempts, game.passing_yards, game.passing_tds, game.interceptions) ?? "-"),
      ]
      : contextualCategory === "rushing"
        ? [integer(game.carries), integer(game.rushing_yards), integer(game.rushing_tds), integer(game.receptions), integer(game.receiving_yards)]
        : contextualCategory === "receiving"
          ? [integer(game.targets), integer(game.receptions), integer(game.receiving_yards), integer(game.receiving_tds)]
          : contextualCategory === "defense"
            ? [integer(game.tackles), decimal(game.def_sacks), integer(game.def_interceptions), integer(game.forced_fumbles), integer(game.passes_defended)]
            : [decimal(game.fantasy_points_ppr)];
    return showFantasy && contextualCategory !== "other" && contextualCategory !== "kicking"
      ? [decimal(game.fantasy_points_ppr), ...values]
      : values;
  };
  const positionalHeaders =
    contextualCategory === "passing" ? ["Cmp/Att", "Pass yds", "Pass TD", "INT", "Rating"]
      : contextualCategory === "rushing" ? ["Carries", "Rush yds", "Rush TD", "Rec", "Rec yds"]
        : contextualCategory === "receiving" ? ["Targets", "Rec", "Rec yds", "Rec TD"]
          : contextualCategory === "defense" ? ["Tackles", "Sacks", "INT", "FF", "PD"]
            : ["Fantasy PPR"];
  const headers = showFantasy && contextualCategory !== "other" && contextualCategory !== "kicking"
    ? ["Fantasy PPR", ...positionalHeaders]
    : positionalHeaders;

  return (
    <div className="yb-result-game-log">
      <h3>{profile.name} game log</h3>
      <div className="yb-table-scroll">
        <table className="yb-table">
          <thead>
            <tr>
              <th>Game</th><th>Result</th>
              {headers.map((header) => <th key={header} className="num">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {logs.map((game) => (
              <tr key={game.game_id}>
                <td>
                  <Link href={`/games/${encodeURIComponent(game.game_id)}`}>
                    {dateLabel(game.date)} {game.home ? "vs" : "@"} {game.opponent}
                  </Link>
                </td>
                <td>{game.result} {game.team_score ?? "-"}-{game.opp_score ?? "-"}</td>
                {categoryCells(game).map((cell, index) => <td key={index} className="num">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {logs.length === 0 && <p className="yb-muted">No matching games are loaded for this query scope.</p>}
    </div>
  );
}

export function ResultDrilldown({ result, leaderboard }: { result: AnswerResult; leaderboard: ReactNode }) {
  const [tab, setTab] = useState<Tab>("Leaderboard");
  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const category = resultCategory(result);
  const leaders = useMemo(() => {
    const first = result.rows[0];
    if (!first) return [];
    const leadingValue = Number(first.value);
    return result.rows.filter(
      (row) => Number(row.value) === leadingValue && row.player_id,
    );
  }, [result.rows]);
  const leaderIds = useMemo(() => leaders.map((row) => String(row.player_id)), [leaders]);

  useEffect(() => {
    let active = true;
    Promise.allSettled(leaderIds.map((id) => fetchPlayer(id)))
      .then((items) => {
        if (!active) return;
        const loaded = items.flatMap((item) =>
          item.status === "fulfilled" && item.value ? [item.value] : [],
        );
        setProfiles(loaded);
        setSelectedPlayer((current) => current || loaded[0]?.player_id || "");
      })
      .catch(() => active && setProfiles([]));
    return () => { active = false; };
  }, [leaderIds]);

  const profileById = new Map(profiles.map((profile) => [profile.player_id, profile]));
  const selected = profileById.get(selectedPlayer) ?? profiles[0];

  return (
    <section className="yb-result-drilldown" aria-label="Result drill-down">
      <div className="yb-result-leaders" aria-label={leaders.length > 1 ? "Tied leaders" : "Leader"}>
        {leaders.map((row) => {
          const id = String(row.player_id);
          const profile = profileById.get(id);
          return (
            <article
              key={id}
              className="yb-result-leader-card"
              data-themed={Boolean(profile?.team)}
              style={profile?.team ? teamTheme(profile.team) : undefined}
            >
              {profile && (
                <Headshot
                  src={profile.headshot_url}
                  name={profile.name}
                  scale="feature"
                />
              )}
              <div>
                <span>{leaders.length > 1 ? "Tied leader" : "Leader"}</span>
                <h3>{String(row.full_name)}</h3>
                <p>
                  {profile?.team && <TeamLogo team={profile.team} size={14} />}
                  {profile?.team_name ?? profile?.team ?? "NFL"} · {String(row.value)} {result.query_context?.metric_label ?? "value"}
                </p>
              </div>
              <Link href={`/players/${encodeURIComponent(id)}`}>View full profile</Link>
            </article>
          );
        })}
      </div>

      <div className="yb-result-tabs" role="tablist" aria-label="Result views" onKeyDown={tablistKeys}>
        {(["Leaderboard", "Leader comparison", "Game logs"] as const).map((item) => (
          <button
            key={item}
            id={`result-tab-${item.toLowerCase().replace(/\s/g, "-")}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls={`result-panel-${item.toLowerCase().replace(/\s/g, "-")}`}
            tabIndex={tab === item ? 0 : -1}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "Leaderboard" && (
        <div
          id="result-panel-leaderboard"
          className="yb-result-ranked-table"
          role="tabpanel"
          aria-labelledby="result-tab-leaderboard"
        >
          {leaderboard}
        </div>
      )}

      {tab === "Leader comparison" && (
        <div
          id="result-panel-leader-comparison"
          className="yb-table-scroll yb-leader-comparison"
          role="tabpanel"
          aria-labelledby="result-tab-leader-comparison"
        >
          <table className="yb-table">
            <thead><tr><th>Player</th>{FIELDS[category].map((field) => <th key={field.label} className="num">{field.label}</th>)}</tr></thead>
            <tbody>
              {profiles.map((profile) => {
                const totals = total(scopedLogs(profile, result));
                return (
                  <tr key={profile.player_id}>
                    <td>
                      <Link
                        className="yb-comparison-player"
                        href={`/players/${encodeURIComponent(profile.player_id)}`}
                      >
                        <Headshot
                          src={profile.headshot_url}
                          name={profile.name}
                          scale="card"
                        />
                        <span>
                          <strong>{profile.name}</strong>
                          <small>{profile.team_name ?? profile.team ?? "NFL"}</small>
                        </span>
                      </Link>
                    </td>
                    {FIELDS[category].map((field) => <td key={field.label} className="num">{field.value(totals)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {profiles.length === 0 && <p className="yb-muted">Loading leader comparison…</p>}
        </div>
      )}

      {tab === "Game logs" && (
        <div
          id="result-panel-game-logs"
          className="yb-result-log-panel"
          role="tabpanel"
          aria-labelledby="result-tab-game-logs"
        >
          {profiles.length > 0 && (
            <Dropdown
              options={profiles.map((profile) => ({ value: profile.player_id, label: profile.name }))}
              value={selected?.player_id ?? ""}
              onChange={setSelectedPlayer}
              ariaLabel="Select leader"
            />
          )}
          {selected ? <GameLogTable profile={selected} result={result} category={category} /> : <p className="yb-muted">Loading game logs…</p>}
        </div>
      )}
    </section>
  );
}
