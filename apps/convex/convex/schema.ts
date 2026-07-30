// YunoBall user-space schema. Canonical doc: docs/CONVEX_INTEGRATION.md §2.
//
// The boundary rule (§1.3) in one line: **no stat ever lives here.** Postgres
// is authoritative for every number; these tables hold what a *user* wants
// remembered, plus one display-only copy of "how fresh is the warehouse".
// Player and team ids are stored as opaque strings and resolved by the client
// against `/api/players/:playerId` / `/api/teams/:teamId` — never denormalized
// into a Convex document, because rosters change on every ingest.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // A question the user chose to keep. `question` is the verbatim text the
  // engine parsed; `shareId` is the deterministic hash the API already handed
  // back on the answer (apps/server/src/lib/cache.ts). Rendering a saved row
  // means re-fetching the numbers — the text and the id are all we store.
  savedQuestions: defineTable({
    // Auth subject from ctx.auth.getUserIdentity(). Never a mutation argument.
    userId: v.string(),
    question: v.string(),
    // Optional: an answer whose share row was never persisted has no id, and
    // the client falls back to re-asking POST /api/search with `question`.
    shareId: v.optional(v.string()),
    // Epoch ms. Kept explicit rather than leaning on `_creationTime` because
    // it is a sort key the client reads and it survives a re-import.
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    // Uniqueness enforcement, not a read path: save-if-absent looks the exact
    // row up first. Convex has no unique constraint; index + .unique() is it.
    .index("by_user_share", ["userId", "shareId"]),

  // Players and teams the user follows. One document per follow.
  favorites: defineTable({
    userId: v.string(),
    kind: v.union(v.literal("player"), v.literal("team")),
    // players.player_id | teams.team_id — opaque here, resolved via the API.
    refId: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_kind", ["userId", "kind"])
    // Uniqueness enforcement for add/remove; see the note above.
    .index("by_user_ref", ["userId", "kind", "refId"]),

  // Fantasy lineups (P3 — schema only, no functions in this scaffold).
  lineups: defineTable({
    userId: v.string(),
    season: v.number(),
    // Deliberately opaque: slot vocabulary (QB / RB1 / FLEX / …) is a client
    // concern. Convex validates that the field exists, not the football. The
    // shape gets pinned in P3 when the client vocabulary is settled.
    slots: v.any(),
  }).index("by_user_season", ["userId", "season"]),

  // Singleton by discipline — the writer uses .unique(), which throws on a
  // second row, which is exactly the alarm we want. A one-document table has
  // nothing to index. Values are a *copy* of what Postgres reported at the end
  // of an ingest run; if it ever disagrees with the API, the API wins.
  freshness: defineTable({
    latestSeason: v.number(),
    throughWeek: v.number(),
    seasonsLoaded: v.array(v.number()),
    ingestedAt: v.number(), // epoch ms, ingest run finish time
  }),
});
