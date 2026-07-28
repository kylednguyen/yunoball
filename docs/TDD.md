# YunoBall — Technical Design Document

> How the system is built and why. Complements [ARCHITECTURE.md](ARCHITECTURE.md)
> (the narrative overview) with the full technical reference.
> Companion docs: [PRD.md](PRD.md) · [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md) · [DEPLOYMENT.md](DEPLOYMENT.md)

## 1. System overview

One language, one runtime — TypeScript end to end:

| Layer | Choice | Where |
|---|---|---|
| Frontend | Next.js (App Router) | `apps/web` |
| Backend | Express | `apps/server` |
| Wire contract | Shared type package (types only, no runtime) | `packages/types` |
| Database | Postgres (Supabase-hostable), plain-SQL schema | `apps/server/src/db` |
| Cache | In-process two-tier answer cache + durable Postgres store | engine + `answer_cache` |
| Data | nflverse release CSVs | `apps/server/src/ingest` |
| Tooling | pnpm workspaces + turbo; Node ≥ 22 | repo root |

```
web (Next.js) ──/api/*──► server (Express)
                          routes → controllers (zod) → services → repositories
                          engine: POST /api/search (deterministic pipeline)
                          agent:  POST /api/agent  (intent routing)
                                        │
                                  Postgres warehouse ◄── ingest CLI (nflverse)
```

## 2. Monorepo layout

```
apps/web            Next.js UI (app router pages, components, lib)
apps/server/src
  routes/           path table only (thin)
  controllers/      request validation (zod) — one file
  services/         business logic per surface (search, games, standings,
                    leaderboards, players, teams, fantasy, agent)
  repositories/     shared SQL helpers
  engine/           NL → QuerySpec → SQL (spec, parseRules, resolve, build,
                    executors/, narrate, audit, similarity, pipeline, facts)
  ingest/           providers/ (nflverse), normalize, upsert, pipelines, cli
  db/               pool, schema.sql, migrate
  cli/              fetchEspnIds (ESPN headshot ids)
  lib/              cross-cutting helpers (espn, rateLimit, …)
packages/types      the API wire contract (snake_case = JSON format)
```

**Dependency rule:** web and server share *types only*. Field names are
snake_case because they are the wire format; `packages/types` never ships
runtime code.

## 3. API surface

| Endpoint | Purpose |
|---|---|
| `POST /api/search` | Ask a question → `AnswerResult` |
| `GET /api/search/examples` | Supported example questions |
| `GET /api/search/suggest` | Autocomplete (players, teams, questions) |
| `GET /api/search/answer/:shareId` | Persisted answer for `/a/` pages |
| `GET /api/leaderboards` | Season leader boards |
| `GET /api/games` | Week slate (season/week pickers) |
| `GET /api/games/performers` | Weekly top performers (PPR) |
| `GET /api/games/:gameId/boxscore` | Full box score |
| `GET /api/standings` | Computed standings |
| `GET /api/fantasy/players` | Fantasy player pool |
| `GET /api/players/:playerId` | Player profile (+ `/splits`) |
| `GET /api/teams/:teamId` | Team profile |
| `POST /api/agent` | Assistant (tool routing, demo mode) |
| `GET /health` / `GET /ready` | Liveness / readiness (readiness pings Postgres; Render health-checks `/ready`) |

Response shapes are exactly the interfaces in `packages/types/src/index.ts`
(`AnswerResult`, `LeaderboardsResponse`, `StandingsResponse`, `PlayerProfile`,
`TeamProfile`, `BoxScore`, …).

## 4. The query engine (the core subsystem)

### 4.1 Pipeline — deterministic end to end, zero LLM calls

```
question ─► L1 cache (normalized text) ── hit ─► response
        └─► resolve   fuzzy name → canonical player_id / team_id
        └─► parse     rule-based → typed QuerySpec
        └─► L2 cache  (specCacheKey) ── hit ─► response
        └─► build     allowlisted template + bound params
        └─► execute   read-only role
        └─► narrate   templated from spec + rows
        └─► audit     structured verdict → query_audit
```

Unparseable questions return an honest refusal — never a guess. Every parsed
answer is persisted with a deterministic `share_id` **before** returning, so
navigation to `/a/<id>` can't race the write.

### 4.2 QuerySpec — a typed AST, not SQL

`engine/spec.ts` defines a **discriminated union on `intent`** — 21 intents:
`leaders`, `player_total`, `player_seasons`, `single_game`, `compare`,
`scoring`, `game_count`, `qualifying_count`, `player_rank`, `player_bio`,
`game_log`, `team_game_log`, `game_result`, `draft_pick`, `team_bio`,
`team_stat`, `team_roster`, `player_streak`, `team_streak`, `milestone`,
`award`.

Each intent's node carries **only the fields its executor consumes** — "the
parser set a field the executor silently ignores" (the engine's worst
historical bug class) is a compile error. Cross-intent readers (auditor,
narration, cache key) use the loosened `fields()` view; executors must not.

Shared field bags: `SpecBase` (stat, season, REG/POST, season/career scope,
limit), `GameWindow` (venue, week range, playoff round, Super Bowl only,
opponent, season range, month, primetime, temperature ceiling), and
`TeamGameFields` (team-anchored lookups, exact dates, margin ceilings).

### 4.3 The stat allowlist

`STATS` maps ~30 stat keys to `StatDef`s: an SQL expression over alias `s`
(**allowlisted here, never taken from free text**), a narration label, and
matching vocabulary (substring `phrases` + whole-word `words`, ordered most
specific first so rate stats match before the volume stats they embed).
Machinery:

- `ratio` stats (completion %, YPC, CPOE…) aggregate numerator/denominator
  separately and divide after summing, with season/career qualifier floors.
- `formula: "passer_rating"` — the one multi-column named formula.
- `source: "game"` — stats that exist only at game grain aggregate the game
  log instead of season rollups; `table: "advanced"` routes to
  `player_game_advanced` (EPA/success/CPOE).
- Deliberate vocabulary gaps are correctness features: "pick" (collides with
  draft picks) and "carries" (means attempts, not yards) are excluded — a
  wrong number is worse than an honest refusal.

### 4.4 Safety properties

- **Injection-proof by construction:** SQL text comes only from fixed
  templates + allowlisted stat expressions; all user-derived values are bound
  parameters.
- **Least privilege:** engine SQL executes on `READONLY_DATABASE_URL` when
  set.
- **Auditable:** every question logs a structured `query_audit` row (spec,
  status, warnings, confidence, row count, duration).

### 4.5 Caching & shares

- **L1:** normalized question text → answer (repeat questions are instant).
- **L2:** `specCacheKey(spec)` — different phrasings of the same intent share
  one answer. The key enumerates every executor-relevant field (notably
  `playerId`, since display names collide).
- **Durable:** `answer_cache` persists every answer under its `share_id`
  (deterministic SHA-256 prefix), TTL `ANSWER_CACHE_TTL_SECONDS` (24h
  default), powering permanent `/a/` share pages.

### 4.6 Entity resolution

Fuzzy matcher (a difflib-equivalent port, golden-tested against CPython's
behavior) maps mentions to canonical ids — last-name and typo tolerant, with
confidence scores surfaced in `AnswerResult.entities`.

## 5. Services layer

Non-search surfaces are conventional service modules over the repositories:
`games`, `standings` (computed live from `team_game_stats`/`games`),
`leaderboards` (defaults to the latest loaded season), `players` (profile,
splits), `teams` (record, ranks, leaders), `fantasy`, `search`, `agent`. The
assistant routes intents to these same services and reports its tool steps
(`mode: "demo"`).

## 6. Ingestion subsystem

- **Providers** (`ingest/providers/nflverse`): release-file CSV download with
  disk cache and retries. New sources (ESPN, live scoring, injuries…) slot in
  as sibling provider modules without touching the public API.
- **Normalize:** stable gsis/schedule ids, relocations folded to current
  franchises, playoff rounds → `POST`, postponed games kept with NULL scores.
- **Validate:** zod row schemas; malformed/orphaned rows are skipped with a
  logged reason and an end-of-run tally (never silently dropped, never fatal).
- **Upsert:** batched idempotent upserts in transactions; per-dataset failure
  isolation (one bad dataset doesn't kill the run).
- **CLI:** `pnpm ingest:nfl --season 2024 | --all | --years … [--season-type]
  [--dry-run]`; re-runs are safe.
- **Pbp distillation:** scoring plays (TD events), per-player-game advanced
  aggregates, TD yards, drive counts — full play-by-play is never stored.

## 7. Configuration

| Env var | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres (Supabase session pooler in prod, :5432) | local Docker |
| `READONLY_DATABASE_URL` | read-only role for engine SQL | falls back to `DATABASE_URL` |
| `CORS_ORIGINS` | allowed browser origins | localhost dev ports |
| `RATE_LIMIT_PER_MINUTE` | per-IP cap on `/api/search` + `/api/agent` (0 = off) | 30 |
| `ANSWER_CACHE_TTL_SECONDS` | durable answer TTL | 86400 |
| `LOG_LEVEL` | pino level | info |
| `NEXT_PUBLIC_API_URL` | (web) API origin | — |

TLS auto-enables for any non-localhost database host; the server binds the
host-injected `$PORT`. Rate limiting reads the client from `X-Forwarded-For`
behind the proxy.

## 8. Deployment

Vercel (web, root `apps/web`) → Render (API — Docker blueprint in
`render.yaml`, persistent Node service; health check `/ready`) → Supabase
Postgres (session pooler). Full runbook: [DEPLOYMENT.md](DEPLOYMENT.md).
The API must be a persistent process (warm pool + in-process cache), not
serverless.

## 9. Testing

| Suite | What it proves |
|---|---|
| `apps/server/test/engine.test.ts` | Parser/builder/narration golden cases; similarity port matches CPython difflib |
| `apps/server/test/ingest.test.ts` | Messy-data suite against a scratch Postgres: relocations, duplicate ids, postponed games, orphan stats, dry-run, idempotency, schema drift |
| `apps/web/e2e` (Playwright) | Real browser flows over both servers (reuses running dev servers or boots its own) |
| CI (`.github/workflows/ci.yml`) | Lint, typecheck, both server suites, plus a real one-season ingest into a service Postgres before e2e |

Run: `pnpm --filter @yunoball/server test` · `pnpm typecheck` · `pnpm e2e`.

## 10. Key decisions

| Decision | Rationale |
|---|---|
| Structured intent (QuerySpec), never raw SQL | Fast, cacheable, injection-proof; the spec doubles as the cache key |
| Discriminated union per intent | Parser/executor field drift becomes a compile error |
| Numbers from facts, not RAG/LLM | Accuracy is the product; zero inference cost and latency |
| Express + shared types package | One language; the wire contract can't drift between web and server |
| Plain-SQL schema + idempotent migrate | ~11 tables; `IF NOT EXISTS` beats a migration framework at this size |
| nflverse release CSVs | Free, open, 1999–present; no scraping/ToS risk |
| Provider modules for new data sources | Public API stays stable as sources are added |
| Persistent Node API (not serverless) | Warm pool, in-process cache, session-pooler compatibility |
