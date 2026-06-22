# YunoBall Architecture

> StatMuse, but more advanced — natural-language search over NFL historical data.

## Core thesis

A stats product lives or dies on **accuracy**. Free-form RAG over text will
hallucinate numbers. So YunoBall is **natural-language → structured query** over
a curated, authoritative warehouse. The LLM *translates and narrates*; the
database is the *source of truth*; the vector store handles the fuzzy bits
(entity resolution + few-shot retrieval), never the facts.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router, TypeScript) |
| Backend | FastAPI (Python) |
| Database | Postgres + pgvector (Supabase) |
| Cache | Redis (answer cache, rate limiting, follow-up state) |
| Data | nflverse via `nfl_data_py` (NFL-only for now) |
| LLM + embeddings | OpenAI (`gpt-4o` for SQL, `gpt-4o-mini` to narrate, `text-embedding-3-small`) |

The backend and the data/ML layer are both Python, so ingestion, the NL→SQL
pipeline, and embeddings share one language and one schema definition.

## System map

```
            ┌──────────────────────── apps/web (Next.js) ────────────────────────┐
            │  search box → answer card (narration + table + "show the SQL")      │
            └──────────────────────────────────┬───────────────────────────────────┘
                                                │  POST /api/search
            ┌──────────────────────── apps/api (FastAPI) ────────────────────────┐
            │  run_query_pipeline:                                                 │
            │    0. cache lookup      (Redis: hot/repeat queries skip the LLM)     │
            │    1. resolve_entities  (pg_trgm + pgvector → canonical ids)         │
            │    2. retrieve_context  (schema slice + few-shot Q→SQL via pgvector) │
            │    3. generate_sql      (OpenAI: NL → read-only SELECT)              │
            │    4. guard_sql         (sqlglot: parse, allowlist tables, LIMIT)    │
            │    5. execute_sql       (read-only role + statement_timeout)         │
            │    6. narrate           (OpenAI: one-line answer from rows)          │
            └──────────────────────────────────┬───────────────────────────────────┘
                                                │
            ┌──────────── Supabase Postgres + pgvector (packages/db) ─────────────┐
            │  star schema: seasons · teams · players · games                      │
            │              player_game_stats · team_game_stats · plays             │
            │              player_season_stats (rollup)                            │
            │  RAG: entity_aliases · query_examples · answer_cache                 │
            │  (SQLAlchemy models + Alembic — one schema, shared by api + ingest)  │
            └──────────────────────────────────▲───────────────────────────────────┘
                                                │  upsert (idempotent)
            ┌──────────── packages/ingest (Python · nfl_data_py) ─────────────────┐
            │  nflverse → reshape → warehouse                                      │
            └────────────────────────────────────────────────────────────────────┘
```

## Why these choices

| Decision | Rationale |
|---|---|
| Text-to-SQL, not document RAG | Numbers must be computed from facts, not retrieved from prose. |
| FastAPI (Python) backend | Collapses backend + data/ML into one language; no Node↔Python seam. |
| Postgres + pgvector | One datastore for relational facts *and* embeddings. Supabase-hosted. |
| Redis cache | Hot answers, rate limiting, conversation/follow-up state. Not the vector store. |
| SQLAlchemy + Alembic | One schema definition, owned by the Python backend, shared with ingest. |
| nflverse / `nfl_data_py` | Free, open, comprehensive (PBP back to 1999). No scraping/ToS risk. |
| Read-only role + sqlglot guard | Defense-in-depth so generated SQL can't write or escape the allowlist. |

## What makes it "more advanced" than StatMuse

- **Transparency** — every answer exposes the exact SQL + source rows.
- **Situational/advanced stats** — play-by-play powers "3rd-and-long conversion
  rate when trailing in Q4," EPA/WP splits, etc.
- **Conversational follow-ups** — "...and in the playoffs?" carries context.
- **Shareable answer cards** and deeper free historical coverage.

## Roadmap

- **Phase 0 (this)** — monorepo, star schema, FastAPI pipeline skeleton, ingest CLI, search UI, local infra (docker-compose).
- **Phase 1** — wire real Supabase + ingest 2022–2024; player/team season & game queries end-to-end; **eval harness** (golden Q→result set measuring SQL execution accuracy).
- **Phase 2** — entity resolution (trgm + pgvector) and few-shot retrieval.
- **Phase 3** — charts, leaderboards, shareable pages, Redis answer cache.
- **Phase 4** — play-by-play / situational + advanced metrics; full 1999–present backfill.
- **Later** — multi-sport (the NL→SQL engine is sport-agnostic; add per-sport schema + data source, e.g. `pybaseball` for MLB).

## Eval (non-negotiable)

Accuracy is the product. A golden set of `question → expected result` pairs runs
in CI; we track execution accuracy and regressions before shipping prompt or
schema changes.
