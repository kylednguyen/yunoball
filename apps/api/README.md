# @yunoball/api

FastAPI backend — the natural-language → SQL query pipeline over the NFL warehouse.

## Pipeline

```
cache → resolve_entities → retrieve_context → generate_sql
      → guard_sql → execute_sql → narrate
```

`guard_sql` (sqlglot) enforces a single read-only SELECT over an allowlist of
tables with a forced LIMIT — defense-in-depth on top of the read-only DB role.

## Run modes

The app auto-selects based on the environment:

- **Demo** (no `OPENAI_API_KEY`, or `DEMO=1`): SQLite + rule-based NL→SQL +
  seeded sample data. Seeds on startup; serves a test UI at `/`.
- **Production**: Postgres + pgvector (`DATABASE_URL`), OpenAI, Redis.

## Run

```bash
# demo (from repo root)
./scripts/demo.sh

# or directly
cd apps/api
pip install fastapi "uvicorn[standard]" sqlalchemy pydantic-settings sqlglot
DEMO=1 uvicorn app.main:app --port 4000

# production (also: pip install -e ../../packages/db, plus openai redis psycopg)
pip install -e . && pip install -e ../../packages/db
uvicorn app.main:app --port 4000
```

## Test

```bash
cd apps/api && pip install pytest && DEMO=1 pytest
```

## Eval

A golden question→answer set measures **parse accuracy** (right `QuerySpec`) and
**execution accuracy** (right top answer) through the real pipeline against the
seed data — no API key needed. It gates CI (`tests/test_eval.py`) and prints a
report:

```bash
DEMO=1 python -m app.eval
```

Add cases in `app/eval/golden.json`. Point at a real Postgres (with a matching
golden set) to measure the LLM path.
