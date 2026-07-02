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
- **Database:** Postgres (Supabase) — schema in `packages/db`, `pg_trgm` for fuzzy resolution
- **Cache:** two-tier answer cache — Redis, or in-memory when Redis is absent
- **Data:** nflverse via `nfl_data_py` — `packages/ingest`
- **LLM:** OpenAI, question→QuerySpec only (optional — rule-based engine runs key-less)

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
docker-compose.yml   local Postgres + Redis
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

> **Python 3.11 required.** `nfl_data_py` pins `pandas<2` / `numpy<2`, whose
> wheels only exist through CPython 3.11.

```bash
cp .env.example .env          # local-Docker defaults are pre-filled; add OPENAI_API_KEY

# Python deps — one shared venv (compat editable mode avoids PEP660 finder issues)
python3.11 -m venv .venv && source .venv/bin/activate
pip install --config-settings editable_mode=compat \
    -e packages/db -e packages/ingest -e apps/api

# 1. Infra — Postgres + Redis.
#    If host port 5432 is taken, drop a docker-compose.override.yml remapping it
#    (e.g. "5433:5432") and point DATABASE_URL at the new port.
docker compose up -d

# 2. Schema + least-privilege read-only role
( cd packages/db && alembic upgrade head )
yunoball-provision-readonly

# 3. Data — box score + season/game stats (no play-by-play).
#    Use --all instead of --years for every season since 1999.
yunoball-ingest --years 2022 2023 2024
#    In-season, refresh the current year idempotently (also runs on a schedule
#    via .github/workflows/update-data.yml):
python scripts/update_data.py

# 4. Entity aliases (pg_trgm fuzzy resolution)
yunoball-seed-rag

# 5. Accuracy eval (deterministic, no key needed)
yunoball-eval

# 6. Backend + frontend
( cd apps/api && uvicorn app.main:app --reload --port 4000 )
pnpm install && pnpm dev:web         # http://localhost:3000
```

## Status

Working prototype: a **structured `QuerySpec` query engine** (rules +
LLM function-call → deterministic SQL, fuzzy entity resolution, two-tier cache,
templated narration, ≤1 LLM call) over a **real local warehouse** (nflverse
2022–2024). Includes ingest + eval harness, pg_trgm fuzzy entity resolution,
charts + leaderboards + shareable answer pages, and a Redis/Postgres cache. The
LLM only ever emits a validated `QuerySpec` — never SQL, never statistics — so
every number is computed from a template; unsupported questions are answered
honestly rather than guessed. Everything except the LLM parse path runs
without an `OPENAI_API_KEY`; try it key-free with `./scripts/demo.sh`. Full
1999–present backfill is a one-command widening of `--years` (or `--all`). See
the roadmap in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
