# Deployment

Recommended topology: **frontend on Vercel**, **API on a persistent Node host**
(Render/Fly), **Postgres on Supabase**.

```
Vercel (Next.js)  ──►  Express API (Render / Fly)  ──►  Supabase Postgres
```

## 1. Frontend → Vercel

The Next.js app lives in `apps/web` (pnpm monorepo).

1. New Vercel Project → import this repo.
2. Set **Root Directory** to `apps/web`. Vercel detects Next.js and the pnpm
   workspace automatically; `apps/web/vercel.json` pins the framework/commands.
3. Environment variable:
   - `NEXT_PUBLIC_API_URL` → your deployed API origin (e.g. `https://yunoball-api.onrender.com`).
4. Deploy. That's the whole frontend.

## 2. API → persistent host

The API keeps a warm connection pool and an in-process answer cache, so a
**persistent container** is the right shape.

**Render** — `render.yaml` (repo root):
1. Render → New → **Blueprint** → point at this repo.
2. Set `DATABASE_URL`, `READONLY_DATABASE_URL` and `CORS_ORIGINS` in the
   dashboard — they are `sync:false` so they never land in git.

Any other Node host works the same way:

```bash
pnpm install --frozen-lockfile
DATABASE_URL=... pnpm --filter @yunoball/server start
```

Env vars (same everywhere):
- `DATABASE_URL` → Supabase **pooled** connection (`...pooler.supabase.com:6543/...`).
- `READONLY_DATABASE_URL` → a read-only role (recommended; falls back to `DATABASE_URL`).
- `CORS_ORIGINS` → comma-separated allowed origins (the Vercel URL).
- `RATE_LIMIT_PER_MINUTE` → per-IP cap on the search/agent endpoints (default 30).

## 3. Database → Supabase

1. Create a Supabase project; grab the pooled connection string.
2. Apply the schema and load data (from a host with open egress to GitHub
   release assets):
   ```bash
   DATABASE_URL=... pnpm db:migrate
   DATABASE_URL=... pnpm ingest:nfl --all
   ```

## Environment variables (summary)

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | web | API origin the browser calls |
| `DATABASE_URL` | api | Supabase pooled connection |
| `READONLY_DATABASE_URL` | api | read-only role for engine-executed SQL (optional) |
| `CORS_ORIGINS` | api | allowed browser origins |
| `RATE_LIMIT_PER_MINUTE` | api | per-IP cap on search/agent (0 disables) |
