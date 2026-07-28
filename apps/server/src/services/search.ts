/** Search-adjacent lookups: entity typeahead, example questions, shared answers. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExampleQuestion, SuggestResponse } from "@yunoball/types";
import { q } from "../db/pool.js";
import { headshotUrl } from "../lib/espn.js";

/** Entity typeahead: players and teams matching the fragment, most-recent and
 * most-productive players first. The player's team is his latest season's. */
export async function suggest(query: string, limit = 6): Promise<SuggestResponse> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return { query, questions: [], players: [], teams: [] };
  const sub = `%${needle}%`;
  const pre = `${needle}%`;

  const players = await q<{
    player_id: string; full_name: string; position: string | null; team_id: string | null;
  }>(
    `SELECT p.player_id, p.full_name, p.position,
            (SELECT s2.team_id FROM player_season_stats s2
             WHERE s2.player_id = p.player_id AND s2.team_id IS NOT NULL
             ORDER BY s2.season DESC LIMIT 1) AS team_id,
            COALESCE(MAX(s.season), 0) AS last_season,
            COALESCE(SUM(s.fantasy_points_ppr), 0) AS fp
     FROM players p
     LEFT JOIN player_season_stats s ON s.player_id = p.player_id
     WHERE LOWER(p.full_name) LIKE $1
     GROUP BY p.player_id, p.full_name, p.position
     ORDER BY CASE WHEN LOWER(p.full_name) LIKE $2 THEN 0 ELSE 1 END,
              last_season DESC, fp DESC, p.full_name
     LIMIT $3`,
    [sub, pre, limit],
  );

  const teams = await q<{ team_id: string; name: string; nickname: string | null }>(
    `SELECT team_id, name, nickname FROM teams
     WHERE LOWER(name) LIKE $1 OR LOWER(nickname) LIKE $1 OR LOWER(team_id) LIKE $2
     ORDER BY name
     LIMIT 4`,
    [sub, pre],
  );

  const terms = needle.split(/\s+/).filter(Boolean);
  const questions = (await supportedQuestions())
    .map((q) => q.question)
    .filter((question) => {
      const words = question.toLowerCase().split(/\s+/);
      return (
        question.toLowerCase().includes(needle) ||
        terms.every((term) => words.some((word) => word.startsWith(term)))
      );
    })
    .sort((a, b) => {
      const aText = a.toLowerCase();
      const bText = b.toLowerCase();
      const aStart = aText.startsWith(needle) ? 0 : 1;
      const bStart = bText.startsWith(needle) ? 0 : 1;
      return aStart - bStart || aText.indexOf(needle) - bText.indexOf(needle) || a.length - b.length;
    })
    .slice(0, 5);

  return {
    query,
    questions,
    players: players.map((r) => ({
      player_id: r.player_id,
      name: r.full_name,
      position: r.position,
      team: r.team_id,
      headshot_url: headshotUrl(r.player_id),
    })),
    teams,
  };
}

let questionsCache: ExampleQuestion[] | null = null;

/** The answerable-question corpus, each tagged with the coarse category the
 * ingest derived from the engine (see common_questions.json). */
function commonQuestions(): ExampleQuestion[] {
  if (questionsCache === null) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.resolve(here, "../../data/common_questions.json"), "utf-8");
    const data = JSON.parse(raw) as { questions: ExampleQuestion[] };
    questionsCache = data.questions;
  }
  return questionsCache;
}

// Cached once per process, like the question corpus itself: the loaded
// season window only changes on ingest, which comes with a restart.
let seasonRange: { min: number; max: number } | null | undefined;

async function loadedSeasonRange(): Promise<{ min: number; max: number } | null> {
  if (seasonRange === undefined) {
    const rows = await q<{ min: number | null; max: number | null }>(
      "SELECT MIN(season) AS min, MAX(season) AS max FROM seasons",
    );
    seasonRange =
      rows[0]?.min != null && rows[0]?.max != null
        ? { min: Number(rows[0].min), max: Number(rows[0].max) }
        : null;
  }
  return seasonRange;
}

async function supportedQuestions(): Promise<ExampleQuestion[]> {
  const range = await loadedSeasonRange();
  return commonQuestions().filter(({ question }) => {
    const years = question.match(/\b(?:19|20)\d{2}\b/g);
    if (!years) return true;
    if (!range) return false;
    return years.every((y) => Number(y) >= range.min && Number(y) <= range.max);
  });
}

/** In-place Fisher-Yates shuffle. */
function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

/** A balanced sample from the question corpus — powers the example chips and
 * the home trending card. Round-robin across categories so even a small n
 * spans every group, and the client groups off the tagged category instead of
 * re-deriving it (and no longer over-fetches the whole corpus to do so).
 * Only questions the warehouse can actually answer are offered: any year a
 * question names must fall inside the loaded season window (year-less
 * questions — careers, single-game records — are always fair game). */
export async function examples(n: number): Promise<ExampleQuestion[]> {
  const byCategory = new Map<string, ExampleQuestion[]>();
  for (const q of shuffle([...(await supportedQuestions())])) {
    const list = byCategory.get(q.category);
    if (list) list.push(q);
    else byCategory.set(q.category, [q]);
  }
  const queues = [...byCategory.values()];
  const out: ExampleQuestion[] = [];
  while (out.length < n && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      if (out.length >= n) break;
      const q = queue.shift();
      if (q) out.push(q);
    }
  }
  return out;
}
