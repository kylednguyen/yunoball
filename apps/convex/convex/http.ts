// HTTP endpoints served at https://<deployment>.convex.site
//
// Exactly one route today: the ingest finalize step posts the freshness
// summary here at the end of a clean nflverse run. Canonical doc:
// docs/CONVEX_INTEGRATION.md §4.1.
//
// Trust model, in full: one shared secret, one writer, one document. The route
// is machine-to-machine — there is no user on the other end — so it does not
// look at `ctx.auth`. See the TODO in the handler for where that changes.

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/** Header the ingest CLI presents. Paired with the YB_INGEST_SECRET env var. */
const SECRET_HEADER = "x-yb-ingest-secret";

type FreshnessPayload = {
  latestSeason: number;
  throughWeek: number;
  seasonsLoaded: number[];
  ingestedAt: number;
};

/**
 * httpAction has no args validator — the body is whatever the caller sent, so
 * it gets checked by hand before it reaches the (validated) internal mutation.
 */
function parseFreshness(body: unknown): FreshnessPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;

  const { latestSeason, throughWeek, ingestedAt, seasonsLoaded } = raw;
  if (typeof latestSeason !== "number" || !Number.isFinite(latestSeason)) return null;
  if (typeof throughWeek !== "number" || !Number.isFinite(throughWeek)) return null;
  if (typeof ingestedAt !== "number" || !Number.isFinite(ingestedAt)) return null;
  if (!Array.isArray(seasonsLoaded)) return null;

  const seasons: number[] = [];
  for (const season of seasonsLoaded) {
    if (typeof season !== "number" || !Number.isFinite(season)) return null;
    seasons.push(season);
  }

  return { latestSeason, throughWeek, seasonsLoaded: seasons, ingestedAt };
}

const ingestFreshness = httpAction(async (ctx, request) => {
  // TODO(P2, auth): this endpoint is deliberately identity-free — the caller is
  // the ingest job, not a person. If a route is ever added here that touches
  // user-space (savedQuestions / favorites / lineups), it must gate on
  // `await ctx.auth.getUserIdentity()` and derive `userId` from
  // `identity.subject`, exactly as savedQuestions.ts and favorites.ts do.
  // A shared secret authenticates a *machine*; it must never stand in for a
  // user. Identity config lands in convex/auth.config.ts (§3.3).

  const expected = process.env.YB_INGEST_SECRET;
  if (expected === undefined || expected === "") {
    // Unconfigured deployment: refuse rather than accept anything. Local and CI
    // ingests simply skip the finalize call, so they never reach this.
    return new Response("freshness ingest is not configured\n", { status: 503 });
  }

  // TODO: constant-time compare. A high-entropy shared secret over TLS makes a
  // timing attack impractical, but the fix is cheap once we settle on a helper.
  const presented = request.headers.get(SECRET_HEADER);
  if (presented !== expected) {
    return new Response("unauthorized\n", { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("body is not valid JSON\n", { status: 400 });
  }

  const payload = parseFreshness(body);
  if (payload === null) {
    return new Response(
      "expected { latestSeason: number, throughWeek: number, seasonsLoaded: number[], ingestedAt: number }\n",
      { status: 400 },
    );
  }

  await ctx.runMutation(internal.freshness.set, payload);
  return new Response(null, { status: 204 });
});

const http = httpRouter();

http.route({
  path: "/ingest/freshness",
  method: "POST",
  handler: ingestFreshness,
});

export default http;
