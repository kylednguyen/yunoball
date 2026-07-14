"use client";

import { tablistKeys } from "../../components/tablist";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Crumbs } from "../../components/Crumbs";
import { Dropdown } from "../../components/Dropdown";
import { Headshot } from "../../components/Headshot";
import { SeasonSelect } from "../../components/SeasonSelect";
import { SortTable } from "../../components/SortTable";
import { TeamLogo } from "../../components/TeamLogo";
import { EntityHero, InfoGrid, SectionHeader, StatSummary } from "../../components/ui";
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
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--muted)",
                  fontWeight: 400,
                }}
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
            <span style={{ fontWeight: 700 }}>{s.points_per_game.toFixed(1)}</span>
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
                    <span className={s.position_rank <= 5 ? "yb-streak-w" : undefined}>
                      #{s.position_rank}
                      <span className="yb-lb-unit"> of {s.position_players}</span>
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
  const statColumns = position === "QB"
    ? [
        {
          key: "cmp_att", label: "Cmp/Att", numeric: true,
          value: (g: GameRow) => g.attempts,
          render: (g: GameRow) => <>{g.completions}/{g.attempts}</>,
        },
        {
          key: "pass_yds", label: "Pass yds", numeric: true,
          value: (g: GameRow) => g.passing_yards,
          render: (g: GameRow) => <>{g.passing_yards.toLocaleString()}</>,
        },
        { key: "pass_td", label: "Pass TD", numeric: true, value: (g: GameRow) => g.passing_tds },
        { key: "int", label: "INT", numeric: true, value: (g: GameRow) => g.interceptions },
        {
          key: "rating", label: "Rating", numeric: true,
          value: (g: GameRow) => passerRating(g.completions, g.attempts, g.passing_yards, g.passing_tds, g.interceptions),
        },
      ]
    : position === "RB"
      ? [
          { key: "carries", label: "Carries", numeric: true, value: (g: GameRow) => g.carries },
          { key: "rush_yds", label: "Rush yds", numeric: true, value: (g: GameRow) => g.rushing_yards },
          { key: "rush_td", label: "Rush TD", numeric: true, value: (g: GameRow) => g.rushing_tds },
          { key: "rec", label: "Rec", numeric: true, value: (g: GameRow) => g.receptions },
          { key: "rec_yds", label: "Rec yds", numeric: true, value: (g: GameRow) => g.receiving_yards },
          { key: "rec_td", label: "Rec TD", numeric: true, value: (g: GameRow) => g.receiving_tds },
        ]
      : position && DEFENSIVE.has(position)
        ? [
            { key: "tackles", label: "Tackles", numeric: true, value: (g: GameRow) => g.tackles },
            { key: "sacks", label: "Sacks", numeric: true, value: (g: GameRow) => g.def_sacks },
            { key: "def_int", label: "INT", numeric: true, value: (g: GameRow) => g.def_interceptions },
            { key: "ff", label: "FF", numeric: true, value: (g: GameRow) => g.forced_fumbles },
            { key: "pd", label: "PD", numeric: true, value: (g: GameRow) => g.passes_defended },
          ]
        : position === "WR" || position === "TE"
          ? [
              { key: "targets", label: "Targets", numeric: true, value: (g: GameRow) => g.targets },
              { key: "rec", label: "Rec", numeric: true, value: (g: GameRow) => g.receptions },
              { key: "rec_yds", label: "Rec yds", numeric: true, value: (g: GameRow) => g.receiving_yards },
              { key: "rec_td", label: "Rec TD", numeric: true, value: (g: GameRow) => g.receiving_tds },
            ]
          : [
              {
                key: "fantasy", label: "Fantasy PPR", numeric: true,
                value: (g: GameRow) => g.fantasy_points_ppr,
                render: (g: GameRow) => <>{g.fantasy_points_ppr.toFixed(1)}</>,
              },
            ];
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
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
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
                g.result === "W" ? "yb-streak-w" : g.result === "L" ? "yb-streak-l" : undefined
              }
            >
              {g.result} {g.team_score ?? "-"}-{g.opp_score ?? "-"}
            </span>
          ),
        },
        ...statColumns,
      ]}
    />
  );
}

/** One splits group as a table with derived PCT / yds-per-game columns. */
function SplitsGroup({ title, rows, position }: { title: string; rows: SplitRow[]; position: string | null }) {
  const per = (v: number, gp: number) => (gp ? (v / gp).toFixed(1) : "-");
  const isQB = position === "QB";
  return (
    <section className="yb-split-group">
      <h2>{title}</h2>
      <div className="yb-table-scroll">
        <table className="yb-table">
          <thead>
            <tr>
              <th>{title === "Overall" ? "Season" : title}</th>
              <th className="num">GP</th>
              {isQB && (
                <>
                  <th className="num">CMP</th>
                  <th className="num">ATT</th>
                  <th className="num">PCT</th>
                  <th className="num">Pass yds</th>
                  <th className="num">Yds/G</th>
                  <th className="num">TD</th>
                  <th className="num">INT</th>
                </>
              )}
              {!isQB && (
                <>
                  <th className="num">Rush yds</th>
                  <th className="num">Rush TD</th>
                  <th className="num">Rec</th>
                  <th className="num">Rec yds</th>
                  <th className="num">Yds/G</th>
                  <th className="num">Rec TD</th>
                </>
              )}
              {isQB && (
                <>
                  <th className="num">Rush yds</th>
                  <th className="num">Rush TD</th>
                </>
              )}
              <th className="num">PPG</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">{r.gp}</td>
                {isQB && (
                  <>
                    <td className="num">{r.completions.toLocaleString()}</td>
                    <td className="num">{r.attempts.toLocaleString()}</td>
                    <td className="num">
                      {r.attempts ? ((r.completions / r.attempts) * 100).toFixed(1) : "-"}
                    </td>
                    <td className="num">{r.passing_yards.toLocaleString()}</td>
                    <td className="num">{per(r.passing_yards, r.gp)}</td>
                    <td className="num">{r.passing_tds}</td>
                    <td className="num">{r.interceptions}</td>
                  </>
                )}
                {!isQB && (
                  <>
                    <td className="num">{r.rushing_yards.toLocaleString()}</td>
                    <td className="num">{r.rushing_tds}</td>
                    <td className="num">{r.receptions}</td>
                    <td className="num">{r.receiving_yards.toLocaleString()}</td>
                    <td className="num">
                      {per(
                        position === "RB" ? r.rushing_yards : r.receiving_yards,
                        r.gp,
                      )}
                    </td>
                    <td className="num">{r.receiving_tds}</td>
                  </>
                )}
                {isQB && (
                  <>
                    <td className="num">{r.rushing_yards.toLocaleString()}</td>
                    <td className="num">{r.rushing_tds}</td>
                  </>
                )}
                <td className="num" style={{ fontWeight: 700 }}>
                  {per(r.fantasy_points_ppr, r.gp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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

  // The header rank line follows the season in the URL; newest as fallback.
  const latest =
    profile?.seasons.find((s) => s.season === season) ?? profile?.seasons[0];
  const regLog = profile?.game_log.filter((g) => g.season_type === "REG") ?? [];
  const postLog = profile?.game_log.filter((g) => g.season_type === "POST") ?? [];
  const hasPlayoffs = (profile?.postseasons.length ?? 0) > 0 || postLog.length > 0;
  const gameLog = season ? regLog.filter((g) => g.season === season) : regLog;
  const logSeasons = [...new Set(regLog.map((g) => g.season))];
  const playerAge = ageFrom(profile?.bio.birth_date ?? null);
  const bioItems = profile
    ? [
        { label: "Height", value: fmtHeight(profile.bio.height_inches) },
        {
          label: "Weight",
          value: profile.bio.weight_lbs ? `${profile.bio.weight_lbs} lbs` : null,
        },
        { label: "Age", value: playerAge ? `${playerAge} years` : null },
        { label: "Born", value: fmtDate(profile.bio.birth_date) },
        { label: "College", value: profile.bio.college },
        {
          label: "Seasons",
          value:
            profile.bio.first_season && profile.bio.last_season
              ? `${profile.bio.first_season}-${profile.bio.last_season}`
              : null,
        },
      ].filter((item): item is { label: string; value: string } => Boolean(item.value))
    : [];

  return (
    <>
      <main id="main" className="yb-page yb-entity-page">
        {loading && (
          <>
            <div className="yb-skel" style={{ height: 60, width: 380, marginBottom: 20 }} />
            <div className="yb-skel" style={{ height: 110, borderRadius: 14, marginBottom: 20 }} />
            <div className="yb-skel" style={{ height: 300, borderRadius: 14 }} />
          </>
        )}

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Couldn’t load this player</h2>
            <p>{friendlyError(error)}</p>
          </div>
        )}

        {notFound && (
          <div className="yb-state">
            <h2>Player not found</h2>
            <p>
              That player isn’t in the warehouse yet. Try the{" "}
              <Link href="/leaders">leaders</Link> or <Link href="/">search</Link>.
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
            <EntityHero
              className="yb-player-profile"
              label={`${profile.name} profile`}
              media={
                <Headshot
                  src={profile.headshot_url}
                  name={profile.name}
                  scale="profile"
                  priority
                />
              }
              eyebrow={profile.position ? `${profile.position} profile` : "Player profile"}
              title={profile.name}
              meta={
                <>
                  {profile.team ? (
                    <Link className="yb-link" href={`/teams/${profile.team}`}>
                      <TeamLogo team={profile.team} size={18} />
                      {profile.team_name ?? profile.team}
                    </Link>
                  ) : (
                    <span>Free agent</span>
                  )}
                  <span>
                    {profile.career.seasons} season
                    {profile.career.seasons === 1 ? "" : "s"} / {profile.career.games_played} games
                  </span>
                  {latest?.position_rank && profile.position ? (
                    <span>
                      {profile.position} #{latest.position_rank} of {latest.position_players} in{" "}
                      {latest.season} PPR
                    </span>
                  ) : null}
                </>
              }
              utilities={
                <>
                  {latest && (
                    <SeasonSelect
                      seasons={profile.seasons.map((row) => row.season)}
                      value={latest.season}
                      onChange={setSeason}
                    />
                  )}
                  <button
                    className="yb-btn ghost"
                    onClick={() =>
                      (window.location.href = `/?q=${encodeURIComponent(
                        `${profile.name} career stats`,
                      )}`)
                    }
                  >
                    Ask about {profile.name.split(" ").pop()} →
                  </button>
                </>
              }
              details={<InfoGrid items={bioItems} />}
            />

            <div className="yb-player-tabs" role="tablist" aria-label="Player views" onKeyDown={tablistKeys}>
              {TABS.filter((t) => t !== "Playoffs" || hasPlayoffs).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "Overview" && (
              <div className="yb-profile-workspace">
                <aside className="yb-profile-rail" aria-label="Current season summary">
                  {latest && (
                    <StatSummary
                      title={`${latest.season} season summary`}
                      items={tiles(profile, latest, `${latest.games_played} games`)}
                    />
                  )}
                </aside>
                <div className="yb-profile-main">
                  {regLog.length > 0 && (
                    <section id="game-log" aria-label="Recent games">
                      <SectionHeader
                        title="Recent games"
                        meta="Latest five regular-season appearances"
                      />
                      <GameLogTable rows={regLog.slice(0, 5)} position={profile.position} />
                    </section>
                  )}
                  {profile.scoring_plays.length > 0 && (
                    <p className="yb-player-note">
                      {profile.scoring_plays.length} career touchdowns. First on{" "}
                      {fmtDate(profile.scoring_plays.at(-1)!.date)} against{" "}
                      {profile.scoring_plays.at(-1)!.opponent}, most recent on{" "}
                      {fmtDate(profile.scoring_plays[0]!.date)} against{" "}
                      {profile.scoring_plays[0]!.opponent}.
                    </p>
                  )}
                </div>
                <aside className="yb-profile-career" aria-label="Career statistics">
                  <StatSummary
                    title="Career summary"
                    items={tiles(profile, profile.career, "career")}
                  />
                </aside>
              </div>
            )}

            {tab === "Splits" && (
              <>
                <SectionHeader
                  title="Splits"
                  meta="Performance by situation"
                  action={
                    splits ? (
                    <Dropdown
                      ariaLabel="Splits season"
                      value={String(splits.season)}
                      onChange={(v) => setSeason(Number(v))}
                      options={splits.seasons.map((s) => ({
                        value: String(s),
                        label: `${s} season`,
                      }))}
                    />
                    ) : undefined
                  }
                />
                {splitsLoading && <div className="yb-skel" style={{ height: 260, borderRadius: 14 }} />}
                {!splitsLoading && splits === null && (
                  <div className="yb-state">
                    <h2>No splits available</h2>
                    <p>No per-game data for this player yet.</p>
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
              </>
            )}

            {tab === "Game Log" && (
              <>
                <SectionHeader
                  title="Game log"
                  meta={season ? `${season} regular season` : "All regular seasons"}
                  action={
                  <Dropdown
                    ariaLabel="Filter game log by season"
                    value={season ? String(season) : "all"}
                    onChange={(v) => setSeason(v === "all" ? undefined : Number(v))}
                    options={[
                      { value: "all", label: "All seasons" },
                      ...logSeasons.map((s) => ({ value: String(s), label: `${s} season` })),
                    ]}
                  />
                  }
                />
                {gameLog.length === 0 ? (
                  <div className="yb-state">
                    <h2>No games{season ? ` for ${season}` : ""}</h2>
                    <p>No per-game rows here. Pick another season above.</p>
                  </div>
                ) : (
                  <GameLogTable rows={gameLog} position={profile.position} />
                )}
              </>
            )}

            {tab === "Career" && (
              <>
                <SectionHeader
                  title="Season by season"
                  meta={`${profile.seasons.length} regular seasons`}
                  action={
                    <div className="yb-seg" role="group" aria-label="Stat display mode">
                      <button aria-pressed={!perGame} onClick={() => setPerGame(false)}>
                        Totals
                      </button>
                      <button aria-pressed={perGame} onClick={() => setPerGame(true)}>
                        Per game
                      </button>
                    </div>
                  }
                />
                <SeasonTable
                  rows={profile.seasons}
                  position={profile.position}
                  perGame={perGame}
                  showRank
                />
                {profile.scoring_plays.length > 0 && (
                  <section className="yb-profile-section-spaced">
                    <SectionHeader
                      title="Touchdown log"
                      meta={`${profile.scoring_plays.length} recorded scoring plays`}
                    />
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
                              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
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
                              className="yb-muted"
                              style={{
                                display: "inline-block",
                                maxWidth: 420,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                verticalAlign: "bottom",
                              }}
                              title={t.description ?? undefined}
                            >
                              {t.description ?? "-"}
                            </span>
                          ),
                        },
                      ]}
                    />
                  </section>
                )}
              </>
            )}

            {tab === "Playoffs" && (
              <>
                {profile.postseasons.length > 0 && (
                  <section>
                    <SectionHeader
                      title="Postseason, year by year"
                      meta={`${profile.postseasons.length} playoff seasons`}
                    />
                    <SeasonTable
                      rows={profile.postseasons}
                      position={profile.position}
                      perGame={false}
                      showRank={false}
                    />
                  </section>
                )}
                {postLog.length > 0 && (
                  <section className="yb-profile-section-spaced">
                    <SectionHeader title="Playoff game log" meta={`${postLog.length} games`} />
                    <GameLogTable rows={postLog} position={profile.position} />
                  </section>
                )}
                {profile.postseasons.length === 0 && postLog.length === 0 && (
                  <div className="yb-state">
                    <h2>No playoff games</h2>
                    <p>This player has no postseason rows in the warehouse.</p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
