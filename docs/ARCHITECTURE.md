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
            │  run_query_pipeline (structured-first):                              │
            │    L1 cache      (text; semantic slot) ── hit ─► response            │
            │    resolve       (fuzzy name → canonical player_id)                  │
            │    parse         (rules fast-path; else LLM function-call → JSON)    │
            │    validate      (QuerySpec: allowlisted stat, bounded params)       │
            │    L2 cache      (spec key) ── hit ─► response                       │
            │    build         (deterministic template, bound params — no guard)   │
            │    execute       (read-only role + statement_timeout, threaded)      │
            │    narrate       (templated from spec + rows — no 2nd LLM call)      │
            │    └ long-tail fallback: raw NL→SQL → sqlglot guard → execute        │
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
| Structured intent, not raw SQL | LLM emits a typed `QuerySpec` (tiny JSON), not SQL → faster, cacheable, and injection-proof: we build the SQL. |
| Numbers from facts, not RAG | Answers are computed from the warehouse, never retrieved from prose. |
| FastAPI (Python) backend | Collapses backend + data/ML into one language; no Node↔Python seam. |
| Postgres + pgvector | One datastore for relational facts *and* embeddings. Supabase-hosted. |
| Two-tier cache (L1 text, L2 spec) | Front-loaded so repeats skip the LLM entirely; in-memory when Redis is absent. |
| SQLAlchemy + Alembic | One schema definition, owned by the Python backend, shared with ingest. |
| nflverse / `nfl_data_py` | Free, open, comprehensive (PBP back to 1999). No scraping/ToS risk. |
| Read-only role + sqlglot guard | Guards the raw-SQL *fallback*; the structured path needs no guard (SQL is templated). |

## Query pipeline

The common path never touches raw SQL and often skips the LLM entirely:

1. **L1 cache** — normalized text (+ semantic slot). Repeat/near-duplicate → instant.
2. **Resolve** — fuzzy-match names to a canonical `player_id` (last-name / typo tolerant).
3. **Parse to `QuerySpec`** — rules fast-path (0 LLM); LLM **function-call** for the long tail. Both emit the same typed spec, never SQL.
4. **Validate** — the spec is untrusted: stat must be allowlisted, params bounded.
5. **L2 cache** — keyed on the spec, so different phrasings that mean the same thing share an answer.
6. **Build → execute** — deterministic template with **bound params**; run on the read-only engine.
7. **Narrate** — templated from spec + rows. No second LLM call.
8. **Fallback** — anything unparseable drops to raw NL→SQL, guarded by sqlglot.

Result: the head of the distribution answers in **≤1 LLM call (often 0)**, and every
answer is safe by construction.

Accuracy is tracked by an eval harness (`app/eval`) — a golden question→answer
set scored through the real pipeline on parse + execution accuracy, gating CI.

## What makes it "more advanced" than StatMuse

- **Transparency** — every answer exposes the exact SQL + source rows.
- **Situational/advanced stats** — play-by-play powers "3rd-and-long conversion
  rate when trailing in Q4," EPA/WP splits, etc.
- **Conversational follow-ups** — "...and in the playoffs?" carries context.
- **Shareable answer cards** and deeper free historical coverage.

## Roadmap

- ✅ **Scaffold** — monorepo, star schema, FastAPI pipeline, ingest CLI, search UI, local infra.
- ✅ **Structured pipeline** — `QuerySpec` (rules + LLM function-call), deterministic SQL builder, templated narration, ≤1 LLM call.
- ✅ **Fuzzy entity resolution** — name → canonical `player_id` (typo/last-name tolerant).
- ✅ **Two-tier cache** — front-loaded L1 (text) + L2 (spec); in-memory or Redis.
- ✅ **Eval harness** — golden Q→answer set scoring parse + execution accuracy, gating CI.
- ✅ **Full-dataset ingestion** — season/game/PBP loaders, `--all` since 1999, batched upsert.
- ✅ **Deploy** — Vercel (web), Render/Fly (API), docker-compose (local).
- ⬜ **Wire real Supabase** — apply schema, ingest, run the LLM path end-to-end.
- ⬜ **More intents** — team stats, comparisons, situational/PBP splits (with eval cases).
- ⬜ **Semantic cache** — pgvector embedding lookup (slot exists).
- ⬜ **Frontend polish** — charts, shareable answer cards, loading states.
- ⬜ **Later** — multi-sport (the engine is sport-agnostic; add per-sport schema + source, e.g. `pybaseball`).

## Eval (non-negotiable)

Accuracy is the product. `app/eval` runs a golden `question → expected` set
through the real pipeline, scoring **parse accuracy** (right `QuerySpec`) and
**execution accuracy** (right top answer), and gates CI at 100%. Grow the golden
set with every new intent so accuracy stays measured, not assumed.
