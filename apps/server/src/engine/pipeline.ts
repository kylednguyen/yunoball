/** The YunoBall query pipeline.
 *
 *   L1 cache (normalized text)
 *    → fuzzy entity resolve
 *    → parse to QuerySpec (deterministic rules)
 *    → L2 cache (spec key)
 *    → trusted SQL template (bound params)
 *    → execute (read-only role)
 *    → templated narration + table
 *    → write L1/L2 + durable shareable store
 *
 * Questions that don't parse to a spec get an honest "can't answer that yet"
 * rather than a guess.
 */

import type { AnswerResult, PlayerCard } from "@yunoball/types";
import { q } from "../db/pool.js";
import {
  cacheGet, cacheSet, persistAnswer, shareId, specKey, textKey,
} from "../lib/cache.js";
import { headshotUrl } from "../lib/espn.js";
import { logger } from "../lib/logger.js";
import { audit, logAudit } from "./audit.js";
import { narrate, buildSql } from "./build.js";
import { isRefusal, parseRules } from "./parseRules.js";
import { statComputableFor } from "./executors/shared.js";
import { loadIndex, loadTeamIndex, resolveEntities } from "./resolve.js";
import { fields, specCacheKey, STATS } from "./spec.js";

function metricCategory(
  metric: string,
  intent: string,
): NonNullable<AnswerResult["query_context"]>["category"] {
  if (intent.startsWith("team_")) return "team";
  if (intent === "game_result" || intent === "single_game") return "game";
  if (/^(passing_|passer_|completion_|cpoe|interceptions$|sacks_taken$|pass_)/.test(metric)) {
    return "passing";
  }
  if (/^(rushing_|rush_)/.test(metric)) return "rushing";
  if (/^(receiving_|receptions$|recv_)/.test(metric)) return "receiving";
  if (/^(tackles$|def_|forced_fumbles$|passes_defended$)/.test(metric)) return "defense";
  if (/(kick|field_goal|extra_point|punt)/.test(metric)) return "kicking";
  if (metric.includes("fantasy")) return "fantasy";
  return "other";
}

async function finalize(response: AnswerResult, sKey: string | null): Promise<AnswerResult> {
  // Full result (sql/audit included) is kept server-side for the cache, the
  // durable share store, and internal tools (e.g. the searchAudit CLI, which
  // calls this pipeline directly). Internals are stripped at the HTTP boundary
  // instead — see redactAnswer() in the controllers — so nothing crosses the
  // wire while server-internal callers still see everything.
  cacheSet(textKey(response.question), response);
  if (sKey !== null) cacheSet(sKey, response);
  // The result route opens immediately after this response. Await the
  // best-effort durable write so /a/<share_id> cannot race its own lookup.
  await persistAnswer(response);
  return response;
}

// Newest loaded season — resolves "this season" phrasings. Refreshed lazily
// so a long-lived process picks up a new season's ingest within minutes.
let latestSeason: { value: number | null; at: number } | null = null;
const LATEST_TTL_MS = 10 * 60 * 1000;

/** Identity card for the player an answer is about: the resolved player when
 * the question named one, otherwise the top result row's player. */
async function playerCard(playerId: string | null | undefined): Promise<PlayerCard | null> {
  if (!playerId) return null;
  try {
    const rows = await q<{
      player_id: string; full_name: string; position: string | null;
      team: string | null; team_name: string | null;
    }>(
      `SELECT p.player_id, p.full_name, p.position, latest.team_id AS team, t.name AS team_name
       FROM players p
       LEFT JOIN LATERAL (
         SELECT team_id FROM player_season_stats s
         WHERE s.player_id = p.player_id AND s.team_id IS NOT NULL
         ORDER BY s.season DESC LIMIT 1
       ) latest ON true
       LEFT JOIN teams t ON t.team_id = latest.team_id
       WHERE p.player_id = $1`,
      [playerId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      player_id: r.player_id,
      name: r.full_name,
      position: r.position,
      team: r.team,
      team_name: r.team_name,
      headshot_url: headshotUrl(r.player_id),
    };
  } catch {
    return null; // enrichment is best-effort, never blocks an answer
  }
}

async function getLatestSeason(): Promise<number | null> {
  if (latestSeason && Date.now() - latestSeason.at < LATEST_TTL_MS) {
    return latestSeason.value;
  }
  try {
    const rows = await q<{ latest: number | null }>("SELECT MAX(season) AS latest FROM seasons");
    latestSeason = { value: rows[0]?.latest ?? null, at: Date.now() };
  } catch {
    latestSeason = { value: null, at: Date.now() };
  }
  return latestSeason.value;
}

export async function runQueryPipeline(
  question: string,
  { useCache = true }: { useCache?: boolean } = {},
): Promise<AnswerResult> {
  const startedAt = Date.now();
  // --- L1: front-loaded cache (exact text) ---
  if (useCache) {
    const hit = cacheGet(textKey(question));
    if (hit) return { ...hit, cached: true };
  }

  // --- Entity resolution + parse to a structured spec ---
  const entities = await resolveEntities(question);
  const index = await loadIndex();
  const parsed = parseRules(question, entities, index, {
    latestSeason: await getLatestSeason(),
    teams: await loadTeamIndex(),
  });

  // Tailored honesty: vocabulary we recognize but can't answer yet.
  if (isRefusal(parsed)) {
    logAudit({
      question, spec: null, status: "unsupported", warnings: [],
      confidence: null, rowCount: 0, durationMs: Date.now() - startedAt,
    });
    return finalize({
      question,
      narration: parsed.refusal,
      sql: "",
      rows: [],
      columns: [],
      entities,
      cached: false,
      share_id: shareId(question),
    }, null);
  }
  const spec = parsed;

  if (spec !== null) {
    // Attach the resolved canonical id if the parser didn't already.
    if (spec.intent === "player_total" && !spec.playerId && entities.length > 0) {
      spec.playerId = entities[0]!.canonical_id;
      spec.player = spec.player ?? entities[0]!.display_name;
    }

    // --- Capability gate: refuse a stat the intent's executor can't compute
    // from its storage grain, rather than emit SQL that fails to plan. ---
    if ("stat" in spec && !statComputableFor(spec.intent, spec.stat)) {
      const label = STATS[spec.stat]?.label ?? spec.stat;
      logAudit({
        question, spec, status: "unsupported", warnings: [],
        confidence: null, rowCount: 0, durationMs: Date.now() - startedAt,
      });
      return finalize({
        question,
        narration:
          `I can't compute ${label} for that kind of question yet — try it as a ` +
          `season leaderboard or a player total.`,
        sql: "", rows: [], columns: [], entities, cached: false,
        share_id: shareId(question),
      }, null);
    }

    // --- Second-layer audit: validate against warehouse reality before SQL ---
    const verdict = await audit(spec, {
      question, entities, latestSeason: await getLatestSeason(),
    });
    if (verdict.status !== "validated" && verdict.status !== "validated_with_warnings") {
      const rows = verdict.options ?? [];
      logAudit({
        question, spec, status: verdict.status, warnings: verdict.warnings,
        confidence: verdict.confidence, rowCount: rows.length,
        durationMs: Date.now() - startedAt,
      });
      return finalize({
        question,
        narration: verdict.reason ?? "That query didn't pass validation.",
        sql: "",
        rows,
        columns: rows.length > 0 ? Object.keys(rows[0]!) : [],
        entities,
        cached: false,
        share_id: shareId(question),
        audit: {
          status: verdict.status,
          warnings: verdict.warnings,
          confidence: verdict.confidence.overall,
        },
      }, null);
    }

    // --- L2: spec-keyed cache (dedupes phrasings that map to one spec) ---
    const sKey = specKey(specCacheKey(spec));
    if (useCache) {
      const hit = cacheGet(sKey);
      if (hit) {
        cacheSet(textKey(question), hit);
        return { ...hit, cached: true };
      }
    }

    const { sql, params } = buildSql(spec);
    let rows: Record<string, unknown>[];
    let narration: string;
    try {
      rows = await q(sql, params);
      narration = narrate(spec, rows);
    } catch (err) {
      logger.error({ err, question, sql, params, intent: spec.intent }, "query execution failed");
      throw err;
    }
    if (verdict.warnings.length) {
      narration += ` Note: ${verdict.warnings.join(" ")}`;
    }
    const answerValue = rows[0]?.total ?? rows[0]?.value ?? rows[0]?.cmp_value ?? null;
    // Window totals fed the narration; per-row they are just repetition.
    // Compare keeps `games` — the head-to-head chart shows it and the
    // per-game toggle divides by it.
    for (const row of rows) {
      delete (row as Record<string, unknown>).total;
      // Ratio-window helper columns (see playerGameRowsSql) are internal.
      delete (row as Record<string, unknown>)._num;
      delete (row as Record<string, unknown>)._den;
      if (spec.intent !== "compare") delete (row as Record<string, unknown>).games;
    }
    const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
    const response: AnswerResult = {
      question,
      narration,
      sql,
      rows,
      columns,
      entities,
      cached: false,
      share_id: shareId(question),
      intent: spec.intent,
      answer_value:
        typeof answerValue === "number" || typeof answerValue === "string"
          ? answerValue
          : null,
      player_card: await playerCard(
        fields(spec).playerId ?? (rows[0]?.player_id as string | undefined),
      ),
      player_card2: spec.intent === "compare" ? await playerCard(spec.player2Id) : null,
      audit: {
        status: verdict.status,
        warnings: verdict.warnings,
        confidence: verdict.confidence.overall,
      },
      query_context: {
        metric: spec.stat,
        metric_label: STATS[spec.stat]?.label ?? spec.stat.replace(/_/g, " "),
        category: metricCategory(spec.stat, spec.intent),
        season: spec.season ?? null,
        season_type: spec.seasonType,
        scope: spec.intent === "compare" && spec.season == null ? "career" : spec.scope,
        per_game: "perGame" in spec && Boolean(spec.perGame),
      },
    };
    logAudit({
      question, spec, status: verdict.status, warnings: verdict.warnings,
      confidence: verdict.confidence, rowCount: rows.length,
      durationMs: Date.now() - startedAt,
    });
    return finalize(response, sKey);
  }

  logAudit({
    question, spec: null, status: "invalid", warnings: [],
    confidence: null, rowCount: 0, durationMs: Date.now() - startedAt,
  });

  // --- Nothing parsed to a spec: the rule-based engine only answers
  // structured shapes; be honest rather than guess. ---
  return finalize({
    question,
    narration:
      "I can't answer that one yet. Try a stats question like " +
      '"most passing yards in 2025" or "Patrick Mahomes career ' +
      'passing touchdowns".',
    sql: "",
    rows: [],
    columns: [],
    entities,
    cached: false,
    share_id: shareId(question),
  }, null);
}
