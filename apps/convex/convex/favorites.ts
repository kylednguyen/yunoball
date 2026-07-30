// Players and teams a user follows. Canonical doc: docs/CONVEX_INTEGRATION.md §4.2.
//
// `refId` is `players.player_id` or `teams.team_id` and is opaque here — Convex
// never resolves it. The client hands each id to `GET /api/players/:playerId`
// or `GET /api/teams/:teamId` and renders what comes back. No name, position,
// team or headshot is denormalized into these documents: those change with
// every ingest, and a copy here would rot (§1.3).
//
// As in savedQuestions.ts, `userId` comes from the auth subject and is never an
// argument.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** player | team — mirrors the two profile endpoints the client can resolve. */
const favoriteKind = v.union(v.literal("player"), v.literal("team"));

/**
 * The user's favorites, optionally narrowed to one kind (the players tab and
 * the teams tab each want only their half).
 *
 * Signed out returns `[]` — see the note in savedQuestions.ts.
 */
export const list = query({
  args: { kind: v.optional(favoriteKind) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return [];
    const userId = identity.subject;

    const kind = args.kind;
    if (kind !== undefined) {
      return await ctx.db
        .query("favorites")
        .withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", kind))
        .collect();
    }

    return await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Follow a player or team. Idempotent — favoriting twice is a no-op that
 * returns the existing document id, so a double-tap can't create a duplicate.
 */
export const save = mutation({
  args: { kind: favoriteKind, refId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new Error("Not authenticated");
    const userId = identity.subject;

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_ref", (q) =>
        q.eq("userId", userId).eq("kind", args.kind).eq("refId", args.refId),
      )
      .unique();
    if (existing !== null) return existing._id;

    return await ctx.db.insert("favorites", {
      userId,
      kind: args.kind,
      refId: args.refId,
    });
  },
});

/**
 * Unfollow. Addressed by (kind, refId) rather than by document id, because the
 * caller is a star button that knows what it is looking at, not a list row.
 * Removing something not favorited is a no-op.
 */
export const remove = mutation({
  args: { kind: favoriteKind, refId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_ref", (q) =>
        q.eq("userId", identity.subject).eq("kind", args.kind).eq("refId", args.refId),
      )
      .unique();
    if (existing === null) return;

    await ctx.db.delete(existing._id);
  },
});
