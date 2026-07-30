// "Data through Week N" — the one number Convex is allowed to remember, and
// only as a copy for display. Canonical doc: docs/CONVEX_INTEGRATION.md §4.1.
//
// Written once per successful ingest run (see http.ts), read as a live
// subscription by every client. Postgres remains authoritative: if this
// document disagrees with the API, the banner is stale, not the API wrong.

import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * Public read. Returns `null` before the first ingest has reported in — the
 * client hides the freshness banner rather than guessing (§5, degraded mode).
 *
 * Unauthenticated on purpose: freshness is a property of the warehouse, not of
 * a user, and the app must render it while signed out.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("freshness").unique();
  },
});

/**
 * Internal — not publicly callable. The only writer is the ingest finalize
 * step, which reaches it through the shared-secret HTTP action in http.ts.
 *
 * `.unique()` throws if a second document ever appears, which is the alarm we
 * want for a table that is a singleton by discipline rather than by constraint.
 */
export const set = internalMutation({
  args: {
    latestSeason: v.number(),
    throughWeek: v.number(),
    seasonsLoaded: v.array(v.number()),
    ingestedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("freshness").unique();
    if (existing === null) {
      await ctx.db.insert("freshness", args);
      return;
    }
    await ctx.db.patch(existing._id, args);
  },
});
