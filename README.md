# YunoBall

**Ask anything about NFL history — answers backed by real data.**
An improved take on StatMuse, NFL-first: every answer is computed from an
authoritative warehouse and shows you the exact query behind it.

## How it works

Natural-language questions are translated into **read-only SQL** over a curated
NFL warehouse — not free-form RAG over text — so the numbers are computed from
facts, not hallucinated. An LLM translates the question and narrates the result;
the database is the source of truth; pgvector handles fuzzy entity matching and
few-shot retrieval. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

- **Frontend:** Next.js (TypeScript) — `apps/web`
- **Backend:** FastAPI (Python) — `apps/api`
- **Database:** Postgres + pgvector (Supabase) — schema in `packages/db`
- **Cache:** Redis
- **Data:** nflverse via `nflreadpy` (polars) — `packages/ingest`
- **LLM + embeddings:** OpenAI

## Repository layout

```
apps/
  web/        Next.js search UI
  api/        FastAPI backend + NL→SQL query pipeline
packages/
  db/         SQLAlchemy schema + Alembic migrations (shared)
  ingest/     nflverse → warehouse loader (CLI)
docs/
  ARCHITECTURE.md
docker-compose.yml   local Postgres (pgvector) + Redis
```

## Quick start (local)

> **Python 3.11+.** The data loader is `nflreadpy` (polars-based), so the old
> `pandas<2` / CPython-3.11 ceiling is gone; the dev venv here uses 3.11.

```bash
cp .env.example .env          # local-Docker defaults are pre-filled; add OPENAI_API_KEY

# Python deps — one shared venv (compat editable mode avoids PEP660 finder issues)
python3.11 -m venv .venv && source .venv/bin/activate
pip install --config-settings editable_mode=compat \
    -e packages/db -e packages/ingest -e apps/api

# 1. Infra — Postgres (pgvector) + Redis.
#    If host port 5432 is taken, drop a docker-compose.override.yml remapping it
#    (e.g. "5433:5432") and point DATABASE_URL at the new port.
docker compose up -d

# 2. Schema + least-privilege read-only role
( cd packages/db && alembic upgrade head )
yunoball-provision-readonly

# 3. Data. Box score + play-by-play; --skip-plays for box score only.
#    Full modern era (1999–present), or a smaller window to start:
yunoball-ingest --years $(seq 1999 2024)     # or: --years 2022 2023 2024

# 4. RAG: entity aliases + few-shot library (embeddings computed if a key is set)
yunoball-seed-rag

# 5. Accuracy eval
yunoball-eval --reference-only       # validates golden SQL; no key needed
yunoball-eval --min-accuracy 0.8     # full execution accuracy (needs OPENAI_API_KEY)

# 6. Backend + frontend
( cd apps/api && uvicorn app.main:app --reload --port 4000 )
pnpm install && pnpm dev:web         # http://localhost:3000
```

## Status

Phases 1–4 implemented on a local warehouse with real nflverse data, backfilled
to the full modern era (**1999–2024**): warehouse + ingest + **eval harness**
(Phase 1), entity resolution + few-shot retrieval (Phase 2), charts + leaderboards
+ shareable answers + Redis cache (Phase 3), play-by-play + situational/EPA +
defensive stats (Phase 4).

The NL→SQL path uses **intent classification first** — the LLM classifies a
question into a known intent + slots, which map to vetted, parameterized SQL
templates (safer than free-form SQL); free-form NL→SQL is the fallback. LLM stages
work with any OpenAI-compatible endpoint (OpenAI or local Ollama); trigram
resolution, leaderboards, shareable pages, and the reference eval run with no LLM.
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
