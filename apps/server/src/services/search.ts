/** Search-adjacent lookups: entity typeahead, example questions, shared answers. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SuggestResponse } from "@yunoball/types";
import { q } from "../db/pool.js";
import { headshotUrl } from "../lib/espn.js";

/** Entity typeahead: players and teams matching the fragment, most-recent and
 * most-productive players first. The player's team is his latest season's. */
export async function suggest(query: string, limit = 6): Promise<SuggestResponse> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return { query, players: [], teams: [] };
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

  return {
    query,
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

let questionsCache: string[] | null = null;

function commonQuestions(): string[] {
  if (questionsCache === null) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.resolve(here, "../../data/common_questions.json"), "utf-8");
    const data = JSON.parse(raw) as { questions: { question: string }[] };
    questionsCache = data.questions.map((r) => r.question);
  }
  return questionsCache;
}

/** A random sample from the question corpus — powers the example chips. */
export function examples(n: number): string[] {
  const qs = [...commonQuestions()];
  const out: string[] = [];
  while (out.length < Math.min(n, qs.length)) {
    out.push(...qs.splice(Math.floor(Math.random() * qs.length), 1));
  }
  return out;
}
