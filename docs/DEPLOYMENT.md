# Deployment

Three managed pieces, no servers to babysit:

```
Vercel (Next.js web)  ──►  Vercel (FastAPI, Python functions)  ──►  Supabase Postgres
GitHub Actions  ──────────────  scheduled in-season ingest  ──────────►┘
```

- **Vercel** hosts both apps as two projects from this one repo.
- **Supabase** is the warehouse (Postgres + `pg_trgm`).
- **GitHub Actions** runs the weekly data refresh — ingest is a job, not a server.
- **Redis (Upstash)** is optional; the cache degrades gracefully to in-process.

## 1. Database → Supabase

1. Create a Supabase project. Grab both connection strings:
   - **pooled** (`...pooler.supabase.com:6543/...?pgbouncer=true`) → runtime
   - **direct** (`...pooler.supabase.com:5432/...`) → migrations + ingest
2. Apply the schema and provision the read-only role:
   ```bash
   pip install -e packages/db -e packages/ingest -e apps/api
   cd packages/db && DIRECT_DATABASE_URL=<direct> alembic upgrade head
   DIRECT_DATABASE_URL=<direct> yunoball-provision-readonly
   ```
3. Load data (run from a machine with open egress; nflverse hosts are blocked
   from some CI networks):
   ```bash
   DIRECT_DATABASE_URL=<direct> yunoball-ingest --all     # 1999 → present
   DIRECT_DATABASE_URL=<direct> yunoball-seed-rag         # entity aliases
   ```

## 2. API → Vercel (Python functions)

`apps/api` ships `vercel.json` + `api/index.py` + `requirements.txt` for
Vercel's Python runtime.

1. Vercel → **New Project** → import this repo.
2. **Root Directory:** `apps/api`.
3. Environment variables:
   - `DATABASE_URL` → the **pooled** Supabase URL (the app strips the
     `pgbouncer` param and disables prepared statements automatically).
   - `READONLY_DATABASE_URL` → the read-only role (recommended).
   - `OPENAI_API_KEY` → optional; enables the long-tail LLM parse. Leave unset
     to run the rule-based engine — real data, zero LLM cost.
   - `REDIS_URL` → optional (Upstash).
   - `CORS_ORIGINS` → your web origin, e.g. `["https://yunoball.vercel.app"]`.
4. Deploy → note the API origin (e.g. `https://yunoball-api.vercel.app`).

Serverless has no persistent disk, so the SQLite demo mode does not apply here —
always set `DATABASE_URL`.

## 3. Web → Vercel (Next.js)

1. Vercel → **New Project** → import the same repo again.
2. **Root Directory:** `apps/web` (pnpm workspace is detected automatically).
3. Environment variable: `NEXT_PUBLIC_API_URL` → the API origin from step 2.
4. Deploy.

## 4. In-season updates → GitHub Actions

`.github/workflows/update-data.yml` refreshes the current season every Tuesday
during the season (idempotent upsert — never duplicates). One setup step:

- Repo → Settings → Secrets and variables → Actions → add
  **`DIRECT_DATABASE_URL`** = the direct Supabase connection.

You can also trigger it manually (workflow_dispatch) with a specific season.

## Environment variables (summary)

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | web | API origin the browser calls |
| `DATABASE_URL` | api | Supabase pooled connection |
| `READONLY_DATABASE_URL` | api | read-only role that executes query SQL |
| `CORS_ORIGINS` | api | allowed web origins (JSON list) |
| `REDIS_URL` | api | Upstash cache (optional) |
| `OPENAI_API_KEY` | api | LLM parse path (optional) |
| `DIRECT_DATABASE_URL` | GitHub secret | migrations + scheduled ingest |

## Local one-command demo (no accounts)

```bash
./scripts/demo.sh   # SQLite + rule-based engine, http://localhost:4000
```
