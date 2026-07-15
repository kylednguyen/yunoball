/** Deterministic parse-testing harness for the YunoBall query engine.
 *
 * Replicates the FRONT of the real pipeline — resolveEntities -> loadIndex /
 * loadTeamIndex -> parseRules — but sources the player/team index from JSON
 * fixtures instead of Postgres. Every other line of logic is ported
 * byte-for-byte from apps/server/src/engine/resolve.ts so the QuerySpec it
 * emits is the SAME object production's parser would produce.
 *
 * Usage:  npx tsx apps/server/scripts/parseHarness.mts <questions.txt>
 *   - <questions.txt>: one natural-language question per line (blanks skipped)
 *   - stdout: one JSON object per line (JSONL): {"q": <question>, "result": <spec|{refusal}|null>}
 *   - stderr: any logging/diagnostics (stdout stays clean JSONL)
 */

import fs from "node:fs";
import type { ResolvedEntity } from "@yunoball/types";
import { RESERVED } from "../src/engine/parseRules.js";
import { parseRules } from "../src/engine/parseRules.js";
import type { IndexedPlayer, IndexedTeam } from "../src/engine/resolve.js";
import { ratio, quickRatio } from "../src/engine/similarity.js";

// ---------------------------------------------------------------------------
// Ported verbatim from resolve.ts (STOP / MIN_SPAN / THRESHOLD / NICKNAMES).
// ---------------------------------------------------------------------------

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
]);
// The parser's reserved question vocabulary is also off-limits here, so
// "in week 22" can never fuzzy-match a player named Weeks.
for (const w of RESERVED) STOP.add(w);
const MIN_SPAN = 4;
const THRESHOLD = 0.84;

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

// ---------------------------------------------------------------------------
// Fixture data sources (replace the DB `q()` calls). Resolved relative to this
// module so cwd never affects which fixtures load.
// ---------------------------------------------------------------------------

interface PlayerRow { player_id: string; full_name: string; position: string | null }
interface TeamRow { team_id: string; name: string; nickname: string | null }

const playerRows: PlayerRow[] = JSON.parse(
  fs.readFileSync(new URL("./fixtures/players.json", import.meta.url), "utf8"),
);
const teamRows: TeamRow[] = JSON.parse(
  fs.readFileSync(new URL("./fixtures/teams.json", import.meta.url), "utf8"),
);

// ---------------------------------------------------------------------------
// loadIndex — ported from resolve.ts lines 61-100. Only the data source
// changes: `rows` are the fixture array (ALREADY prominence-ordered) instead
// of the ORDER BY query result. The build loop is byte-for-byte identical.
// ---------------------------------------------------------------------------

function loadIndex(): Map<string, IndexedPlayer> {
  const rows = playerRows;
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
  return index;
}

// ---------------------------------------------------------------------------
// loadTeamIndex — ported from resolve.ts lines 111-135.
// ---------------------------------------------------------------------------

function loadTeamIndex(): Map<string, IndexedTeam> {
  const rows = teamRows;
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
  return index;
}

// ---------------------------------------------------------------------------
// spans + resolveEntities — ported from resolve.ts lines 137-185. The index /
// team index are built once and passed in (the real code awaits loadIndex /
// loadTeamIndex per call); the matching logic is byte-for-byte identical.
// ---------------------------------------------------------------------------

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

function resolveEntities(
  question: string,
  index: Map<string, IndexedPlayer>,
  teams: Map<string, IndexedTeam>,
): ResolvedEntity[] {
  // Team vocabulary ("bills", "ravens", "green bay") is never a player
  // mention, however well it fuzzy-matches a surname (Keaton Bills, Cravens,
  // "chiefs draft" -> Chris Draft). Any span containing a team key is out.
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

// ---------------------------------------------------------------------------
// Driver: read questions file, run each through the real front of the pipeline.
// ---------------------------------------------------------------------------

function main(): void {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("usage: tsx parseHarness.mts <questions.txt>\n");
    process.exit(2);
  }

  const index = loadIndex();
  const teams = loadTeamIndex();
  process.stderr.write(
    `[harness] index keys=${index.size} team keys=${teams.size} players=${playerRows.length} teams=${teamRows.length}\n`,
  );

  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const qn = raw.trim();
    if (!qn) continue; // skip blank lines
    const entities = resolveEntities(qn, index, teams);
    const spec = parseRules(qn, entities, index, { latestSeason: 2025, teams });
    process.stdout.write(JSON.stringify({ q: qn, result: spec }) + "\n");
  }
}

main();
