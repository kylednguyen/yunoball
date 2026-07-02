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
| Data | nflverse via `nflreadpy` (polars; NFL-only for now) |
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
            │    3. plan/generate_sql (classify intent → templated SQL;            │
            │                          fallback: LLM free-form NL → SELECT)        │
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
| nflverse / `nflreadpy` | Free, open, comprehensive (PBP back to 1999). Maintained polars-based loader; no scraping/ToS risk. |
| Read-only role + sqlglot guard | Defense-in-depth so generated SQL can't write or escape the allowlist. |

## What makes it "more advanced" than StatMuse

- **Transparency** — every answer exposes the exact SQL + source rows.
- **Situational/advanced stats** — play-by-play powers "3rd-and-long conversion
  rate when trailing in Q4," EPA/WP splits, etc.
- **Conversational follow-ups** — "...and in the playoffs?" carries context.
- **Shareable answer cards** and deeper free historical coverage.

## Roadmap

- **Phase 0** ✅ — monorepo, star schema, FastAPI pipeline skeleton, ingest CLI, search UI, local infra (docker-compose).
- **Phase 1** ✅ — warehouse + ingest 2022–2024 (box score + rollups), least-privilege read-only role, player/team season & game queries, **eval harness** (golden Q→reference SQL; reference-only + execution-accuracy modes).
- **Phase 2** ✅ — entity resolution (pg_trgm GIN + pgvector backstop over `entity_aliases`) and few-shot retrieval (pgvector over `query_examples`, keyword fallback without embeddings).
- **Phase 3** ✅ — bar charts, season leaderboards (`/api/leaderboards`), shareable answer pages (`/a/<share_id>` backed by `answer_cache`), Redis answer cache + Postgres write-through.
- **Phase 4** ✅ — play-by-play ingest + situational/EPA + defensive stats (tackles, sacks, INTs). Backfilled to the full modern era **1999–2024** (one-command `--years $(seq 1999 2024)`).
- **NL→SQL** ✅ — intent classification (question → intent + slots → vetted parameterized SQL templates) with free-form NL→SQL as fallback; runs on OpenAI or local Ollama.
- **Hardening** ✅: Redis rate limiting on `POST /api/search` (fixed window per client IP, `RATE_LIMIT_PER_MINUTE`, fails open when Redis is down); conversational follow-ups (history is condensed into a standalone question before the pipeline, so the cache key uses the effective question); GitHub Actions CI (pytest + golden-set reference eval against an ingested warehouse).
- **Later** — multi-sport (the NL→SQL engine is sport-agnostic; add per-sport schema + data source, e.g. `pybaseball` for MLB).

> **Local dev note.** Runs against Docker Postgres+pgvector / Redis with real
> nflverse data pulled via `nflreadpy` (polars). The LLM stages (NL→SQL,
> narration, embeddings) use any OpenAI-compatible endpoint — set
> `OPENAI_API_KEY` for OpenAI, or `LLM_BASE_URL=http://localhost:11434/v1` to run
> locally on Ollama. Trigram resolution, keyword few-shot, leaderboards,
> shareable pages, and the reference eval run with no LLM at all.

## Eval (non-negotiable)

Accuracy is the product. A golden set of `question → expected result` pairs runs
in CI (`.github/workflows/ci.yml` executes `yunoball-eval --reference-only`
against a warehouse ingested in the job); we track execution accuracy and
regressions before shipping prompt or schema changes.
