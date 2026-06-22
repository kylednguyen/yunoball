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
- **Data:** nflverse via `nfl_data_py` — `packages/ingest`
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

```bash
cp .env.example .env          # fill in OPENAI_API_KEY and DB/Redis URLs

# 1. Infra
docker compose up -d

# 2. Schema (Python venv in packages/db)
cd packages/db && pip install -e . && alembic upgrade head && cd -

# 3. Data (Python venv in packages/ingest)
cd packages/ingest && pip install -e . && yunoball-ingest --years 2022 2023 2024 && cd -

# 4. Backend
cd apps/api && pip install -e . && pip install -e ../../packages/db
uvicorn app.main:app --reload --port 4000

# 5. Frontend
pnpm install && pnpm dev:web
```

## Status

Phase 0 — scaffold. The pipeline stages (entity resolution, few-shot retrieval,
eval harness) are stubbed and land in subsequent phases per the roadmap.
