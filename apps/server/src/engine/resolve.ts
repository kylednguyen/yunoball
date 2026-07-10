/** Fuzzy entity resolution.
 *
 * Map free-text mentions ("Mahomes", "Pat Mahomes", a typo'd name) to a
 * canonical player id + display name, so downstream SQL filters on a stable
 * key instead of a brittle string match. Candidate names are pulled once and
 * cached in-process; n-gram spans of the question are fuzzy-matched with a
 * difflib-equivalent ratio.
 */

import { q } from "../db/pool.js";
import type { ResolvedEntity } from "@yunoball/types";
import { RESERVED } from "./parseRules.js";
import { ratio, quickRatio } from "./similarity.js";

// Words that should never anchor a player match (stats, question words, etc.).
const STOP = new Set([
  "most", "the", "in", "a", "an", "single", "game", "career", "who", "what",
  "of", "and", "vs", "with", "for", "season", "year", "all", "time", "best",
  "top", "led", "leader", "leaders", "threw", "throw", "passing", "rushing",
  "receiving", "yards", "yard", "touchdowns", "touchdown", "tds", "td",
  "interceptions", "receptions", "catches", "points", "how", "many",
]);
// The parser's reserved question vocabulary is also off-limits here, so
// "in week 22" can never fuzzy-match a player named Weeks.
for (const w of RESERVED) STOP.add(w);
const MIN_SPAN = 4;
const THRESHOLD = 0.84;

export interface IndexedPlayer {
  playerId: string;
  name: string;
  position: string | null;
}

/** Household nicknames -> the full-name index key they resolve to. Only
 * installed when the underlying player exists in the warehouse. */
const NICKNAMES: Record<string, string[]> = {
  cmc: ["christian mccaffrey"],
  obj: ["odell beckham jr.", "odell beckham"],
  tb12: ["tom brady"],
  arsb: ["amon-ra st. brown"],
  "a-rod": ["aaron rodgers"],
  gronk: ["rob gronkowski"],
  "the bus": ["jerome bettis"],
  megatron: ["calvin johnson"],
};

let indexCache: Map<string, IndexedPlayer> | null = null;

/** Lowercased match target (full name AND last name) -> player.
 *
 * Players are loaded most-productive-first (career PPR points), so when two
 * players share a name — a lone "smith", or two different Steve Smiths — the
 * one people actually mean wins the slot instead of DB row order deciding. */
export async function loadIndex(): Promise<Map<string, IndexedPlayer>> {
  if (indexCache) return indexCache;
  // Prominence blends fantasy production with defensive production, so a
  // shared name goes to the star on either side of the ball (T.J. Watt must
  // own "watt", not the fullback).
  const rows = await q<{ player_id: string; full_name: string; position: string | null }>(
    `SELECT p.player_id, p.full_name, p.position
     FROM players p
     LEFT JOIN (
       SELECT player_id,
              SUM(fantasy_points_ppr + tackles + 6 * def_sacks) AS fp
       FROM player_season_stats GROUP BY player_id
     ) prod USING (player_id)
     ORDER BY COALESCE(prod.fp, 0) DESC`,
  );
  const index = new Map<string, IndexedPlayer>();
  for (const r of rows) {
    const p = { playerId: r.player_id, name: r.full_name, position: r.position };
    const full = r.full_name.toLowerCase();
    if (!index.has(full)) index.set(full, p);
    // Initialed names also resolve without punctuation: "tj watt", "aj brown".
    const plain = full.replace(/\./g, "");
    if (plain !== full && !index.has(plain)) index.set(plain, p);
    // First and last names resolve alone ("Lamar", "Mahomes") — the
    // most-productive player owns a shared name (rows arrive ordered).
    const parts = full.split(" ");
    const last = parts.at(-1)!;
    if (!index.has(last)) index.set(last, p);
    const first = parts[0]!;
    if (parts.length > 1 && first.length >= 3 && !index.has(first)) {
      index.set(first, p);
    }
  }
  for (const [nick, fulls] of Object.entries(NICKNAMES)) {
    const hit = fulls.map((f) => index.get(f)).find(Boolean);
    if (hit && !index.has(nick)) index.set(nick, hit);
  }
  indexCache = index;
  return index;
}

export interface IndexedTeam {
  teamId: string;
  name: string;
}

let teamIndexCache: Map<string, IndexedTeam> | null = null;

/** Lowercased team nickname + full name -> team. (Abbreviations are left out
 * on purpose: "NO", "LA" and friends collide with English words.) */
export async function loadTeamIndex(): Promise<Map<string, IndexedTeam>> {
  if (teamIndexCache) return teamIndexCache;
  const rows = await q<{ team_id: string; name: string; nickname: string | null }>(
    "SELECT team_id, name, nickname FROM teams",
  );
  const index = new Map<string, IndexedTeam>();
  // City names resolve too ("green bay", "kansas city") — but only when the
  // city is unambiguous, so "new york" never silently picks a team.
  const cityCount = new Map<string, number>();
  const cityOf = (r: { name: string; nickname: string | null }) =>
    r.nickname ? r.name.replace(new RegExp(`\\s*${r.nickname}$`, "i"), "").trim().toLowerCase() : "";
  for (const r of rows) {
    const c = cityOf(r);
    if (c) cityCount.set(c, (cityCount.get(c) ?? 0) + 1);
  }
  for (const r of rows) {
    const t = { teamId: r.team_id, name: r.name };
    index.set(r.name.toLowerCase(), t);
    if (r.nickname) index.set(r.nickname.toLowerCase(), t);
    const c = cityOf(r);
    if (c && cityCount.get(c) === 1 && !index.has(c)) index.set(c, t);
  }
  teamIndexCache = index;
  return index;
}

export function clearIndexCache(): void {
  indexCache = null;
  teamIndexCache = null;
}

function spans(question: string): string[] {
  const words = question.match(/[A-Za-z.'-]+/g) ?? [];
  const out: string[] = [];
  for (const n of [2, 1, 3]) { // prefer "first last", then last name, then longer
    for (let i = 0; i + n <= words.length; i++) {
      const group = words.slice(i, i + n);
      if (group.every((w) => STOP.has(w.toLowerCase()))) continue;
      const span = group.join(" ").toLowerCase();
      if (span.length >= MIN_SPAN) out.push(span);
    }
  }
  return out;
}

export async function resolveEntities(question: string): Promise<ResolvedEntity[]> {
  const index = await loadIndex();
  // Team vocabulary ("bills", "ravens", "green bay") is never a player
  // mention, however well it fuzzy-matches a surname (Keaton Bills, Cravens,
  // "chiefs draft" -> Chris Draft). Any span containing a team key is out.
  const teams = await loadTeamIndex().catch(() => new Map<string, IndexedTeam>());
  const teamRe = teams.size
    ? new RegExp(`\\b(${[...teams.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`)
    : null;
  const candidates = spans(question).filter((span) => !(teamRe && teamRe.test(span)));
  if (candidates.length === 0) return [];

  let best: { score: number; target: string; span: string } | null = null;
  for (const span of candidates) {
    for (const target of index.keys()) {
      // quick_ratio is an upper bound on ratio — prune cheaply first.
      if (quickRatio(span, target) < THRESHOLD) continue;
      const score = ratio(span, target);
      if (score >= THRESHOLD && (best === null || score > best.score)) {
        best = { score, target, span };
      }
    }
  }
  if (!best) return [];
  const hit = index.get(best.target)!;
  return [
    {
      mention: best.span,
      entity_type: "player",
      canonical_id: hit.playerId,
      display_name: hit.name,
      confidence: Math.round(best.score * 1000) / 1000,
    },
  ];
}
