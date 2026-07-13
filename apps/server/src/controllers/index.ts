/** Controllers: validate request inputs (zod), call the service, shape errors.
 * No business logic here — that lives in services/. */

import type { Request, Response } from "express";
import { z } from "zod";
import { runQueryPipeline } from "../engine/pipeline.js";
import { ApiError } from "../lib/errors.js";
import { clientIp, retryAfter } from "../lib/rateLimit.js";
import { getAnswerByShareId } from "../lib/cache.js";
import { runAgent } from "../services/agent.js";
import { getFantasyPlayers } from "../services/fantasy.js";
import { getBoxScore, getGames, getPerformers } from "../services/games.js";
import { getLeaderboards } from "../services/leaderboards.js";
import { getPlayerProfile, getPlayerSplits } from "../services/players.js";
import { examples, suggest } from "../services/search.js";
import { getStandings } from "../services/standings.js";
import { getTeamProfile } from "../services/teams.js";

const intParam = (min: number, max?: number) => {
  let s = z.coerce.number().int().min(min);
  if (max !== undefined) s = s.max(max);
  return s.optional();
};

const idParam = z.string().min(1).max(64);

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const res = schema.safeParse(value);
  if (!res.success) {
    throw new ApiError(422, res.error.issues.map((i) => i.message).join("; "));
  }
  return res.data;
}

function limited(req: Request): void {
  const wait = retryAfter(clientIp(req));
  if (wait !== null) {
    throw new ApiError(429, "Too many requests. Please slow down.", {
      "Retry-After": String(wait),
    });
  }
}

// ---- search ----

const searchBody = z.object({
  question: z.string().min(2).max(500),
});

export async function search(req: Request, res: Response): Promise<void> {
  limited(req);
  const body = parse(searchBody, req.body);
  res.json(await runQueryPipeline(body.question));
}

const suggestQuery = z.object({
  q: z.string().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});

export async function searchSuggest(req: Request, res: Response): Promise<void> {
  const { q, limit } = parse(suggestQuery, req.query);
  res.json(await suggest(q, limit));
}

export async function searchExamples(req: Request, res: Response): Promise<void> {
  const n = parse(z.coerce.number().int().min(1).max(12).default(4), req.query.n);
  res.json({ examples: await examples(n) });
}

export async function sharedAnswer(req: Request, res: Response): Promise<void> {
  const payload = await getAnswerByShareId(String(req.params.shareId));
  if (payload === null) throw new ApiError(404, "Answer not found.");
  res.json({ ...payload, cached: true });
}

// ---- platform ----

export async function leaderboards(req: Request, res: Response): Promise<void> {
  const query = parse(
    z.object({
      season: intParam(1),
      category: z.string().optional(),
      team: z.string().optional(),
      position: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    }),
    req.query,
  );
  res.json(await getLeaderboards(query));
}

export async function games(req: Request, res: Response): Promise<void> {
  const query = parse(
    z.object({ season: intParam(1), week: intParam(1, 22) }),
    req.query,
  );
  res.json(await getGames(query.season, query.week));
}

export async function performers(req: Request, res: Response): Promise<void> {
  const query = parse(
    z.object({
      season: intParam(1),
      week: intParam(1, 22),
      limit: z.coerce.number().int().min(1).max(25).default(10),
    }),
    req.query,
  );
  res.json(await getPerformers(query.season, query.week, query.limit));
}

export async function boxScore(req: Request, res: Response): Promise<void> {
  res.json(await getBoxScore(parse(idParam, req.params.gameId)));
}

export async function standings(req: Request, res: Response): Promise<void> {
  const query = parse(z.object({ season: intParam(1) }), req.query);
  res.json(await getStandings(query.season));
}

export async function fantasyPlayers(req: Request, res: Response): Promise<void> {
  const query = parse(
    z.object({
      season: intParam(1),
      position: z.string().optional(),
      q: z.string().max(60).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
    req.query,
  );
  res.json(await getFantasyPlayers(query));
}

export async function playerProfile(req: Request, res: Response): Promise<void> {
  res.json(await getPlayerProfile(parse(idParam, req.params.playerId)));
}

export async function playerSplits(req: Request, res: Response): Promise<void> {
  const query = parse(z.object({ season: intParam(1) }), req.query);
  res.json(await getPlayerSplits(parse(idParam, req.params.playerId), query.season));
}

export async function teamProfile(req: Request, res: Response): Promise<void> {
  const query = parse(z.object({ season: intParam(1) }), req.query);
  res.json(await getTeamProfile(parse(idParam, req.params.teamId), query.season));
}

// ---- agent ----

const agentBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) }))
    .min(1)
    .max(20),
});

export async function agent(req: Request, res: Response): Promise<void> {
  limited(req);
  const body = parse(agentBody, req.body);
  const { reply, steps } = await runAgent(body.messages);
  res.json({ reply, steps, mode: "demo" });
}
