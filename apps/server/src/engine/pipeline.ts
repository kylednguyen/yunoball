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
import { audit, logAudit } from "./audit.js";
import { narrate, buildSql } from "./build.js";
import { isRefusal, parseRules } from "./parseRules.js";
import { loadIndex, loadTeamIndex, resolveEntities } from "./resolve.js";
import { specCacheKey } from "./spec.js";

async function finalize(response: AnswerResult, sKey: string | null): Promise<AnswerResult> {
  cacheSet(textKey(response.question), response);
  if (sKey !== null) cacheSet(sKey, response);
  void persistAnswer(response); // best-effort, off the response path
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
    return {
      question,
      narration: parsed.refusal,
      sql: "",
      rows: [],
      columns: [],
      entities,
      cached: false,
      share_id: shareId(question),
    };
  }
  const spec = parsed;

  if (spec !== null) {
    // Attach the resolved canonical id if the parser didn't already.
    if (spec.intent === "player_total" && !spec.playerId && entities.length > 0) {
      spec.playerId = entities[0]!.canonical_id;
      spec.player = spec.player ?? entities[0]!.display_name;
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
      return {
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
      };
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
    const rows = await q(sql, params);
    let narration = narrate(spec, rows);
    if (verdict.warnings.length) {
      narration += ` Note: ${verdict.warnings.join(" ")}`;
    }
    // Window totals fed the narration; per-row they are just repetition.
    for (const row of rows) {
      delete (row as Record<string, unknown>).total;
      delete (row as Record<string, unknown>).games;
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
      player_card: await playerCard(
        spec.playerId ?? (rows[0]?.player_id as string | undefined),
      ),
      player_card2: spec.intent === "compare" ? await playerCard(spec.player2Id) : null,
      audit: {
        status: verdict.status,
        warnings: verdict.warnings,
        confidence: verdict.confidence.overall,
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
  return {
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
  };
}
