# YunoBall — Convex Integration (hybrid backend)

> Status: design · prep phase · Drafted 2026-07-30
> **Canonical doc for anything touching Convex.** Postgres, the engine, ingest
> and the wire contract stay canonical in [TDD.md](TDD.md) /
> [ARCHITECTURE.md](ARCHITECTURE.md) / [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md).
> Decision record: [PRD_MOBILE.md](PRD_MOBILE.md) §3 (backend platform), §2
> (native Swift client). Sequencing: [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md).

## 0. The shape

Two backends, one product, no overlap:

```
  iOS (SwiftUI)                    web (Next.js)
      │  │                             │  │
      │  └── URLSession ──┐   ┌── fetch ┘  └── (P3) convex/react
      │                   ▼   ▼                      │
      │        Express API /api/* (14 routes)        │
      │                   │                          │
      │            Postgres warehouse ◄── ingest ────┼── POST /freshness
      │                                              │   (shared secret)
      └── ConvexClient (convex-swift) ──► Convex ◄────┘
                    subscriptions          users · savedQuestions ·
                    + mutations            favorites · lineups ·
                                           freshness · (P4) liveGames
```

Postgres answers *what happened on the field*. Convex remembers *what this
user cares about* and *how fresh the field data is*. Neither reaches into the
other's tables.

## 1. The boundary

This is the load-bearing section. Everything else follows from it.

### 1.1 Postgres keeps — unchanged, forever

| Thing | Where |
|---|---|
| All 14 tables in `schema.sql` (12 warehouse + `answer_cache`, `query_audit`) | `apps/server/src/db/schema.sql` |
| The deterministic engine — 23 intents, 33 allowlisted stats, SQL-native executors | `apps/server/src/engine/` |
| nflverse ingest — 11 pipelines, idempotent upserts, failure isolation | `apps/server/src/ingest/` |
| All 14 REST routes under `/api` | `apps/server/src/routes/index.ts` |
| The stats wire contract | `packages/types/src/index.ts` |
| The two-tier answer cache + durable share store | `apps/server/src/lib/cache.ts` |

No file in that column changes because of Convex, with exactly one exception:
a finalize step at the end of the ingest run (§4.1).

### 1.2 Convex owns — net-new, user-space only

| Table | Purpose | Phase |
|---|---|---|
| *(auth identity)* | Users come from the auth provider's JWT subject, not a table we write (§3) | P2 |
| `savedQuestions` | A user's kept questions, by `shareId` | P2 |
| `favorites` | Players and teams a user follows | P2 |
| `lineups` | Fantasy lineup slots per season | P3 |
| `freshness` | Singleton: "data through Week N" | P1 |
| `liveGames` | In-progress scores, pushed | P4 (design only) |

Every one of these is a document nobody had a home for: mutable, small,
per-user, and wanted *pushed* rather than polled. None of them is a stat.

### 1.3 The split-brain rule

Two databases can disagree. This rule is how they can't:

1. **Postgres is authoritative for every number.** No stat, no rollup, no
   derived total is ever stored in Convex. Not cached there either — a Convex
   action that fetched `/api/search` and kept the rows would recreate the
   split brain through the back door, and is forbidden.
2. **Postgres is authoritative for "current season."** Note the server never
   trusts a calendar for this: `getGames()` takes `seasons[0]` from
   `SELECT DISTINCT season FROM games` (`services/games.ts:11-13`), so the
   current season is *whatever has been loaded*. `currentSeason()` exists in
   exactly one place — `ingest/cli.ts:36` — and only picks what to ingest.
   Convex's `freshness.latestSeason` is a **copy of that answer for display**,
   written by the ingest run that produced it. If it ever disagrees with the
   API, the API wins and the banner is stale, not wrong.
3. **Convex documents may reference `player_id` / `team_id` — as opaque
   strings.** `favorites.refId` holds `players.player_id`; `lineups.slots[]`
   holds the same. Convex never resolves them: the client hands each id to
   `GET /api/players/:playerId` or `GET /api/teams/:teamId` and renders what
   comes back. No name, position, team or headshot is denormalized into a
   Convex document — those change with every ingest and we would be shipping
   a second, rotting copy of the roster.
4. **Two contracts, never overlapping.** `packages/types` describes stats and
   nothing else; Convex's generated types describe user-space and nothing
   else. If a field would appear in both, it belongs in `packages/types`.
5. **The REST API stays anonymous.** Express verifies no tokens and gains no
   user concept. Personalization is composition on the client (§5).

### 1.4 Why Convex's limits never bite here

The 2026-07-30 platform audits killed a full pivot on Convex's per-transaction
ceilings — documents scanned per transaction and a ~1s user-code budget make
`RANK() OVER` league scans and 475k-row window queries structurally impossible
(PRD_MOBILE.md §3; `docs.convex.dev` is 403 through this sandbox's proxy, so
those figures are carried forward from the audit, not re-verified today).

Under §1.3 the ceilings are unreachable by construction. The largest query in
this design reads one document (`freshness`) or a user's own rows — tens, not
thousands. No aggregation, no scan, no join. The limits are a non-issue
*because* of the boundary, which is the whole argument for the boundary.

## 2. Schema

Lives at `apps/convex/convex/schema.ts`. Sketch — the scaffold is the
implementation, this is the contract it satisfies:

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  savedQuestions: defineTable({
    userId: v.string(),     // auth subject; server-derived, never client-sent
    question: v.string(),   // verbatim text the engine parsed
    shareId: v.optional(v.string()), // from lib/cache.ts shareId(); optional —
                                     // a persist failure can leave a question
                                     // with no share row (§4.2)
    createdAt: v.number(),  // epoch ms
  })
    .index("by_user", ["userId"])
    .index("by_user_share", ["userId", "shareId"]),

  favorites: defineTable({
    userId: v.string(),
    kind: v.union(v.literal("player"), v.literal("team")),
    refId: v.string(),      // players.player_id | teams.team_id — opaque
  })
    .index("by_user", ["userId"])
    .index("by_user_kind", ["userId", "kind"])
    .index("by_user_ref", ["userId", "kind", "refId"]),

  lineups: defineTable({
    userId: v.string(),
    season: v.number(),
    slots: v.any(),         // deliberately opaque — the slot vocabulary is a
                            // client concern; Convex validates the shape, not
                            // the football (see note below)
  }).index("by_user_season", ["userId", "season"]),

  freshness: defineTable({
    latestSeason: v.number(),
    throughWeek: v.number(),
    seasonsLoaded: v.array(v.number()),
    ingestedAt: v.number(),
  }),
});
```

Notes that matter:

- **`userId` is the auth subject** (`ctx.auth.getUserIdentity()?.subject`),
  resolved inside every mutation. A mutation that accepts `userId` as an
  argument is a data-leak bug; treat it as a review-blocking one.
- **`by_user_share` and `by_user_ref` are uniqueness enforcement**, not read
  paths: save-if-absent and unfavorite both look up the exact row first.
  Convex has no unique constraint — the index plus a `.unique()` read is it.
- **`freshness` is a singleton by discipline**: the writer does
  `ctx.db.query("freshness").unique()` and patches, or inserts if empty.
  `.unique()` throws on a second row, which is the alarm we want. No index —
  a one-document table has nothing to index.
- **`createdAt` duplicates Convex's built-in `_creationTime`.** Kept explicit
  because it is a sort key the client reads and it survives a re-import;
  drop it if the scaffold prefers `_creationTime` — but pick one.
- **`lineups.slots` is deliberately opaque.** Slot vocabulary is a client
  concern; Convex validates the shape, not the football.

## 3. Auth

Verified 2026-07-30. `github.com` and `raw.githubusercontent.com` fetch
cleanly through this sandbox's proxy; **`convex.dev` and `clerk.com` both
return 403**, so claims sourced only from those domains are labelled
unverified.

### 3.1 What exists

| Fact | Verified? |
|---|---|
| `get-convex/convex-swift` — official Swift client, wraps the Rust `convex-rs`; queries, mutations, actions; reactive `subscribe` | Yes — repo README |
| `Package.swift` declares `platforms: [.iOS(.v13), .macOS(.v10_15)]` | Yes — raw file |
| Its README mentions **no** auth provider; auth ships separately | Yes — repo README |
| `get-convex/convex-swift-auth0` — `ConvexClientWithAuth` + `Auth0Provider`, `login`/`logout`/`loginFromCache`, an `authState` publisher, Apache-2.0, ~11 commits, no stability claim | Yes — repo README |
| `clerk/clerk-convex-swift` (ClerkConvex) — bridges Clerk sessions into `ConvexClientWithAuth` via `ClerkConvexAuthProvider()`; SPM `from: "0.1.0"`, ~35 commits, ships an example app | Yes — repo README |
| Clerk announced Convex mobile integrations for Swift **and** Kotlin on 2026-02-20 | Partly — the changelog URL carries the date; page body is 403 |
| Clerk ships a native iOS SDK (`clerk/clerk-ios`) with native Sign in with Apple | Partly — repo exists; the SIWA doc is on clerk.com (403) |
| **Convex Auth is beta and supports React web + React Native — native Swift is not a supported client** | Unverified-but-consistent — docs.convex.dev is 403; taken from search summaries of `docs.convex.dev/auth/convex-auth`. Re-check before P2 |

### 3.2 App Store Guideline 4.8

Quoted verbatim from `developer.apple.com/app-store/review/guidelines/`
(fetched 2026-07-30):

> Apps that use a third-party or social login service (such as Facebook
> Login, Google Sign-In, Log in with X, Sign In with LinkedIn, Login with
> Amazon, or WeChat Login) to set up or authenticate the user's primary
> account with the app must also offer as an equivalent option another login
> service with the following features: the login service limits data
> collection to the user's name and email address; the login service allows
> users to keep their email address private as part of setting up their
> account; and the login service does not collect interactions with your app
> for advertising purposes without consent.

Exceptions include "Your app exclusively uses your company's own account
setup and sign-in systems."

Reading it for us: 4.8 triggers the moment we offer Google/Apple-adjacent
social sign-in. Sign in with Apple is the option that satisfies it. An
email-OTP-only build arguably falls under the own-systems exception, but
reviewers have historically been uneven on that line, and SIWA is one
capability toggle when the SDK supports it natively. **Ship Sign in with
Apple from the first build that has accounts at all**, and treat it as the
default button, not the fallback.

### 3.3 Recommendation — Clerk

| | Clerk | Convex Auth |
|---|---|---|
| Native Swift client | Yes — `clerk-ios` + `clerk-convex-swift` bridge | No supported Swift client (§3.1) |
| Convex wiring | First-party `ClerkConvexAuthProvider` | N/A on iOS — we'd write the provider and token refresh ourselves |
| Sign in with Apple | Native, documented | Supported as an OAuth provider, but only where the client is supported |
| Web later (P3) | Same identity via Clerk's React SDK | Its strongest surface — but we'd be on iOS first |
| Cost | Free MAU tier, then per-MAU (unverified — clerk.com 403) | Included in Convex |
| Risk | Second vendor, second bill; the bridge is pre-1.0 (`0.1.0`) | Beta, and we'd own an unsupported integration on the platform we ship first |

**Take Clerk.** The deciding fact is §3.1's last row: we are shipping iOS
first, and Convex Auth's supported-client list doesn't include it. Choosing
Convex Auth means writing and maintaining a Swift auth provider — custom
token-refresh code in the one subsystem where a bug logs everyone out or,
worse, doesn't. Clerk hands us a maintained bridge and native SIWA, which is
also our 4.8 answer.

Terms:

- **Pin exact versions.** Both `clerk-convex-swift` and `convex-swift-auth0`
  are pre-1.0; SPM `from:` on a 0.x is a minor-bump landmine.
- **Auth0 is the named fallback** — `convex-swift-auth0` is first-party and
  covers the same `ConvexClientWithAuth` seam, so a Clerk retreat is a
  provider swap, not a rewrite.
- Identity is configured in `convex/auth.config.ts` (issuer domain +
  application id). The JWT `subject` is our `userId` and nothing else is.
- **Accounts cost us the privacy label.** The repo has zero analytics,
  telemetry or crash reporting today, so an honest "Data Not Collected" App
  Privacy label is currently available (PRD_MOBILE.md §7). Accounts end that:
  P2 needs a privacy policy URL, an updated label, and in-app account
  deletion (Apple's account-deletion requirement under 5.1.1 — confirm the
  current wording before submission). Budget it as product work, not a
  checkbox.

## 4. Data flows

### 4.1 Freshness — the first real integration

Closes the indicator half of [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md)
Track B.3 and PRD_MOBILE.md §6.2 #10. (The other half — "default to the
in-progress season once Week 1 loads" — is already the server's behavior:
`services/games.ts:13` takes `seasons[0]` when no season is requested.)

```
pnpm ingest:nfl ──► 11 pipelines ──► Postgres
        └─ finalize ──► POST https://<deployment>.convex.site/ingest/freshness
                        header: x-yb-ingest-secret
                        body:   { latestSeason, throughWeek,
                                  seasonsLoaded, ingestedAt }
                                        │
                        httpAction ──► internalMutation ──► freshness doc
                                        │
                        every subscribed client updates. No poll.
```

**Where the finalize step goes.** `ingest/cli.ts` `main()` already ends with
a skipped-row summary and a `failures` check (`cli.ts:145-158`). The finalize
step slots in after that, and:

- runs **only when `failures.length === 0` and `!ctx.dryRun`** — a partial
  ingest must not advertise a week it didn't load;
- is **best-effort**, like `persistAnswer`: a Convex outage logs a warning and
  the run still exits 0. The warehouse is authoritative; the banner is not
  worth failing an ingest over;
- is **skipped when the secret env var is unset**, so local ingests and CI's
  real-nflverse e2e run untouched.

**Where the values come from** (Postgres, at finalize time):

| Field | Source |
|---|---|
| `latestSeason` | `SELECT MAX(season) FROM games` |
| `throughWeek` | `MAX(week)` over `games` for that season where `season_type='REG'` and `home_score IS NOT NULL` — scores are `NULL` until played (`schema.sql:46`) |
| `seasonsLoaded` | `loadedSeasons()` from `repositories/seasons.ts` |
| `ingestedAt` | run finish time, epoch ms |

**The alternative placement** — a `curl` step in
`.github/workflows/ingest.yml` after `pnpm ingest:nfl`, with the secret
alongside the existing `INGEST_DATABASE_URL` — is simpler but only covers the
scheduled path, and gates on the workflow's exit code rather than on
`failures`. Prefer the CLI step; keep this as the fallback if we don't want
the ingest process to make outbound calls.

**Guarding it.** The HTTP action compares a header against a deployment env
var (`YB_INGEST_SECRET`), rejects with 401 on mismatch, and delegates to an
`internalMutation` so the write path isn't publicly callable. That is the
entire trust model: one shared secret, one writer, one document.

**What clients do with it.** iOS renders "Data through Week N" and, on a
Sunday, the honest "this week's games aren't in yet" — PRD_MOBILE.md §9.9's
open question gets a mechanism, not an answer. Web adopts it at P3.

**What it does not fix.** Stale *answers* are a different bug:
`lib/cache.ts` is TTL-only at 24h (`config.answerCacheTtlSeconds`), so a
Week-N ingest can leave last week's number live for a day (PRD_MOBILE.md
§6.2 #11). Convex can't invalidate a cache it can't see. If we want that, the
same finalize step calls a server-side invalidation — a Postgres-side change,
tracked there, not here.

### 4.2 Saved questions and favorites

Written by the iOS app via `convex-swift` mutations, after auth. Reads are
subscriptions, so a save on one device appears on another without a refresh —
the actual reason this is Convex and not a table in Postgres.

- **Save** = `saveQuestion({ question, shareId })`. The client already holds
  `share_id` from the `AnswerResult`; `shareId()` is a deterministic hash of
  the normalized question (`lib/cache.ts:62`), so the same question saved
  twice collides on `by_user_share` and dedupes for free.
- **Render** = for each saved row, `GET /api/search/answer/:shareId`. The
  saved list is ids and text; the numbers come from the API, every time.
  A saved question whose share row was never persisted 404s — the known
  best-effort-persist gap (PRD_MOBILE.md §6.2 #14); the client falls back to
  re-asking `POST /api/search` with the stored text.
- **Favorite** = `toggleFavorite({ kind, refId })`, one document. Rendering a
  favorites list is N calls to `/api/players/:playerId` — which is unpaginated
  today (§6.2 #6), so favorites and that pagination fix are coupled work.
- **Web adopts later** via `convex/react` (P3), same documents, same identity.

### 4.3 Live games — designed, not built

Out of scope for prep and for P1–P3. In scope for the design so the boundary
holds when it lands:

- A Convex `cron` triggers an `action` that polls a score source; the action
  writes `liveGames` (game id, clock, quarter, score, status) through an
  internal mutation. Clients subscribe. Nothing polls the Express API.
- `liveGames` is **ephemeral display state, not a stat**. When nflverse
  publishes and ingest runs, `games` in Postgres becomes the record and the
  live document is deleted or ignored. Two representations of one game, with
  an explicit hand-off, is the only version of this that doesn't violate §1.3.
- **The source is the blocker, not the plumbing.** CLAUDE.md's data invariant
  is nflverse-only, and ENGINEERING_PLAN Track B.1 constrains us to
  license-safe sources. A live-score feed is a new source with new terms and
  needs that review before any code.

## 5. Client — two connections, one screen

The Swift app holds two independent connections and treats them as such:

| | Stats | User-space |
|---|---|---|
| Transport | `URLSession` + `Codable` over `/api/*` | `ConvexClient` (convex-swift) |
| Shape | Request/response, client-cached | Subscription (`AsyncSequence`) + mutations |
| Auth | None — API is anonymous (§1.3.5) | Clerk JWT via `ConvexClientWithAuth` |
| Freshness | Client TTL cache (~24h; data changes weekly) | Pushed |
| Failure | Blocks the answer | Must not block anything |

Composition happens in the view model: a favorites subscription yields
`refId`s, the stats client fetches each profile, the view renders the join.
Convex never sees a stat; `URLSession` never sees a token.

**Auth token flow.** Clerk's iOS SDK owns sign-in (SIWA first, §3.2) and
session storage; `ClerkConvexAuthProvider` syncs the session into
`ConvexClientWithAuth`, which attaches and refreshes the JWT on the Convex
websocket. Convex functions read `ctx.auth.getUserIdentity()`. The app stores
no token itself and passes none to the Express API.

**Degraded mode — the rule.** *If Convex is unreachable, the app still
answers questions.* Concretely:

1. The ask loop (`POST /api/search`), suggest, examples, profiles and share
   links have zero Convex dependency and are never gated on a Convex
   connection, a session, or a completed sign-in.
2. Signed-out is a first-class state, not an interstitial. Accounts unlock
   sync; they don't unlock the product.
3. The freshness banner **hides** when `freshness` is unavailable. It never
   renders a guess, and it never renders a stale value as current — same
   instinct as the engine's refusal.
4. Saved questions and favorites read from an on-device store; mutations
   queue and replay when the client reconnects. On-device history exists in
   v1 regardless (PRD_MOBILE.md §4.9), so the local store isn't new work.
5. The inverse is accepted and not mitigated: if the Express API is down,
   Convex alone renders nothing useful. There are no stats in Convex. That is
   the point.

## 6. Ops

**Layout.** `apps/convex/` with functions in `apps/convex/convex/`. It must
be added to `pnpm-workspace.yaml` (currently `apps/web`, `apps/server`,
`packages/types`) to be picked up by `turbo run typecheck`. No `knip.json`
change is needed: knip ships a built-in Convex plugin that treats
`convex/**` functions as entry points — verified, `pnpm knip` passes with
the config untouched.

**Dev/deploy.** `npx convex dev` provisions a dev deployment and hot-pushes
functions on save; `npx convex deploy` promotes to prod. There is no Docker
container, no migration step, and nothing to add to `docker-compose.yml`.
Schema changes are validated on push against existing documents.

**Env vars** (`.env.example` gets these; `.gitignore` already excludes
`.env*` except the template):

| Var | Lives | Notes |
|---|---|---|
| `CONVEX_DEPLOYMENT` | dev machine `.env.local`, written by the CLI | Never committed |
| `NEXT_PUBLIC_CONVEX_URL` | Vercel (P3) | Public by design, like `NEXT_PUBLIC_API_URL` |
| Convex deployment URL (iOS) | xcconfig per environment | Same rule as the API base URL — injected, never hardcoded |
| `YB_INGEST_SECRET` | Convex deployment env **and** GitHub Actions secrets, next to `INGEST_DATABASE_URL` | The only credential the ingest path gains |
| Clerk publishable key / secret (P2) | app bundle (publishable) / Convex + Clerk dashboard | Publishable key is not a secret; the API key is |

**CI.** `.github/workflows/ci.yml` is three ubuntu jobs and there is no Convex
account wired to it. Initially CI does **typecheck only** — no deploy, no
integration test against a real deployment. One gotcha to settle in the
scaffold: `convex/_generated/` is produced by the Convex CLI and typechecking
fails without it, so either commit `_generated/` (keeps CI account-free — the
recommended start) or add a `CONVEX_DEPLOY_KEY` secret and a codegen step
later. Settled empirically: `npx convex codegen` refuses to run with no
`CONVEX_DEPLOYMENT` configured, so `_generated/` is committed (produced from
the CLI's own templates) and will be regenerated on the first real
`convex dev`.

**Cost.** Hobby scale here is one singleton document written weekly, plus a
handful of documents per user. *Unverified — `convex.dev` is 403 through this
proxy; figures below come from third-party aggregators (2026) and must be
confirmed on the pricing page before P2:* free tier around 1M function calls
and ~0.5 GB database storage per month, ~1 GB egress. Our P1 load is
~52 writes a year and one subscription per active client. Clerk adds a second
free-tier-then-per-MAU bill at P2. Realistic expectation: $0 through P2, and
the first bill is Clerk's MAU tier, not Convex's.

**Exit hatch.** Convex's backend is open source (`get-convex/convex-backend`)
under an FSL/Apache-2.0 fair-source license — Apache-2.0 rights except
building a competing hosted product, converting to full Apache-2.0 two years
after each commit — and self-hosts via Docker with **Postgres** as a
persistence option alongside SQLite. So the worst case is not a rewrite: the
same functions run against a Postgres we already operate. (Verified via
search + the GitHub repo; `convex.dev`/`news.convex.dev` are 403 here.) The
smaller exit is smaller still — five document tables and no stats means a
hand-written migration to Postgres is a day, which is the real reason the
boundary is drawn where it is.

## 7. Phasing

| Phase | Ships | Needs decided | Needs bought |
|---|---|---|---|
| **P0 — prep** (this branch) | `apps/convex` scaffold + schema + this doc. Nothing deployed, nothing wired. | Nothing | Nothing |
| **P1 — freshness end-to-end** | Ingest finalize step → HTTP action → `freshness` singleton → iOS banner. Smallest real integration; **no auth required**. | CLI-step vs workflow-step (§4.1); commit `_generated/` or not; whether web reads it now or at P3 | Convex account (free tier) |
| **P2 — auth + saved questions/favorites** | Clerk sign-in with SIWA, `savedQuestions`, `favorites`, in the TestFlight beta. | Confirm §3.1's Convex-Auth row; account-deletion + privacy-policy copy; whether accounts are optional (they are — §5) | Apple Developer Program ($99/yr, already named in PRD_MOBILE §2); Clerk account; possibly Clerk paid MAU tier |
| **P3 — lineups + web adoption** | `lineups`; web gets `convex/react` and the same identity. | Whether lineups replace or complement the existing fantasy page; whether web takes a Convex runtime dep for one banner | Clerk web instance (same account) |
| **P4 — live games** | `liveGames` via Convex cron + action. | **The score source and its license** (§4.3) — the actual blocker; hand-off rules to ingest | Possibly a paid score feed; possibly a Convex paid plan |

P1 before P2 is deliberate: freshness proves the deployment, the secret, the
subscription and the client wiring with zero auth surface and zero user data.
If the hybrid is going to feel wrong, it feels wrong there, cheaply.

Against [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md): P1 is Track B.3 and
belongs to the pre-kickoff M3 launch bar. P2–P4 are post-kickoff and must not
compete with Track B/D for September weeks (PRD_MOBILE.md §11).

## 8. Non-goals

**The engine and the warehouse never move.** Not incrementally, not "just the
document-shaped tables." `answer_cache` and `query_audit` are document-shaped
and were named as such by the audits — they still stay in Postgres, because
`answer_cache` is written on the hot path by `persistAnswer()` and read by
`GET /api/search/answer/:shareId`, both inside the Express request cycle, and
moving them buys a network hop and a second failure mode for zero user value.

Also not happening:

- No stats in Convex — no caching, no mirroring, no "just the leaderboards."
- No SQL executed by Convex, and no Convex function that reads Postgres.
- No auth in Express. The 14 routes stay anonymous.
- No second wire contract for stats. `packages/types` remains the only one.
- No Convex in the web app before P3, and never as a hard dependency of the
  ask loop.

**Revisit conditions** — each specific enough to notice:

| If | Then reconsider |
|---|---|
| The API needs per-user behavior (per-account rate limiting instead of the CGNAT-fragile per-IP buckets — PRD_MOBILE §6.2 #3, private data, entitlements) | Express verifying Clerk/Convex JWTs. Cheap and additive; still not a pivot |
| Both accounts *and* sub-minute live features are live and Convex is carrying them well | Whether Supabase Auth/Realtime would have been simpler — the answer that was right in July 2026 may not survive contact with P4 |
| An engine query appears that SQL can't express | Nothing about this doc. That query has never existed |
| Postgres hosting cost or ops burden measurably exceeds Convex's | Measured, with numbers, not assumed |
