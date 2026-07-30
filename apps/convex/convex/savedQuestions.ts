// Questions a user chose to keep. Canonical doc: docs/CONVEX_INTEGRATION.md §4.2.
//
// We store the text and the share id. We never store the answer — rendering a
// saved row is `GET /api/search/answer/:shareId` against Postgres, every time,
// so a saved question can never show a number the warehouse disagrees with.
//
// `userId` is derived from the auth subject inside every function and is never
// an argument. A function here that accepted `userId` from the client would be
// a data-leak bug (§2); treat it as review-blocking.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * The user's saved questions, newest first.
 *
 * Signed out returns `[]` rather than throwing: signed-out is a first-class
 * state in this app (§5), and a "saved" tab that errors instead of rendering
 * empty would be a worse lie than an empty list.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return [];

    // Index order within a single user is `_creationTime`, which is set in the
    // same transaction as `createdAt` — so desc here is newest-first.
    return await ctx.db
      .query("savedQuestions")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .collect();
  },
});

/**
 * Save a question. Idempotent when the client has a `shareId`:
 * `shareId()` is a deterministic hash of the normalized question
 * (apps/server/src/lib/cache.ts), so saving the same question twice collides on
 * `by_user_share` and dedupes for free.
 *
 * Mutations throw when signed out — a silent no-op would leave the client
 * showing a save that did not happen.
 */
export const save = mutation({
  args: {
    question: v.string(),
    shareId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new Error("Not authenticated");
    const userId = identity.subject;

    const shareId = args.shareId;
    if (shareId !== undefined) {
      const existing = await ctx.db
        .query("savedQuestions")
        .withIndex("by_user_share", (q) =>
          q.eq("userId", userId).eq("shareId", shareId),
        )
        .unique();
      if (existing !== null) return existing._id;
    }

    return await ctx.db.insert("savedQuestions", {
      userId,
      question: args.question,
      shareId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Delete one saved question. Ownership is re-checked against the auth subject —
 * holding a document id is not authorization to delete it.
 */
export const remove = mutation({
  args: { id: v.id("savedQuestions") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new Error("Not authenticated");

    const doc = await ctx.db.get(args.id);
    // Same response for "gone" and "someone else's": a delete that reports
    // whether a stranger's id exists is an enumeration oracle.
    if (doc === null || doc.userId !== identity.subject) return;

    await ctx.db.delete(args.id);
  },
});
