# YunoBall

**The all-in-one NFL platform — every number computed from real data.**
An improved take on StatMuse, NFL-first: natural-language search plus scores,
standings, leaderboards, a fantasy lineup builder and an assistant, all served
from one authoritative warehouse that shows you the exact query behind every
answer.

- **Search** — ask anything; answers come from typed QuerySpecs, never hallucinated
- **Scores & Results** (`/scores`) — week-by-week finals
- **Standings** (`/standings`) — W-L, points, streaks, computed live from game results
- **Leaderboards** (`/leaderboards`) — season leaders as dense stat tables
- **Fantasy** (`/fantasy`) — build a PPR lineup from real season production
- **Assistant** (`/assistant`) — a tool-routing agent over the same trusted endpoints

## How it works

A question is parsed into a typed **`QuerySpec`** (a small structured intent),
not raw SQL — deterministically, by rules. A builder turns the spec into safe,
parameterized SQL over a curated NFL warehouse, so numbers are **computed from
facts, never hallucinated**, and the SQL is injection-proof by construction.
Fuzzy resolution maps names to canonical ids; a two-tier cache dedupes repeats;
narration is templated from the result. Zero LLM calls anywhere. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

One language, one runtime — TypeScript everywhere:

- **Frontend:** Next.js — `apps/web`
- **Backend:** Express — `apps/server` (REST APIs + query engine + ingestion CLI)
- **Shared types:** `packages/types` — the API wire contract, imported by both
- **Database:** Postgres — schema in `apps/server/src/db/schema.sql`
- **Data:** nflverse release files (CSV) — `apps/server/src/ingest`

## Repository layout

```
apps/
  web/        Next.js UI
  server/     Express backend
    src/routes        path table (thin)
    src/controllers   request validation
    src/services      business logic
    src/repositories  shared SQL helpers
    src/engine        NL -> QuerySpec -> SQL query engine
    src/ingest        nflverse -> warehouse pipelines + CLI
    src/db            pool, schema.sql, migrate
packages/
  types/      shared API types (web <-> server)
docs/
  ARCHITECTURE.md
docker-compose.yml   local Postgres + Redis
```

## Quick start

```bash
cp .env.example .env     # local-Docker defaults are pre-filled
pnpm install

# 1. Infra — Postgres.
#    If host port 5432 is taken, drop a docker-compose.override.yml remapping it
#    (e.g. "5433:5432") and point DATABASE_URL at the new port.
docker compose up -d

# 2. Schema (idempotent)
pnpm db:migrate

# 3. Data — box scores + season/game stats; --all loads every season since 1999.
pnpm ingest:nfl --season 2024
pnpm ingest:nfl --season 2024 --dry-run     # preview counts + validation only

# 4. Backend + frontend
pnpm dev:server          # http://localhost:4000
pnpm dev:web             # http://localhost:3000
```

The ingestion CLI is idempotent (upserts), validates every row before writing,
logs every skipped row with a reason, and keeps going when one dataset fails.
See [`apps/server/src/ingest`](apps/server/src/ingest) for the flow and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for table relationships.

## Tests

```bash
pnpm --filter @yunoball/server test   # engine + ingestion suites (needs the Docker Postgres)
pnpm typecheck

# End-to-end browser tests (Playwright; reuses running dev servers, or boots
# both itself when none are up — same as CI)
pnpm e2e
```

CI (`.github/workflows/ci.yml`) runs all of it on every push and pull request,
including a real one-season ingest against a service Postgres.

## Status

Working prototype: a **structured `QuerySpec` query engine** (rules →
deterministic SQL, fuzzy entity resolution, two-tier cache, templated
narration, zero LLM calls) over a **real local warehouse** (nflverse
1999–present), plus scores, standings, leaderboards,
fantasy tools, shareable answer pages and an assistant. Additional data
providers (ESPN media ids are one already) slot in as independent modules
under `apps/server/src/ingest/providers` without touching the public API.
