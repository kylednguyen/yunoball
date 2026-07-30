# @yunoball/convex

> ## ⚠️ Not deployed yet — scaffold only
>
> **No Convex deployment exists.** Nothing in this package runs anywhere: no
> project has been provisioned, no account is wired to CI, no client talks to
> it, and `apps/server` does not call it. It is committed so the schema and the
> function boundaries can be **reviewed** before anyone buys into the platform.
>
> The gates (`pnpm typecheck` · `pnpm lint` · `pnpm knip`) cover this package
> today; `convex/_generated/` is committed precisely so they can, with no Convex
> account (see [Generated code](#generated-code)).

Convex owns **user-space only**: saved questions, favorites, lineups, and one
freshness document. Postgres keeps the warehouse, the deterministic engine, the
nflverse ingest, and all 14 REST routes. Neither reaches into the other's
tables.

**Canonical doc: [`docs/CONVEX_INTEGRATION.md`](../../docs/CONVEX_INTEGRATION.md).**
It carries the boundary rule, the auth decision, the phasing and the non-goals.
This file is the operator's manual for the directory — if the two disagree, the
doc wins and this file is the bug.

The one rule worth repeating here: **no stat ever lives in Convex.** Not stored,
not cached, not mirrored. Every number comes from `/api/*` against Postgres, so
the two databases cannot disagree about a number — only one of them has any.

## Layout

```
apps/convex/
  convex.json            deployment config (functions dir, TS codegen)
  tsconfig.json          what `pnpm typecheck` runs
  convex/
    schema.ts            savedQuestions · favorites · lineups · freshness
    freshness.ts         public query `get`, internalMutation `set`
    http.ts              POST /ingest/freshness (shared-secret, machine-to-machine)
    savedQuestions.ts    list · save · remove   (auth-gated)
    favorites.ts         list · save · remove   (auth-gated)
    crons.ts             empty — reserves the P4 live-games poller
    _generated/          committed CLI output; do not hand-edit
```

`lineups` is in the schema with **no functions** — it is phase P3, and an empty
table is cheaper to review now than a migration later.

## Initializing (first time, needs a Convex account)

```bash
pnpm install
cd apps/convex && npx convex dev --once
```

`convex dev` does three things: configures a project (prompting for login on
first run), regenerates `convex/_generated/`, and pushes the functions to a dev
deployment. `--once` stops there instead of watching for changes. Drop `--once`
while actually working on functions — it hot-pushes on save.

It writes `apps/convex/.env.local` with `CONVEX_DEPLOYMENT`. That file is
already ignored by the repo's `.gitignore` (`.env.*`) and must stay ignored.

Two things to expect on that first run, neither of them a problem:

- **`convex/tsconfig.json` appears.** The CLI drops its own config into the
  functions directory. The gate does not read it — `pnpm typecheck` uses
  `apps/convex/tsconfig.json`, which already carries the compiler options Convex
  requires. Keep it or delete it.
- **`_generated/server.ts` loses its `env` export.** A real push knows the
  deployment's declared env vars and omits the untyped fallback that offline
  codegen emits. Commit the diff; nothing imports `env` (see below).

`npx convex deploy` promotes to production. There is no Docker container, no
migration step, and nothing to add to `docker-compose.yml`. Schema changes are
validated on push against existing documents.

## Environment variables

| Var | Set where | Used by |
|---|---|---|
| `CONVEX_DEPLOYMENT` | `apps/convex/.env.local`, written by the CLI | the CLI. Never committed |
| `YB_INGEST_SECRET` | Convex **deployment** env (`npx convex env set`) **and** wherever the ingest runs — GitHub Actions secrets, next to `INGEST_DATABASE_URL` | `convex/http.ts` |
| Deployment URL (iOS) | xcconfig per environment | the Swift client |
| `NEXT_PUBLIC_CONVEX_URL` | Vercel — **P3 only**, web does not use Convex yet | `convex/react` |

`YB_INGEST_SECRET` is the only credential the ingest path gains. When it is
unset on the deployment, `POST /ingest/freshness` answers **503** rather than
accepting anything — an unconfigured deployment refuses writes instead of
trusting them.

> Naming settled 2026-07-30: the var is `YB_INGEST_SECRET` and the route is
> `/ingest/freshness`, in both this scaffold and `docs/CONVEX_INTEGRATION.md`.

## How ingest will call the HTTP action

Not wired yet. The shape it will take
([`docs/CONVEX_INTEGRATION.md`](../../docs/CONVEX_INTEGRATION.md) §4.1):

```
POST https://<deployment>.convex.site/ingest/freshness
  x-yb-ingest-secret: $YB_INGEST_SECRET
  content-type: application/json

  { "latestSeason": 2025, "throughWeek": 9,
    "seasonsLoaded": [1999, ..., 2025], "ingestedAt": 1769800000000 }

  -> 204  written
     400  malformed body
     401  bad or missing secret
     503  YB_INGEST_SECRET unset on the deployment
```

The call belongs at the end of `main()` in
`apps/server/src/ingest/cli.ts`, immediately before `logger.info("ingest
complete")`, and under three conditions:

1. **only when `failures.length === 0` and `!ctx.dryRun`** — a partial ingest
   must not advertise a week it did not load;
2. **best-effort**, like `persistAnswer` — a Convex outage logs a warning and
   the run still exits 0. The warehouse is authoritative; a banner is not worth
   failing an ingest over;
3. **skipped when the secret is unset**, so local ingests and CI's real-nflverse
   e2e run untouched.

The action verifies the secret, re-validates the body by hand (an `httpAction`
has no args validator), and delegates to the `internalMutation` — so the write
path is not publicly callable. That is the whole trust model: one shared secret,
one writer, one document.

## How the Swift app connects

Native SwiftUI, iOS-first. Convex ships an official Swift client —
[`get-convex/convex-swift`](https://github.com/get-convex/convex-swift), which
wraps the Rust `convex-rs`. Verified from the repo on 2026-07-30: SPM package
and library are both named **`ConvexMobile`**, `platforms: [.iOS(.v13),
.macOS(.v10_15)]`.

Add it in Xcode as a package dependency on the repo URL, **pinned to an exact
version** — then:

```swift
import ConvexMobile

struct Freshness: Decodable {
  @ConvexInt var latestSeason: Int
  @ConvexInt var throughWeek: Int
}

let convex = ConvexClient(deploymentUrl: deploymentURL)   // from xcconfig, never hardcoded

// Reads are subscriptions: this loop re-runs every time the document changes.
let freshness = convex.subscribe(to: "freshness:get", yielding: Freshness?.self)
  .replaceError(with: nil)
  .values

for await value in freshness { banner.update(value) }   // nil -> hide the banner

// Writes are mutations.
try await convex.mutation("favorites:save", with: ["kind": "player", "refId": playerId])
```

Note `@ConvexInt`: Convex numbers are float64 on the wire, so `Int` fields need
the property wrapper.

The app holds **two independent connections** and never crosses them:

| | Stats | User-space |
|---|---|---|
| Transport | `URLSession` + `Codable` over `/api/*` | `ConvexClient` |
| Shape | request/response, client-cached | subscription + mutations |
| Auth | none — the REST API is anonymous | JWT via `ConvexClientWithAuth` (P2) |
| Failure | blocks the answer | must not block anything |

Composition happens in the view model: a favorites subscription yields `refId`s,
the stats client fetches each profile, the view renders the join. Convex never
sees a stat; `URLSession` never sees a token.

**Degraded mode is a requirement, not a nicety.** If Convex is unreachable the
app still answers questions: the ask loop, suggest, examples, profiles and share
links have zero Convex dependency, signed-out is a first-class state, and the
freshness banner *hides* rather than showing a guess or a stale value as
current — the same instinct as the engine's refusal to answer imprecisely.

## Auth

Not implemented — P2. Every function in `savedQuestions.ts` and `favorites.ts`
already gates on `ctx.auth.getUserIdentity()` and derives `userId` from
`identity.subject`; queries return `[]` when signed out, mutations throw. What
is missing is `convex/auth.config.ts` (issuer domain + application id) and the
provider decision, which is Clerk with Auth0 as the named fallback —
[`docs/CONVEX_INTEGRATION.md`](../../docs/CONVEX_INTEGRATION.md) §3 has the
comparison, the App Store Guideline 4.8 analysis, and the Sign-in-with-Apple
requirement.

Two invariants for reviewers, both cheap to check and expensive to miss:

- **`userId` is never a function argument.** A function that accepts one lets
  any caller read any user's rows. Review-blocking.
- **A shared secret authenticates a machine, never a user.** `http.ts` is
  deliberately identity-free because its caller is the ingest job; any route
  added there that touches user-space must gate on `ctx.auth`.

## Generated code

`convex/_generated/` is **committed**. Convex's own codegen says so — "your code
won't typecheck without it" — and committing it is what keeps `pnpm typecheck`
green in CI with no Convex account and no `CONVEX_DEPLOY_KEY` secret.

It is produced by the CLI, not by hand. `npx convex dev` regenerates it on every
push; `npx convex codegen` regenerates it standalone **but requires
`CONVEX_DEPLOYMENT` to be set** — it is not an offline command, which is why the
files in this commit were produced by running the installed CLI's own codegen
templates and prettier settings directly. Once a deployment exists, forget that
detail and let `convex dev` own the directory.

`convex.json` pins `codegen.fileType: "ts"` so the output is TypeScript rather
than the default `.js` + `.d.ts` pair — one less file shape for eslint and knip
to reason about. `pnpm lint` skips the directory; knip's built-in Convex plugin
already understands that `convex/*.ts` are entry points discovered by the CLI
rather than by imports, so no `knip.json` entry is needed.

## Scripts

```bash
pnpm --filter @yunoball/convex dev         # convex dev  (needs an account)
pnpm --filter @yunoball/convex codegen     # convex codegen (needs CONVEX_DEPLOYMENT)
pnpm --filter @yunoball/convex typecheck   # tsc --noEmit
pnpm --filter @yunoball/convex lint        # eslint, minus _generated/
```

`pnpm typecheck`, `pnpm lint` and `pnpm knip` from the repo root include this
package — it is a real workspace member (`pnpm-workspace.yaml`), not an island.
