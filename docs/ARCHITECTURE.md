# YunoBall Architecture

> StatMuse, but more advanced — natural-language search over NFL historical data.

## Core thesis

A stats product lives or dies on **accuracy**. Free-form generation over text
will hallucinate numbers. So YunoBall is **natural-language → structured query**
over a curated, authoritative warehouse. A deterministic parser *translates*,
a template builder *writes the SQL*; the database is the *source of truth*.

## Stack

One language, one runtime — TypeScript end to end:

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router, TypeScript) |
| Backend | Express (TypeScript) — `apps/server` |
| Shared types | `packages/types` — the API wire contract, imported by web and server |
| Database | Postgres (Supabase-hostable; plain SQL schema + idempotent migrate) |
| Cache | In-process two-tier answer cache; durable share store in Postgres |
| Data | nflverse release files via the `ingest/providers/nflverse` module |

## System map

```
            ┌──────────────────────── apps/web (Next.js) ────────────────────────┐
            │  search box → answer card (narration + table + "show the SQL")     │
            └──────────────────────────────────┬──────────────────────────────────┘
                                               │  /api/* (types: packages/types)
            ┌─────────────────────── apps/server (Express) ──────────────────────┐
            │  routes → controllers (zod validation) → services → repositories   │
            │                                                                     │
            │  engine (POST /api/search):                                         │
            │    L1 cache   (normalized text) ── hit ─► response                  │
            │    resolve    (fuzzy name → canonical player_id)                    │
            │    parse      (deterministic rules → QuerySpec)                     │
            │    L2 cache   (spec key) ── hit ─► response                         │
            │    build      (allowlisted template, bound params — injection-proof)│
            │    execute    (read-only role)                                      │
            │    narrate    (templated from spec + rows)                          │
            │                                                                     │
            │  agent (POST /api/agent): intent routing over the same services     │
            └──────────────────────────────────┬──────────────────────────────────┘
                                               │
            ┌───────────────────────── Postgres warehouse ────────────────────────┐
            │  star schema: seasons · teams · players · games                     │
            │              player_game_stats · team_game_stats                    │
            │              player_season_stats (rollup)   answer_cache (shares)   │
            │              draft_picks · query_audit                              │
            │  (schema.sql + `pnpm db:migrate`, idempotent)                       │
            └──────────────────────────────────▲──────────────────────────────────┘
                                               │  batched idempotent upserts
            ┌──────────────── apps/server/src/ingest (`pnpm ingest:nfl`) ─────────┐
            │  providers/nflverse (CSV, disk cache, retries)                      │
            │    → normalize (stable ids, relocations, REG/POST)                  │
            │    → validate (zod, skip + log malformed rows)                      │
            │    → upsert (transactions, failure isolation per dataset)           │
            └─────────────────────────────────────────────────────────────────────┘
```

## Why these choices

| Decision | Rationale |
|---|---|
| Structured intent, not raw SQL | The parser emits a typed `QuerySpec`, never SQL → fast, cacheable, and injection-proof: we build the SQL from allowlists. |
| Numbers from facts, not RAG | Answers are computed from the warehouse, never retrieved from prose. |
| Express (TypeScript) backend | One language and runtime across the whole app; types shared with the frontend so the contract can't drift. |
| Plain-SQL schema + idempotent migrate | The warehouse is eleven tables; `CREATE TABLE IF NOT EXISTS` beats a migration framework at this size. |
| nflverse release CSVs | Free, open, comprehensive (stats back to 1999). No scraping/ToS risk, no SDK dependency. |
| Provider modules under `ingest/providers` | New sources (ESPN, SportsDataIO, live scoring, injuries...) are independent modules; the public API never changes. |
| Read-only role for reads | Engine-executed SQL and API reads run least-privilege when `READONLY_DATABASE_URL` is set. |

## Query pipeline

The common path is deterministic end to end:

1. **L1 cache** — normalized question text. Repeats → instant.
2. **Resolve** — fuzzy-match names to a canonical `player_id` (last-name / typo tolerant; a difflib-equivalent matcher).
3. **Parse to `QuerySpec`** — rule-based, zero-LLM. Intents: leaders, player totals (season/career/first-N), single-game marks, player-vs-player comparisons, REG/POST scopes.
4. **L2 cache** — keyed on the spec, so different phrasings that mean the same thing share an answer.
5. **Build → execute** — deterministic template with **bound params**; stat columns come only from an allowlist.
6. **Narrate** — templated from spec + rows.
7. Questions that don't parse get an honest "can't answer that yet" — never a guess.

Every answer records a durable `share_id` (Postgres `answer_cache`) powering
`/a/<share_id>` share pages.

## Ingestion

`pnpm ingest:nfl --season 2024` (or `--all`, `--years ...`,
`--season-type REG`, `--dry-run`). Idempotent upserts; per-dataset failure
isolation; every malformed/orphaned row is skipped with a logged reason and an
end-of-run tally. Normalization: stable ids (gsis player ids, nflverse game
ids, current-franchise team ids with relocations folded forward), playoff
rounds collapsed to `POST`, postponed games kept with `NULL` scores.
`scoring_plays` distills play-by-play down to touchdown events only (~1.4k
rows/season instead of ~50k), powering first/last-TD questions and the
player-page touchdown log without storing full pbp.

Table relationships:

```
seasons ◄────────── games ──────────► teams
   ▲                  ▲                 ▲
player_season_stats   ├── player_game_stats (player × game)
   │                  ├── team_game_stats   (team × game)
   ▼                  └── scoring_plays     (touchdown events)
players ◄── player_game_stats.player_id / scoring_plays.player_id

(plus draft_picks and query_audit)
```

## What makes it "more advanced" than StatMuse

- **Transparency** — every answer exposes the exact SQL + source rows.
- **Deep coverage** — a full 1999–present warehouse of box scores and rollups.
- **Shareable answer cards** and computed-on-the-fly standings/leaderboards.

## Testing

- `apps/server/test/engine.test.ts` — parser/builder/narration golden cases,
  including a check that the similarity port matches CPython's difflib.
- `apps/server/test/ingest.test.ts` — messy-data suite (relocations, duplicate
  ids, postponed games, orphan stats, dry-run, idempotency, schema drift)
  against a scratch Postgres database.
- Playwright e2e (`apps/web/e2e`) over both servers; CI ingests a real season
  into a service Postgres before running it.
