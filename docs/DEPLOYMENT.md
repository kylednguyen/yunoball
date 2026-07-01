# Deployment

Recommended topology: **frontend on Vercel**, **API on Vercel Python functions
(or a persistent host)**, **Postgres on Supabase**, **Redis on Upstash**.

```
Vercel (Next.js)  ──►  API (Vercel Python / Render / Fly)  ──►  Supabase Postgres
                                          └──►  Upstash Redis (cache)
```

## 1. Frontend → Vercel

The Next.js app lives in `apps/web` (pnpm monorepo).

1. New Vercel Project → import this repo.
2. Set **Root Directory** to `apps/web`. Vercel detects Next.js and the pnpm
   workspace automatically; `apps/web/vercel.json` pins the framework/commands.
3. Environment variable:
   - `NEXT_PUBLIC_API_URL` → your deployed API origin (e.g. `https://yunoball-api.vercel.app`).
4. Deploy. That's the whole frontend.

## 2. API → Vercel (Python serverless) — optional

`apps/api` ships `vercel.json` + `api/index.py` exposing the FastAPI ASGI app,
and `requirements.txt` for Vercel's Python runtime.

1. New Vercel Project from the same repo → **Root Directory** = `apps/api`.
2. Environment variables (serverless has **no disk**, so the SQLite demo cannot
   run here — a Postgres URL is required):
   - `DATABASE_URL` → Supabase **pooled** connection (`...pooler.supabase.com:6543/...`).
     The app strips the `pgbouncer` param and disables prepared statements
     automatically for transaction pooling.
   - `READONLY_DATABASE_URL` → a read-only role (recommended; falls back to
     `DATABASE_URL`).
   - `REDIS_URL` → Upstash Redis URL (optional; caching degrades gracefully).
   - `OPENAI_API_KEY` → enables the LLM path. **Leave unset** to run the
     rule-based engine against your Postgres — real data, zero LLM cost.
3. Set the frontend's `NEXT_PUBLIC_API_URL` to this project's URL.

> Serverless trade-offs: cold starts, and connection churn against Postgres.
> Always use the **pooled** Supabase URL here. For steady traffic or long-lived
> pools, a persistent host (Render / Fly / Railway) is often a better fit — same
> `uvicorn app.main:app` command, same env vars.

## 3. Database → Supabase

1. Create a Supabase project; grab the pooled + direct connection strings.
2. Apply the schema from `packages/db`:
   ```bash
   pip install -e . && DIRECT_DATABASE_URL=... alembic upgrade head
   ```
3. Load data (from a host with open egress — see `packages/ingest`):
   ```bash
   DIRECT_DATABASE_URL=... yunoball-ingest --all --skip plays
   ```

## Environment variables (summary)

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | web | API origin the browser calls |
| `DATABASE_URL` | api | Supabase pooled connection |
| `READONLY_DATABASE_URL` | api | read-only role for generated SQL |
| `REDIS_URL` | api | Upstash cache (optional) |
| `OPENAI_API_KEY` | api | LLM path (optional; rule-based works without) |

## Local one-command demo (no accounts)

```bash
./scripts/demo.sh   # SQLite + rule-based engine, http://localhost:4000
```
