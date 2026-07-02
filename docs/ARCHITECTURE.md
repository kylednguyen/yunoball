# YunoBall Architecture

> StatMuse, but more advanced — natural-language search over NFL historical data.

## Core thesis

A stats product lives or dies on **accuracy**. Free-form RAG over text will
hallucinate numbers. So YunoBall is **natural-language → structured query** over
a curated, authoritative warehouse. The LLM *translates* a question into a typed
`QuerySpec` — never SQL, never the numbers; the database is the *source of
truth*; fuzzy matching (pg_trgm, optionally pgvector) handles entity resolution,
never the facts.

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
            │    (no spec? → honest "not supported yet" — never arbitrary SQL)     │
            └──────────────────────────────────┬───────────────────────────────────┘
                                                │
            ┌──────────── Supabase Postgres + pgvector (packages/db) ─────────────┐
            │  star schema: seasons · teams · players · games                      │
            │              player_game_stats · team_game_stats                     │
            │              player_season_stats (rollup)                            │
            │  entity_aliases (resolve) · answer_cache (share)                     │
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
| nflverse / `nfl_data_py` | Free, open, comprehensive (weekly/seasonal back to 1999). No scraping/ToS risk. |
| Read-only role, no arbitrary SQL | Every query is a templated `QuerySpec` with bound params — there is no LLM-authored SQL to guard. |

## Query pipeline

The common path never touches raw SQL and often skips the LLM entirely:

1. **L1 cache** — normalized text. Repeat questions → instant.
2. **Resolve** — fuzzy-match names to a canonical `player_id` (last-name / typo tolerant).
3. **Parse to `QuerySpec`** — rules fast-path (0 LLM); LLM **function-call** for the long tail. Both emit the same typed spec, never SQL.
4. **Validate** — the spec is untrusted: stat must be allowlisted, params bounded.
5. **L2 cache** — keyed on the spec, so different phrasings that mean the same thing share an answer.
6. **Build → execute** — deterministic template with **bound params**; run on the read-only engine.
7. **Narrate** — templated from spec + rows. No second LLM call.
8. **No spec, no guess** — anything that doesn't map to a supported intent returns an honest "not supported yet." There is no arbitrary-SQL fallback by design.

Result: the head of the distribution answers in **≤1 LLM call (often 0)**, and every
answer is computed from a template — safe by construction.

Accuracy is tracked by an eval harness (`app/eval`) — a golden question→answer
set scored through the real pipeline on parse + execution accuracy, gating CI.

## What makes it "more advanced" than StatMuse

- **Transparency** — every answer exposes the exact SQL + source rows.
- **Deterministic by design** — the LLM only classifies intent; numbers come
  from templated SQL, so answers are reproducible and never hallucinated.
- **Conversational follow-ups** — "...and in the playoffs?" carries context.
- **Shareable answer cards** and deep free historical coverage (1999→present).

## Roadmap

**Query engine** ✅ — structured `QuerySpec` pipeline (rules fast-path + LLM
function-call → deterministic SQL builder), fuzzy entity resolution, two-tier
cache (L1 text + L2 spec), templated narration (≤1 LLM call). No arbitrary SQL:
unsupported questions are answered honestly, not guessed.

**Warehouse & product** ✅
- **Warehouse** — ingest 2022–2024 (box score + season/game rollups), least-privilege read-only role, **eval harness** (parse + execution accuracy).
- **Resolution** — entity resolution over `entity_aliases` (pg_trgm fuzzy match, optional pgvector).
- **Product** — bar charts, season leaderboards (`/api/leaderboards`), shareable answer pages (`/a/<share_id>` backed by `answer_cache`), Redis + Postgres write-through.

**Deploy** ✅ — Vercel (web), Render/Fly (API), docker-compose (local).

**Intents** ✅ — all five V1 intents: `leaders`, `player_total`, `single_game`,
`team_stat` (records, points, scoring leaderboards), and `comparison` (two
players head-to-head).

**Incremental updates** ✅ — `scripts/update_data.py` refreshes the current
season idempotently (upsert, never duplicates), scheduled weekly in-season via
`.github/workflows/update-data.yml`.

**Next (V1 scope)** ⬜ — grow the eval set toward broad intent coverage and run
the full 1999–present backfill (widen `--years`/`--all`).

**Deliberately out of scope for V1** — play-by-play / EPA / win-probability,
fantasy, betting, multi-sport, and any AI-generated statistics. These are
possible future milestones, not part of the polished MVP.

> **Local dev note.** Runs against Docker Postgres+pgvector / Redis with real
> nflverse data. `nfl_data_py` constrains the toolchain to Python 3.11
> (`pandas<2`/`numpy<2`). The LLM-dependent stages (long-tail parse, embeddings)
> activate when `OPENAI_API_KEY` is set; the rule-based parser, trigram
> resolution, leaderboards, shareable pages, and the eval run without it.

## Eval (non-negotiable)

Accuracy is the product. `app/eval` runs a golden `question → expected` set
through the real pipeline, scoring **parse accuracy** (right `QuerySpec`) and
**execution accuracy** (right top answer), and gates CI at 100%. Grow the golden
set with every new intent so accuracy stays measured, not assumed.
