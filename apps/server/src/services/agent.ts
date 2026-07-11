/** The YunoBall assistant — deterministic intent routing over the same
 * trusted tools the rest of the platform uses: stats search (QuerySpec
 * pipeline), standings, scores, weekly performers and the fantasy pool.
 * Replies are templated from real query results — zero hallucination.
 * (The former OpenAI tool-calling mode was dropped with the LLM layer;
 * responses keep mode:"demo", which is what the frontend expects key-less.) */

import type { AgentStep, ChatTurn, FantasyPlayer } from "@yunoball/types";
import { runQueryPipeline } from "../engine/pipeline.js";
import { ApiError } from "../lib/errors.js";
import { getFantasyPlayers } from "./fantasy.js";
import { getGames, getPerformers } from "./games.js";
import { getStandings } from "./standings.js";

const WEEK_RE = /\bweek\s*(\d{1,2})\b/i;
const SEASON_RE = /\b(20\d{2})\b/;
const STANDINGS_RE = /\b(standings?|division|divisions|record|records|conference)\b/i;
const SCORES_RE = /\b(scores?|results?|schedule|games?|final|beat|won|lost)\b/i;
const FANTASY_RE = /\b(fantasy|start|sit|lineup|draft|ppr|waiver)\b/i;
const POSITION_RE = /\b(QB|RB|WR|TE)s?\b/i;
const PERFORMERS_RE =
  /\b(performers?|top players?|best (players?|games?)|stud|studs|blew up|went off|player of the week)\b/i;

// ------------------------------- Tools ------------------------------------ //

async function toolStandings(season?: number): Promise<string> {
  const data = await getStandings(season);
  const lines: string[] = [`${data.season} standings`];
  for (const conf of data.conferences) {
    for (const div of conf.divisions) {
      lines.push(`\n${div.division}`);
      for (const t of div.teams) {
        lines.push(
          `  ${t.name}: ${t.wins}-${t.losses}` +
            (t.ties ? `-${t.ties}` : "") +
            ` (${t.points_for} PF / ${t.points_against} PA, ${t.streak})`,
        );
      }
    }
  }
  return lines.join("\n");
}

async function toolScores(season?: number, week?: number): Promise<string> {
  const data = await getGames(season, week);
  const lines = [`Week ${data.week}, ${data.season} final scores`];
  for (const g of data.games) {
    lines.push(
      `  ${g.away.nickname ?? g.away.name} ${g.away.score} @ ` +
        `${g.home.nickname ?? g.home.name} ${g.home.score}`,
    );
  }
  return lines.join("\n");
}

async function toolPerformers(season?: number, week?: number): Promise<string> {
  const data = await getPerformers(season, week, 8);
  const lines = [`Performers of week ${data.week}, ${data.season}: top PPR fantasy lines`];
  for (const p of data.performers) {
    lines.push(
      `  ${p.rank}. ${p.name} (${p.position} vs ${p.opponent}): ` +
        `${p.fantasy_points_ppr} PPR: ${p.stat_line}`,
    );
  }
  return lines.join("\n");
}

async function toolFantasy(position?: string, season?: number): Promise<string> {
  const data = await getFantasyPlayers({ season, position, limit: 12 });
  const label = position ? `${position} ` : "";
  const lines = [`Top ${label}fantasy scorers (PPR), ${data.season}`];
  data.players.forEach((p, i) => {
    lines.push(
      `  ${i + 1}. ${p.name} (${p.position}, ${p.team}): ` +
        `${p.fantasy_points_ppr} pts, ${p.points_per_game}/gm`,
    );
  });
  return lines.join("\n");
}

async function toolSearch(question: string): Promise<string> {
  const resp = await runQueryPipeline(question);
  return resp.narration;
}

// --------------------------- Fantasy judgment ----------------------------- //

/** Points-for per game by team — the 'offense environment' factor. */
async function teamScoring(season?: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const data = await getStandings(season);
    for (const conf of data.conferences) {
      for (const div of conf.divisions) {
        for (const t of div.teams) {
          const games = t.wins + t.losses + t.ties;
          if (games) out.set(t.team_id, t.points_for / games);
        }
      }
    }
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  return out;
}

/** Share of fantasy points that came from touchdowns — a volatility proxy. */
function tdShare(p: FantasyPlayer): number {
  if (p.fantasy_points_ppr <= 0) return 0;
  const tdPts = p.passing_tds * 4 + (p.rushing_tds + p.receiving_tds) * 6;
  return tdPts / p.fantasy_points_ppr;
}

/** Rank named players with a multi-factor verdict, not raw points alone.
 *
 * Production rate leads; a reception-per-game bonus rewards the PPR floor;
 * team scoring rate captures the offense a player lives in. TD reliance is
 * surfaced as a caution rather than scored — TDs are the noisiest stat. */
async function judgeStartSit(picks: FantasyPlayer[], season: number): Promise<string> {
  const pfPg = await teamScoring(season);
  const leagueAvg = pfPg.size
    ? [...pfPg.values()].reduce((a, b) => a + b, 0) / pfPg.size
    : 0;

  const score = (p: FantasyPlayer): number => {
    let s = p.points_per_game;
    if (p.games_played) s += 0.4 * (p.receptions / p.games_played);
    const pf = p.team !== null ? pfPg.get(p.team) : undefined;
    if (pf !== undefined) s += 0.15 * (pf - leagueAvg);
    return s;
  };

  const ranked = [...picks].sort((a, b) => score(b) - score(a));
  const best = ranked[0]!;
  const rest = ranked.slice(1);

  const lines = [
    `Start ${best.name} (${best.position}, ${best.team}): ` +
      `${best.points_per_game} PPR points per game in ${season}.`,
  ];
  for (const p of rest) {
    lines.push(`Sit ${p.name} (${p.position}, ${p.team}): ${p.points_per_game}/gm.`);
  }

  lines.push("\nThe case:");
  lines.push(
    "• Production: " + ranked.map((p) => p.points_per_game.toFixed(1)).join(" vs ") + " PPR/gm",
  );
  const recRates = ranked.map((p) => (p.games_played ? p.receptions / p.games_played : 0));
  if (recRates.some((r) => r >= 1)) {
    lines.push("• PPR floor: " + recRates.map((r) => r.toFixed(1)).join(" vs ") + " receptions/gm");
  }
  if (pfPg.size && ranked.every((p) => p.team !== null && pfPg.has(p.team))) {
    lines.push(
      "• Offense environment: " +
        ranked.map((p) => `${p.team} ${pfPg.get(p.team!)!.toFixed(1)} PF/gm`).join(", "),
    );
  }
  for (const p of ranked) {
    const share = tdShare(p);
    if (share >= 0.35) {
      lines.push(
        `• TD reliance: ${p.name} gets ${Math.round(share * 100)}% of his points from` +
          " touchdowns, so more boom/bust",
      );
    }
  }
  return lines.join("\n");
}

// ------------------------------ Demo agent -------------------------------- //

export async function runAgent(messages: ChatTurn[]): Promise<{ reply: string; steps: AgentStep[] }> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) throw new ApiError(400, "No user message provided.");
  const question = lastUser.content;

  const seasonM = SEASON_RE.exec(question);
  const season = seasonM ? Number(seasonM[1]) : undefined;
  const weekM = WEEK_RE.exec(question);
  const week = weekM ? Number(weekM[1]) : undefined;

  // "Top performers in week 7" — a weekly leaderboard, distinct from the
  // season-long fantasy pool and from start/sit judgment.
  if (PERFORMERS_RE.test(question) || (weekM && FANTASY_RE.test(question))) {
    try {
      const text = await toolPerformers(season, week);
      return { reply: text, steps: [{ tool: "performers", summary: "Top weekly PPR fantasy lines" }] };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err; // e.g. week out of range — fall through
    }
  }

  if (FANTASY_RE.test(question)) {
    // Start/sit: find every player named in the question and judge them
    // schematically.
    const pool = await getFantasyPlayers({ season, limit: 500 });
    const lowered = question.toLowerCase();
    const picks = pool.players.filter((p) => {
      const last = p.name.toLowerCase().split(" ").at(-1)!;
      return (
        lowered.includes(p.name.toLowerCase()) ||
        new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lowered)
      );
    });
    if (picks.length >= 2) {
      const reply = await judgeStartSit(picks, pool.season);
      return {
        reply,
        steps: [
          {
            tool: "fantasy_judge",
            summary: "Weighed production, PPR floor, offense environment and TD reliance",
          },
        ],
      };
    }
    const posM = POSITION_RE.exec(question);
    const text = await toolFantasy(posM ? posM[1]!.toUpperCase() : undefined, season);
    return { reply: text, steps: [{ tool: "fantasy_pool", summary: "Top PPR scorers" }] };
  }

  if (STANDINGS_RE.test(question)) {
    const text = await toolStandings(season);
    return { reply: text, steps: [{ tool: "standings", summary: "Computed from game results" }] };
  }

  if (weekM || SCORES_RE.test(question)) {
    try {
      const text = await toolScores(season, week);
      return { reply: text, steps: [{ tool: "scores", summary: "Final scores from the warehouse" }] };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err; // fall through to stats search
    }
  }

  const narration = await toolSearch(question);
  return { reply: narration, steps: [{ tool: "stats_search", summary: "QuerySpec pipeline" }] };
}
