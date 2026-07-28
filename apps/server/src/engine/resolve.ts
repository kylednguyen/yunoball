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
import { NFL_PLAYER_ALIASES } from "./aliases.js";
import { RESERVED } from "./parseRules.js";
import { ratio, quickRatio } from "./similarity.js";

// Words that should never anchor a player match (stats, question words, etc.).
const STOP = new Set([
  "most", "the", "in", "a", "an", "single", "game", "career", "who", "what",
  "of", "and", "vs", "with", "for", "season", "year", "all", "time", "best",
  "top", "led", "leader", "leaders", "threw", "throw", "passing", "rushing",
  "receiving", "yards", "yard", "touchdowns", "touchdown", "tds", "td",
  "interceptions", "receptions", "catches", "points", "how", "many",
  // Position / role nouns: "running back" must resolve to a position filter,
  // never fuzzy-match a surname ("back" -> "Black", "wide" -> "Wade").
  "running", "back", "backs", "wide", "receiver", "receivers",
  "quarterback", "quarterbacks", "cornerback", "linebacker",
  "defense", "offense", "defensive", "offensive",
  "player", "players", "rookie", "rookies",
  // Threshold / filter vocabulary: "two or more" must never fuzzy-match
  // "Moore", "winning" never "Manning", "turning" never "Turner". The fused
  // "primetime" is the broadcast-window filter, never Deion Sanders (his
  // "prime time" nickname, spaced, still resolves).
  "or", "more", "less", "fewer", "least", "above", "below", "turning",
  "winning", "losing", "streak", "streaks", "primetime",
  // Team-question vocabulary: "roster" -> Royster, "drive" -> Driver,
  // "division" -> Davison were real fuzzy-match misfires.
  "roster", "drive", "drives", "division", "conference", "colors", "color",
  // Unconsumed-qualifier vocabulary: real fuzzy/exact misfires surfaced by
  // the 100-question benchmark. "line" -> Zach Line ("5-yard line"),
  // "beginning" -> Benning Potoa'e ("before beginning his fifth season"),
  // "player's" -> Scott Player ("a player's final season"), "team" -> Tam
  // Hopkins ("his team lost"), "come" -> Michael Coe ("...come after age
  // 30"), "still" -> Tarheeb/Devon/Bryan Still ("...and still won"), "both"
  // -> Andrew Booth ("both a rushing and receiving touchdown").
  "line", "beginning", "player's", "team", "come", "still", "both",
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

// Generational suffix on a full name ("Kenneth Walker III", "Marvin Harrison
// Jr."). Stripped for search keys so the player resolves by their plain name
// and the real surname indexes (not "iii" / "jr.").
const NAME_SUFFIX = /\s+(?:jr|sr|ii|iii|iv|v)\.?$/i;

/** Lowercased name with any generational suffix removed. */
function stripSuffix(name: string): string {
  return name.replace(NAME_SUFFIX, "").trim();
}

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
  const rows = await q<{
    player_id: string; full_name: string; position: string | null; last_season: number | null;
  }>(
    `SELECT p.player_id, p.full_name, p.position, prod.last_season
     FROM players p
     LEFT JOIN (
       SELECT player_id,
              SUM(fantasy_points_ppr + tackles + 6 * def_sacks) AS fp,
              MAX(season) AS last_season
       FROM player_season_stats GROUP BY player_id
     ) prod USING (player_id)
     ORDER BY COALESCE(prod.fp, 0) DESC`,
  );
  const index = new Map<string, IndexedPlayer>();
  const lastSeason = new Map<string, number>();
  const byId = new Map<string, IndexedPlayer>();
  const add = (key: string, p: IndexedPlayer) => {
    if (key && !index.has(key)) index.set(key, p);
  };
  for (const r of rows) {
    const p = { playerId: r.player_id, name: r.full_name, position: r.position };
    byId.set(r.player_id, p);
    lastSeason.set(r.player_id, Number(r.last_season ?? 0));
    const full = r.full_name.toLowerCase();
    // Suffix-stripped base ("kenneth walker iii" -> "kenneth walker"). Search
    // keys derive from the base so the player resolves by their plain name and
    // the real surname ("walker") indexes instead of the suffix ("iii").
    const base = stripSuffix(full);
    add(full, p);
    add(base, p);
    // Users type names without punctuation: "aj brown" (periods), "jamarr
    // chase" (apostrophes), "amon ra st brown" (hyphens, both spaced and
    // fused). Index every folded variant of the full and base names.
    for (const key of [full, base]) {
      const noPunct = key.replace(/[.'’]/g, "");
      add(noPunct, p);
      add(noPunct.replace(/-/g, " "), p);
      add(noPunct.replace(/-/g, ""), p);
    }
    // First and last names resolve alone ("Lamar", "Mahomes") — the
    // most-productive player owns a shared name (rows arrive ordered).
    // Split the punctuation-folded base so "Amon-Ra" also owns "amon" and
    // "Ja'Marr" owns "jamarr" — AND the raw tokens, so a typed "amon-ra"
    // still hits an exact key instead of losing a tie to a bare surname.
    const rawParts = base.split(" ");
    const parts = base.replace(/[.'’]/g, "").replace(/-/g, " ").split(" ");
    for (const split of [rawParts, parts]) {
      add(split.at(-1)!, p);
      const first = split[0]!;
      if (split.length > 1 && first.length >= 3) add(first, p);
    }
  }
  // A still-active player claims their full/base name over a retired same-name
  // ancestor — whether the newer one carries a suffix ("Marvin Harrison" ->
  // Harrison Jr., 2024) or not ("Michael Pittman" -> the WR, not the retired
  // FB). Only full-name keys are reassigned (never bare surnames), and only on
  // a strictly-later final season, so production still decides among peers.
  for (const r of rows) {
    const base = stripSuffix(r.full_name.toLowerCase());
    const holder = index.get(base);
    if (
      holder &&
      holder.playerId !== r.player_id &&
      (lastSeason.get(r.player_id) ?? 0) > (lastSeason.get(holder.playerId) ?? 0)
    ) {
      index.set(base, { playerId: r.player_id, name: r.full_name, position: r.position });
    }
  }
  for (const [nick, fulls] of Object.entries(NICKNAMES)) {
    const hit = fulls.map((f) => index.get(f)).find(Boolean);
    if (hit && !index.has(nick)) index.set(nick, hit);
  }
  // The researched alias dictionary (aliases.ts): unambiguous, id-verified
  // entries only. Ambiguous aliases (jj, ad, fitz) stay out of the index —
  // their candidate metadata is for a clarification flow, never auto-resolve.
  for (const [alias, cands] of Object.entries(NFL_PLAYER_ALIASES)) {
    const hit = cands.length === 1 ? byId.get(cands[0]!.playerId) : undefined;
    if (hit && !index.has(alias)) index.set(alias, hit);
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
