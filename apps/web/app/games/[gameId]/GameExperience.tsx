"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Crumbs } from "../../components/Crumbs";
import { Headshot } from "../../components/Headshot";
import { TeamLogo } from "../../components/TeamLogo";
import { Surface } from "../../components/ui";
import { useBoxScore, useStrParam, useTitle } from "../../lib/hooks";
import { weekLabel } from "../../lib/format";
import { passerRating } from "../../lib/rating";
import { friendlyError } from "../../lib/api";
import type { BoxScore, BoxScorePlayer, ScoringLogEntry } from "../../lib/api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(d: string | null): string | null {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null;
}

function fmtTop(sec: number | null): string | null {
  if (sec == null) return null;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

const QTR_NAMES: Record<number, string> = {
  1: "1st Quarter", 2: "2nd Quarter", 3: "3rd Quarter", 4: "4th Quarter", 5: "Overtime",
};

const SCORE_TYPE: Record<string, string> = {
  pass: "Passing TD", run: "Rushing TD", kickoff: "Kick return TD",
  punt: "Punt return TD", field_goal: "Field goal",
};

/** Turnover-return scores outrank the play type: an intercepted pass returned
 * for a touchdown is a pick six, not a passing TD. */
function scoreType(s: ScoringLogEntry): string {
  const d = s.description ?? "";
  if (/TOUCHDOWN/i.test(d)) {
    if (/INTERCEPT/i.test(d)) return "Pick six";
    if (/FUMBLE/i.test(d)) return "Fumble return TD";
  }
  return SCORE_TYPE[s.play_type ?? ""] ?? "Score";
}

function PlayerLink({ p, children }: { p: { player_id: string }; children: React.ReactNode }) {
  return <Link href={`/players/${encodeURIComponent(p.player_id)}`}>{children}</Link>;
}

// ---- Score header (shared by both tabs) ------------------------------------

function GameHeader({ box }: { box: BoxScore }) {
  const finalGame = box.home.score !== null && box.away.score !== null;
  const meta = [
    finalGame ? "Final" : "Scheduled",
    weekLabel(box.week, box.season),
    fmtDate(box.date) ?? String(box.season),
    box.stadium,
  ].filter(Boolean).join(" · ");

  return (
    <header className="yb-game-head" aria-label="Score">
      <p className="yb-game-meta">{meta}</p>
      {[box.away, box.home].map((t) => {
        const other = t === box.away ? box.home : box.away;
        const won = finalGame && (t.score ?? 0) > (other.score ?? 0);
        return (
          <div key={t.team_id} className={`yb-game-team-row${won ? " winner" : ""}`}>
            <Link href={`/teams/${t.team_id}?season=${box.season}`} className="tm">
              <TeamLogo team={t.team_id} size={44} />
              <span>
                <span className="nm">{t.nickname ?? t.name}</span>
                <span className="sub">{t.team_id}{t.record ? ` · ${t.record}` : ""}</span>
              </span>
            </Link>
            <span className="score">{t.score ?? "–"}</span>
          </div>
        );
      })}
    </header>
  );
}

// ---- Team comparison (Summary + Box Overview) -------------------------------

function TeamComparison({ box }: { box: BoxScore }) {
  const a = box.away.line;
  const h = box.home.line;
  if (!a && !h) return null;
  const total = (l: typeof a) =>
    l?.total_yards ??
    (l && (l.passing_yards != null || l.rushing_yards != null)
      ? (l.passing_yards ?? 0) + (l.rushing_yards ?? 0)
      : null);
  const rows: [string, number | string | null, number | string | null][] = [
    ["Total yards", total(a), total(h)],
    ["Passing yards", a?.passing_yards ?? null, h?.passing_yards ?? null],
    ["Rushing yards", a?.rushing_yards ?? null, h?.rushing_yards ?? null],
    ["Turnovers", a?.turnovers ?? null, h?.turnovers ?? null],
    ["Time of possession", fmtTop(a?.time_of_possession_sec ?? null), fmtTop(h?.time_of_possession_sec ?? null)],
    ["Drives", a?.drives ?? null, h?.drives ?? null],
  ];
  const visible = rows.filter(([, av, hv]) => av != null || hv != null);
  if (visible.length === 0) return null;

  return (
    <Surface as="section" className="yb-game-cmp" aria-label="Team comparison">
      <h2>Team Comparison</h2>
      <div className="yb-game-cmp-head" aria-hidden="true">
        <span>{box.away.team_id}</span>
        <span />
        <span>{box.home.team_id}</span>
      </div>
      {visible.map(([label, av, hv]) => {
        // Lower is better only for turnovers; everything else higher-wins.
        const flip = label === "Turnovers";
        const an = typeof av === "number" ? av : null;
        const hn = typeof hv === "number" ? hv : null;
        const aLeads = an != null && hn != null && (flip ? an < hn : an > hn);
        const hLeads = an != null && hn != null && (flip ? hn < an : hn > an);
        return (
          <div key={label} className="yb-game-cmp-row">
            <span className={`v${aLeads ? " lead" : ""}`}>{av ?? "–"}</span>
            <span className="lbl">{label}</span>
            <span className={`v${hLeads ? " lead" : ""}`}>{hv ?? "–"}</span>
          </div>
        );
      })}
    </Surface>
  );
}

// ---- Top performers ---------------------------------------------------------

function topBy(players: BoxScorePlayer[], key: (p: BoxScorePlayer) => number): BoxScorePlayer | null {
  const best = [...players].sort((x, y) => key(y) - key(x))[0];
  return best && key(best) > 0 ? best : null;
}

function performerLine(p: BoxScorePlayer, kind: "pass" | "rush" | "recv"): string {
  if (kind === "pass") {
    const rtg = passerRating(p.completions, p.attempts, p.passing_yards, p.passing_tds, p.interceptions);
    return `${p.completions}/${p.attempts}, ${p.passing_yards} yds, ${p.passing_tds} TD${p.interceptions ? `, ${p.interceptions} INT` : ""}${rtg != null ? `, ${rtg} RTG` : ""}`;
  }
  if (kind === "rush") return `${p.carries} car, ${p.rushing_yards} yds${p.rushing_tds ? `, ${p.rushing_tds} TD` : ""}`;
  return `${p.receptions}/${p.targets} rec, ${p.receiving_yards} yds${p.receiving_tds ? `, ${p.receiving_tds} TD` : ""}`;
}

function TopPerformers({ box, title = "Top Performers" }: { box: BoxScore; title?: string }) {
  const kinds = [
    { label: "Passing", kind: "pass" as const, pick: (p: BoxScorePlayer) => p.passing_yards },
    { label: "Rushing", kind: "rush" as const, pick: (p: BoxScorePlayer) => p.rushing_yards },
    { label: "Receiving", kind: "recv" as const, pick: (p: BoxScorePlayer) => p.receiving_yards },
  ];
  return (
    <Surface as="section" className="yb-game-performers" aria-label={title}>
      <h2>{title}</h2>
      <div className="yb-game-performers-grid">
        {[box.away, box.home].map((t) => (
          <div key={t.team_id}>
            <h3><TeamLogo team={t.team_id} size={18} /> {t.nickname ?? t.name}</h3>
            {kinds.map(({ label, kind, pick }) => {
              const p = topBy(t.players, pick);
              if (!p) return null;
              return (
                <div key={label} className="yb-game-performer">
                  <Headshot src={p.headshot_url} name={p.name} scale="compact" />
                  <div>
                    <PlayerLink p={p}>{p.name}</PlayerLink>
                    <span className="line">{label} · {performerLine(p, kind)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Surface>
  );
}

// ---- Scoring log ------------------------------------------------------------

function ScoringLog({ box }: { box: BoxScore }) {
  if (box.scoring.length === 0) return null;
  const quarters = [...new Set(box.scoring.map((s) => s.qtr ?? 0))];
  return (
    <Surface as="section" className="yb-scoring-log" aria-label="Scoring log">
      <h2>Scoring Log</h2>
      <p className="yb-scoring-note">Scoring events as recorded in the warehouse — touchdowns, return scores, and field goals where available.</p>
      {quarters.map((qtr) => (
        <div key={qtr}>
          <h3>{QTR_NAMES[qtr] ?? "Scoring"}</h3>
          {box.scoring.filter((s) => (s.qtr ?? 0) === qtr).map((s, i) => (
            <div key={i} className="yb-scoring-row">
              <TeamLogo team={s.team_id} size={22} />
              <span className="clk">{s.clock ?? ""}</span>
              <div className="what">
                <span className="who">
                  {s.player_id && s.player
                    ? <PlayerLink p={{ player_id: s.player_id }}>{s.player}</PlayerLink>
                    : (s.player ?? s.team_id)}
                  <span className="kind"> · {scoreType(s)}{s.yards != null ? ` · ${s.yards} yds` : ""}</span>
                </span>
                {s.description && <span className="desc">{s.description}</span>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </Surface>
  );
}

// ---- Game information ---------------------------------------------------------

function GameInfo({ box }: { box: BoxScore }) {
  const items: [string, string][] = [];
  const d = fmtDate(box.date);
  if (d) items.push(["Date", d]);
  if (box.gametime) items.push(["Kickoff", box.gametime]);
  items.push(["Week", weekLabel(box.week, box.season)]);
  if (box.stadium) items.push(["Stadium", box.stadium]);
  if (box.roof || box.surface) items.push(["Field", [box.roof, box.surface].filter(Boolean).join(" · ")]);
  if (box.temp != null) items.push(["Temperature", `${box.temp}°F${box.wind != null ? `, wind ${box.wind} mph` : ""}`]);
  if (box.home_coach && box.away_coach) items.push(["Coaches", `${box.away_coach} · ${box.home_coach}`]);
  return (
    <Surface as="section" className="yb-game-info" aria-label="Game information">
      <h2>Game Information</h2>
      <dl>
        {items.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </Surface>
  );
}

// ---- Game summary sentence ----------------------------------------------------

function GameSummary({ box }: { box: BoxScore }) {
  if (box.home.score === null || box.away.score === null) return null;
  const [winner, loser] =
    box.home.score > box.away.score ? [box.home, box.away] : [box.away, box.home];
  const star = topBy([...box.home.players, ...box.away.players], (p) => p.fantasy_points_ppr);
  const starKind = star
    ? star.passing_yards >= Math.max(star.rushing_yards, star.receiving_yards)
      ? ("pass" as const)
      : star.rushing_yards >= star.receiving_yards ? ("rush" as const) : ("recv" as const)
    : null;
  return (
    <Surface as="section" className="yb-game-summary" aria-label="Game summary">
      <h2>Game Summary</h2>
      <p>
        The {winner.nickname ?? winner.name} beat the {loser.nickname ?? loser.name}{" "}
        {winner.score}–{loser.score} in{" "}
        {/^Week/.test(weekLabel(box.week, box.season))
          ? weekLabel(box.week, box.season)
          : `the ${weekLabel(box.week, box.season)}`}
        {box.stadium ? ` at ${box.stadium}` : ""}.
        {star && starKind && (
          <> <PlayerLink p={star}>{star.name}</PlayerLink> led all players with{" "}
          {performerLine(star, starKind)}.</>
        )}
      </p>
    </Surface>
  );
}

// ---- Box score tables ----------------------------------------------------------

type Category = "overview" | "passing" | "rushing" | "receiving" | "defense" | "fumbles";
const CATEGORIES: { key: Category; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "passing", label: "Passing" },
  { key: "rushing", label: "Rushing" },
  { key: "receiving", label: "Receiving" },
  { key: "defense", label: "Defense" },
  { key: "fumbles", label: "Fumbles" },
];

interface Col { label: string; title?: string; value: (p: BoxScorePlayer) => string | number }

const TABLES: Record<Exclude<Category, "overview">, {
  rows: (ps: BoxScorePlayer[]) => BoxScorePlayer[];
  lead: (p: BoxScorePlayer) => number;
  cols: Col[];
}> = {
  passing: {
    rows: (ps) => ps.filter((p) => p.attempts > 0).sort((a, b) => b.passing_yards - a.passing_yards),
    lead: (p) => p.passing_yards,
    cols: [
      { label: "C/ATT", title: "Completions/attempts", value: (p) => `${p.completions}/${p.attempts}` },
      { label: "YDS", value: (p) => p.passing_yards },
      { label: "AVG", title: "Yards per attempt", value: (p) => (p.attempts ? (p.passing_yards / p.attempts).toFixed(1) : "–") },
      { label: "TD", value: (p) => p.passing_tds },
      { label: "INT", value: (p) => p.interceptions },
      { label: "SACKS", value: (p) => p.sacks },
      { label: "RTG", title: "Passer rating", value: (p) => passerRating(p.completions, p.attempts, p.passing_yards, p.passing_tds, p.interceptions) ?? "–" },
    ],
  },
  rushing: {
    rows: (ps) => ps.filter((p) => p.carries > 0).sort((a, b) => b.rushing_yards - a.rushing_yards),
    lead: (p) => p.rushing_yards,
    cols: [
      { label: "CAR", value: (p) => p.carries },
      { label: "YDS", value: (p) => p.rushing_yards },
      { label: "AVG", title: "Yards per carry", value: (p) => (p.carries ? (p.rushing_yards / p.carries).toFixed(1) : "–") },
      { label: "TD", value: (p) => p.rushing_tds },
    ],
  },
  receiving: {
    rows: (ps) => ps.filter((p) => p.targets > 0 || p.receptions > 0).sort((a, b) => b.receiving_yards - a.receiving_yards),
    lead: (p) => p.receiving_yards,
    cols: [
      { label: "REC/TGT", title: "Receptions/targets", value: (p) => `${p.receptions}/${p.targets}` },
      { label: "YDS", value: (p) => p.receiving_yards },
      { label: "AVG", title: "Yards per reception", value: (p) => (p.receptions ? (p.receiving_yards / p.receptions).toFixed(1) : "–") },
      { label: "TD", value: (p) => p.receiving_tds },
    ],
  },
  defense: {
    rows: (ps) =>
      ps.filter((p) => p.tackles > 0 || p.def_sacks > 0 || p.def_interceptions > 0 || p.forced_fumbles > 0 || p.passes_defended > 0)
        .sort((a, b) => b.tackles - a.tackles),
    lead: (p) => p.tackles,
    cols: [
      { label: "TCK", title: "Tackles", value: (p) => p.tackles },
      { label: "SACKS", value: (p) => p.def_sacks },
      { label: "INT", value: (p) => p.def_interceptions },
      { label: "FF", title: "Forced fumbles", value: (p) => p.forced_fumbles },
      { label: "PD", title: "Passes defended", value: (p) => p.passes_defended },
    ],
  },
  fumbles: {
    rows: (ps) => ps.filter((p) => p.fumbles > 0 || p.fumbles_lost > 0).sort((a, b) => b.fumbles - a.fumbles),
    lead: () => 0, // nobody "leads" a fumble table
    cols: [
      { label: "FUM", value: (p) => p.fumbles },
      { label: "LOST", value: (p) => p.fumbles_lost },
    ],
  },
};

function CategoryTable({ box, category }: { box: BoxScore; category: Exclude<Category, "overview"> }) {
  const t = TABLES[category];
  const sections = [box.away, box.home]
    .map((team) => ({ team, rows: t.rows(team.players) }))
    .filter((s) => s.rows.length > 0);
  if (sections.length === 0) {
    return <p className="yb-box-empty">No {category} stats recorded for this game.</p>;
  }
  return (
    <>
      {sections.map(({ team, rows }) => {
        const best = Math.max(...rows.map(t.lead));
        return (
          <section key={team.team_id} className="yb-box-team">
            <h3 className="yb-box-teamhead">
              <TeamLogo team={team.team_id} size={22} />
              {team.nickname ?? team.name}
            </h3>
            <div className="yb-table-scroll">
              <table className="yb-table yb-box-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    {t.cols.map((c) => (
                      <th key={c.label} className="num" title={c.title}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.player_id} className={best > 0 && t.lead(p) === best ? "lead" : undefined}>
                      <td><PlayerLink p={p}>{p.name}</PlayerLink></td>
                      {t.cols.map((c) => (
                        <td key={c.label} className="num">{c.value(p)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

function BoxScoreTab({ box }: { box: BoxScore }) {
  const [category, setCategory] = useStrParam("category", "overview");
  const active: Category = (CATEGORIES.find((c) => c.key === category)?.key ?? "overview") as Category;
  return (
    <>
      <div className="yb-box-subtabs">
        <div className="yb-player-tabs" role="tablist" aria-label="Box score categories">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={active === c.key}
              className={active === c.key ? "on" : undefined}
              onClick={() => setCategory(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {active === "overview" ? (
        <div className="yb-game-sections">
          <TeamComparison box={box} />
          <TopPerformers box={box} title="Statistical Leaders" />
        </div>
      ) : (
        <Surface as="div" className="yb-game-box">
          <CategoryTable box={box} category={active} />
        </Surface>
      )}
    </>
  );
}

// ---- The screen -----------------------------------------------------------------

export function GameExperience({ tab }: { tab: "summary" | "box" }) {
  const params = useParams<{ gameId: string }>();
  const gameId = params?.gameId ? decodeURIComponent(params.gameId) : undefined;
  const { data: box, error, loading } = useBoxScore(gameId);
  const notFound = !loading && !error && box === null;
  useTitle(box ? `${box.away.team_id} @ ${box.home.team_id} · ${weekLabel(box.week, box.season)}` : undefined);

  return (
    <main id="main" className="yb-page" style={{ maxWidth: 880 }}>
      <h1 className="yb-sr-only">
        {box
          ? `${box.away.name} ${box.away.score ?? ""} at ${box.home.name} ${box.home.score ?? ""}`
          : "Game"}
      </h1>
      {loading && (
        <>
          <div className="yb-skel" style={{ height: 150, borderRadius: "var(--r-xl)", marginBottom: 20 }} />
          <div className="yb-skel" style={{ height: 340, borderRadius: "var(--r-xl)" }} />
        </>
      )}

      {error && !loading && (
        <div className="yb-state error" role="alert">
          <h2>Couldn’t load this game</h2>
          <p>{friendlyError(error)}</p>
        </div>
      )}

      {notFound && (
        <div className="yb-state">
          <h2>Game not found</h2>
          <p>That game isn’t in the warehouse. Head back to <Link href="/scores">Scores</Link>.</p>
        </div>
      )}

      {box && (
        <>
          <Crumbs
            items={[
              { label: `${box.season} ${weekLabel(box.week, box.season)}`, href: `/scores?season=${box.season}` },
              { label: `${box.away.team_id} @ ${box.home.team_id}` },
            ]}
          />
          <GameHeader box={box} />
          <nav className="yb-team-tabs yb-game-tabs" aria-label="Game views">
            <Link href={`/games/${encodeURIComponent(box.game_id)}`} aria-current={tab === "summary" ? "true" : undefined}>
              Summary
            </Link>
            <Link href={`/games/${encodeURIComponent(box.game_id)}/box`} aria-current={tab === "box" ? "true" : undefined}>
              Box Score
            </Link>
          </nav>

          {tab === "summary" ? (
            <div className="yb-game-sections">
              <GameSummary box={box} />
              <TeamComparison box={box} />
              <TopPerformers box={box} />
              <ScoringLog box={box} />
              <GameInfo box={box} />
            </div>
          ) : (
            <BoxScoreTab box={box} />
          )}
        </>
      )}
    </main>
  );
}
