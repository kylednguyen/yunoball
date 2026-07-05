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

## 2. API → persistent host (recommended)

The API keeps a warm connection pool and streams responses, so a **persistent
container** beats serverless. One-click configs are included:

**Render** — `render.yaml` (repo root) provisions the API + a managed Redis:
1. Render → New → **Blueprint** → point at this repo.
2. Set `DATABASE_URL`, `READONLY_DATABASE_URL` (and optionally `OPENAI_API_KEY`)
   in the dashboard — they are `sync:false` so they never land in git.
3. `REDIS_URL` is wired automatically from the blueprint's key-value service.

**Fly.io** — `apps/api/Dockerfile` + `apps/api/fly.toml`:
```bash
cd apps/api
fly launch --no-deploy
fly secrets set DATABASE_URL=... READONLY_DATABASE_URL=... OPENAI_API_KEY=...
fly deploy
```

Then set the frontend's `NEXT_PUBLIC_API_URL` to the API's URL.

Env vars (same everywhere):
- `DATABASE_URL` → Supabase **pooled** connection (`...pooler.supabase.com:6543/...`).
  The app strips the `pgbouncer` param and disables prepared statements
  automatically for transaction pooling.
- `READONLY_DATABASE_URL` → a read-only role (recommended; falls back to `DATABASE_URL`).
- `REDIS_URL` → optional; caching degrades gracefully without it.
- `OPENAI_API_KEY` → enables the LLM path. **Leave unset** to run the rule-based
  engine against your Postgres — real data, zero LLM cost.

## 2b. API → Vercel (Python serverless) — optional

`apps/api` also ships `vercel.json` + `api/index.py` + `requirements.txt` for
Vercel's Python runtime, if you want everything on one platform. Root Directory
= `apps/api`; same env vars. Serverless has **no disk** (no SQLite demo) and
adds cold starts + connection churn, so always use the **pooled** Supabase URL —
prefer the persistent host above for steady traffic.

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
