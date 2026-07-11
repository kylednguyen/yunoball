/** Second-layer query auditor.
 *
 * Runs AFTER the deterministic parser and BEFORE SQL generation. It never
 * invents data — it validates the structured query candidate against what the
 * warehouse actually holds, normalizes what it can, asks for clarification
 * when a name is genuinely ambiguous, and rejects contradictions with an
 * honest sentence. Every decision is structured (status + warnings +
 * per-field confidence), and the pipeline logs one audit record per question.
 */

import type { ResolvedEntity } from "@yunoball/types";
import { q } from "../db/pool.js";
import { sbName } from "./build.js";
import type { QuerySpec } from "./spec.js";

export type AuditStatus =
  | "validated"
  | "validated_with_warnings"
  | "needs_clarification"
  | "no_matching_data"
  | "invalid";

export interface AuditConfidence {
  overall: number;
  entity: number;
  season: number;
  gameType: number;
  metric: number;
}

export interface AuditOutcome {
  status: AuditStatus;
  spec: QuerySpec;
  warnings: string[];
  /** Human sentence for non-validated statuses. */
  reason?: string;
  /** needs_clarification: the candidate entities, ready to render. */
  options?: Record<string, unknown>[];
  confidence: AuditConfidence;
}

export interface AuditCtx {
  question: string;
  entities: ResolvedEntity[];
  latestSeason: number | null;
}

/** Warehouse stats coverage starts here (draft history reaches back further). */
export const STATS_MIN_SEASON = 1999;
const DRAFT_MIN_SEASON = 1980;

// Cheap probes cached for the process lifetime of a few minutes.
const PROBE_TTL_MS = 10 * 60 * 1000;
let draftMax: { value: number | null; at: number } | null = null;
const seasonComplete = new Map<number, { value: boolean; at: number }>();

async function draftMaxSeason(): Promise<number | null> {
  if (draftMax && Date.now() - draftMax.at < PROBE_TTL_MS) return draftMax.value;
  try {
    const rows = await q<{ max: number | null }>("SELECT MAX(season) AS max FROM draft_picks");
    draftMax = { value: rows[0]?.max ?? null, at: Date.now() };
  } catch {
    draftMax = { value: null, at: Date.now() };
  }
  return draftMax.value;
}

/** A season counts as complete once its Super Bowl (max POST week) has a
 * final score — never describe an in-progress season as settled. */
async function isSeasonComplete(season: number): Promise<boolean> {
  const hit = seasonComplete.get(season);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.value;
  let value = false;
  try {
    const rows = await q<{ done: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM games g
         WHERE g.season = $1 AND g.season_type = 'POST' AND g.home_score IS NOT NULL
           AND g.week = (SELECT MAX(g2.week) FROM games g2
                         WHERE g2.season = $1 AND g2.season_type = 'POST')
       ) AS done`,
      [season],
    );
    value = Boolean(rows[0]?.done);
  } catch {
    value = true; // never block an answer on a failed probe
  }
  seasonComplete.set(season, { value, at: Date.now() });
  return value;
}

/** Position families a stat implies — used to auto-disambiguate surnames
 * ("allen passing stats" means the QB, not the WR). */
const STAT_POSITIONS: Record<string, Set<string>> = {
  passing_yards: new Set(["QB"]),
  passing_tds: new Set(["QB"]),
  interceptions: new Set(["QB"]),
  completion_pct: new Set(["QB"]),
  sacks_taken: new Set(["QB"]),
  rushing_yards: new Set(["RB", "QB", "FB"]),
  rushing_tds: new Set(["RB", "QB", "FB"]),
  receiving_yards: new Set(["WR", "TE", "RB"]),
  receiving_tds: new Set(["WR", "TE", "RB"]),
  receptions: new Set(["WR", "TE", "RB"]),
  tackles: new Set(["LB", "ILB", "OLB", "MLB", "DL", "DE", "DT", "NT", "CB", "S", "FS", "SS", "DB", "EDGE"]),
  def_sacks: new Set(["LB", "ILB", "OLB", "MLB", "DL", "DE", "DT", "NT", "EDGE", "DB", "CB", "S"]),
  forced_fumbles: new Set(["LB", "DL", "DE", "DT", "DB", "CB", "S", "EDGE"]),
  passes_defended: new Set(["CB", "S", "FS", "SS", "DB", "LB"]),
};

interface SurnameCandidate {
  player_id: string;
  full_name: string;
  position: string | null;
  last_season: number;
  prod: number;
}

/** The question named only a surname: find every plausible owner. */
async function surnameCandidates(surname: string): Promise<SurnameCandidate[]> {
  return q<SurnameCandidate>(
    `SELECT p.player_id, p.full_name, p.position,
            MAX(s.season) AS last_season,
            COALESCE(SUM(s.fantasy_points_ppr + s.tackles + 6 * s.def_sacks), 0) AS prod
     FROM players p
     JOIN player_season_stats s ON s.player_id = p.player_id
     WHERE lower(p.full_name) LIKE $1
     GROUP BY p.player_id, p.full_name, p.position
     ORDER BY prod DESC
     LIMIT 8`,
    [`% ${surname.toLowerCase()}`],
  );
}

const PLAYER_INTENTS = new Set(["player_total", "player_seasons", "game_log", "game_count", "scoring"]);

function outcome(
  status: AuditStatus,
  spec: QuerySpec,
  confidence: AuditConfidence,
  extra: Partial<AuditOutcome> = {},
): AuditOutcome {
  return { status, spec, warnings: [], confidence, ...extra };
}

export async function audit(spec: QuerySpec, ctx: AuditCtx): Promise<AuditOutcome> {
  const warnings: string[] = [];
  const confidence: AuditConfidence = {
    overall: 1,
    entity: ctx.entities[0]?.confidence ?? (spec.playerId || spec.teamId ? 0.99 : 1),
    season: 1,
    gameType: 1,
    metric: 1,
  };
  const done = (status: AuditStatus, extra: Partial<AuditOutcome> = {}): AuditOutcome => {
    confidence.overall = Math.min(
      confidence.entity, confidence.season, confidence.gameType, confidence.metric,
    );
    return { status, spec, warnings, confidence, ...extra };
  };

  // ---- Contradictions: reject before any SQL exists ----
  if (spec.weekMin != null && spec.weekMax != null && spec.weekMin > spec.weekMax) {
    return done("invalid", {
      reason: `That week range is contradictory (from Week ${spec.weekMin} through Week ${spec.weekMax}).`,
    });
  }
  if ((spec.weekMin ?? 0) > 22 || (spec.weekMax ?? 1) < 1) {
    return done("invalid", { reason: "No NFL week matches that filter (weeks run 1-22 including playoffs)." });
  }
  if (spec.firstN && spec.lastN) {
    return done("invalid", {
      reason: "First-N and last-N game windows can't combine; pick one.",
    });
  }
  if (spec.threshold && spec.threshold.value < 0) {
    return done("invalid", { reason: "Stat thresholds can't be negative." });
  }

  // ---- Draft coverage ----
  if (spec.intent === "draft_pick") {
    const max = await draftMaxSeason();
    if (spec.season != null && spec.season < DRAFT_MIN_SEASON) {
      confidence.season = 0.9;
      return done("no_matching_data", {
        reason: `Draft history starts with the ${DRAFT_MIN_SEASON} draft; ${spec.season} is before coverage.`,
      });
    }
    if (spec.season != null && max != null && spec.season > max) {
      confidence.season = 0.9;
      return done("no_matching_data", {
        reason: `The ${spec.season} draft hasn't happened yet; drafts through ${max} are loaded.`,
      });
    }
    return done("validated");
  }

  // ---- Season coverage for stats and games ----
  if (spec.season != null) {
    if (spec.season < STATS_MIN_SEASON) {
      confidence.season = 0.9;
      const sbNote =
        spec.sbOnly || spec.round === "SB"
          ? ` That's ${sbName(STATS_MIN_SEASON)} (the ${STATS_MIN_SEASON} season) onward.`
          : "";
      return done("no_matching_data", {
        reason: `Warehouse coverage starts with the ${STATS_MIN_SEASON} season.${sbNote}`,
      });
    }
    if (ctx.latestSeason != null && spec.season > ctx.latestSeason) {
      confidence.season = 0.9;
      return done("no_matching_data", {
        reason:
          `The ${spec.season} season isn't in the warehouse yet; ` +
          `the newest loaded season is ${ctx.latestSeason}.`,
      });
    }
  }

  // ---- Super Bowl played-year normalization is worth saying out loud ----
  const yearBeforeSb = ctx.question
    .toLowerCase()
    .match(/\b((?:19|20)\d{2}) super ?bowl\b|\bsuper ?bowl (?:in |of )((?:19|20)\d{2})\b/);
  const playedYear = yearBeforeSb ? Number(yearBeforeSb[1] ?? yearBeforeSb[2]) : null;
  if (playedYear != null && spec.season === playedYear - 1) {
    warnings.push(
      `Read ${playedYear} as the calendar year of the game: ${sbName(spec.season)}, ` +
      `capping the ${spec.season} season.`,
    );
    confidence.season = 0.85;
  }

  // ---- Surname-only mentions: clarify or auto-disambiguate ----
  if (spec.playerId && spec.player && PLAYER_INTENTS.has(spec.intent)) {
    const qLower = ctx.question.toLowerCase();
    const parts = spec.player.toLowerCase().split(" ");
    const surname = parts.at(-1)!;
    const namedMoreThanSurname = parts
      .slice(0, -1)
      .some((tok) => tok.length >= 3 && qLower.includes(tok));
    if (!namedMoreThanSurname && parts.length > 1) {
      try {
        const cands = await surnameCandidates(surname);
        const posFilter = STAT_POSITIONS[spec.stat];
        const fits = posFilter
          ? cands.filter((c) => posFilter.has(c.position ?? ""))
          : cands;
        const pool = fits.length > 0 ? fits : cands;
        const [first, second] = pool;
        if (first && second && Number(second.prod) >= 0.25 * Number(first.prod)) {
          confidence.entity = 0.6;
          return done("needs_clarification", {
            reason: `Multiple players match "${surname}". Which one?`,
            options: pool.slice(0, 3).map((c) => ({
              player_id: c.player_id,
              full_name: c.full_name,
              position: c.position,
              last_season: c.last_season,
            })),
          });
        }
        if (first && first.player_id !== spec.playerId) {
          // The stat's position family points at a different owner of the
          // surname than raw prominence did — follow the stat.
          spec.playerId = first.player_id;
          spec.player = first.full_name;
          warnings.push(`Read "${surname}" as ${first.full_name}.`);
          confidence.entity = 0.85;
        }
      } catch {
        // Probes are best-effort; parsing already produced a sane spec.
      }
    }
  }

  // ---- The player must have been active in the requested season ----
  if (spec.playerId && spec.season != null && PLAYER_INTENTS.has(spec.intent)) {
    try {
      const rows = await q<{ ok: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM player_season_stats WHERE player_id = $1 AND season = $2) AS ok",
        [spec.playerId, spec.season],
      );
      if (!rows[0]?.ok) {
        confidence.season = 0.9;
        return done("no_matching_data", {
          reason: `${spec.player ?? "That player"} has no ${spec.season} games in the warehouse.`,
        });
      }
    } catch {
      // best-effort
    }
  }

  // ---- Never present an in-progress season as settled ----
  if (
    spec.season != null &&
    ctx.latestSeason != null &&
    spec.season === ctx.latestSeason &&
    !(await isSeasonComplete(spec.season))
  ) {
    warnings.push(`The ${spec.season} season is still in progress; this covers games loaded so far.`);
  }

  return done(warnings.length ? "validated_with_warnings" : "validated");
}

/** Best-effort structured audit record — decisions only, never reasoning. */
export function logAudit(entry: {
  question: string;
  spec: QuerySpec | null;
  status: string;
  warnings: string[];
  confidence: AuditConfidence | null;
  rowCount: number;
  durationMs: number;
}): void {
  void q(
    `INSERT INTO query_audit (question, spec, status, warnings, confidence, row_count, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.question,
      entry.spec ? JSON.stringify(entry.spec) : null,
      entry.status,
      JSON.stringify(entry.warnings),
      entry.confidence ? JSON.stringify(entry.confidence) : null,
      entry.rowCount,
      entry.durationMs,
    ],
  ).catch(() => {});
}
