# @yunoball/api

FastAPI backend — the natural-language → SQL query pipeline over the NFL warehouse.

## Pipeline

Structured-first — the common path never touches raw SQL and often skips the LLM:

```
L1 cache (text/semantic)
 → resolve (fuzzy name → player_id)
 → parse to QuerySpec (rules fast-path; else LLM function-call)
 → validate (allowlisted stat, bounded params)
 → L2 cache (spec key)
 → build (deterministic template, bound params)
 → execute (read-only, timeout)
 → narrate (templated — no 2nd LLM call)
 └ fallback: raw NL→SQL → sqlglot guard → execute → LLM narrate
```

- **`app/query/`** — `spec.py` (QuerySpec), `build.py` (SQL builder + narration),
  `parse_rules.py` (rules), `parse_llm.py` (LLM function-call + JSON validation).
- **`app/pipeline/`** — orchestration, `resolve.py` (fuzzy entities), `execute.py`.
- The structured path needs **no SQL guard** (SQL is templated with bound params);
  `guard_sql` (sqlglot) only guards the raw-SQL fallback.

## Run modes

The app auto-selects on two independent axes (see `config.py`):

- **LLM**: rule-based when no `OPENAI_API_KEY` (or `DEMO=1`), else OpenAI.
- **DB**: seeded SQLite when no `DATABASE_URL`, else Postgres.

So a real Postgres with **no** OpenAI key runs the rule-based engine over real
data at zero LLM cost.

- **Demo** (no key, no DB): SQLite + rule-based + seeded data; serves a test UI at `/`.
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
