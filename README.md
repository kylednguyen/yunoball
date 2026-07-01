# YunoBall

**Ask anything about NFL history — answers backed by real data.**
An improved take on StatMuse, NFL-first: every answer is computed from an
authoritative warehouse and shows you the exact query behind it.

## How it works

A question is parsed into a typed **`QuerySpec`** (a small JSON intent), not raw
SQL — by rules for common shapes (zero LLM), or an LLM function-call for the long
tail. A deterministic builder turns the spec into safe, parameterized SQL over a
curated NFL warehouse, so numbers are **computed from facts, never hallucinated**,
and the SQL is injection-proof by construction. Fuzzy resolution maps names to
canonical ids; a two-tier cache lets repeats skip the LLM entirely; narration is
templated from the result. The head of the distribution answers in **≤1 LLM call
(often 0)**. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

- **Frontend:** Next.js (TypeScript) — `apps/web`
- **Backend:** FastAPI (Python) — `apps/api`
- **Database:** Postgres + pgvector (Supabase) — schema in `packages/db`
- **Cache:** two-tier answer cache — Redis, or in-memory when Redis is absent
- **Data:** nflverse via `nfl_data_py` — `packages/ingest`
- **LLM + embeddings:** OpenAI (optional — rule-based engine runs key-less)

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

## Try the prototype now (demo mode — no Docker, no keys)

Demo mode runs on SQLite with a rule-based NL→SQL engine and seeded sample
2022–2023 stats — zero external services. One command:

```bash
./scripts/demo.sh
# then open http://localhost:4000  and ask:
#   "Who threw the most touchdowns in 2023?"
#   "Patrick Mahomes career passing yards"
#   "Most rushing yards in a single game"
```

Every answer shows the exact SQL it ran. Set `OPENAI_API_KEY` + a Postgres
`DATABASE_URL` to switch to the real LLM + warehouse path automatically.

## Quick start (full stack, local)

```bash
cp .env.example .env          # fill in OPENAI_API_KEY and DB/Redis URLs

# 1. Infra
docker compose up -d

# 2. Schema (Python venv in packages/db)
cd packages/db && pip install -e . && alembic upgrade head && cd -

# 3. Data (Python venv in packages/ingest)
cd packages/ingest && pip install -e . -e ../db && yunoball-ingest --all --skip plays && cd -

# 4. Backend
cd apps/api && pip install -e . && pip install -e ../../packages/db
uvicorn app.main:app --reload --port 4000

# 5. Frontend
pnpm install && pnpm dev:web
```

## Status

Working prototype. Done: structured `QuerySpec` pipeline (rules + LLM
function-call), deterministic SQL builder, fuzzy entity resolution, two-tier
cache, templated narration, full-dataset ingestion (`--all` since 1999), an eval
harness gating CI, and one-click deploy (Vercel + Render/Fly). Try it with
`./scripts/demo.sh` — no keys required.

Next: wire a real Supabase + run the LLM path end-to-end, more query intents
(team/comparison/situational), semantic cache, and frontend polish. See the
roadmap in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
