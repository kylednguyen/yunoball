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

## 2. API → Render (persistent Node service)

The API keeps a warm connection pool and an in-process answer cache, so a
**persistent Node service** is the right shape (not serverless functions, not a
container — Render's native `node` runtime runs it straight from `render.yaml`).

The code already handles the two things hosts need: it binds Render's injected
`$PORT`, and it enables TLS automatically for any non-localhost database host.

**Steps (Render dashboard):**
1. Push this branch to GitHub.
2. Render → **New → Blueprint** → pick this repo. Render reads `render.yaml`
   and provisions the `yunoball-api` web service.
3. Fill the three `sync:false` secrets when prompted (they never live in git):
   - `DATABASE_URL` → Supabase **session pooler** string, port **5432**
     (Supabase → Connect → *Session pooler*). **Not** the 6543 transaction
     pooler — that's for serverless and drops session features.
   - `READONLY_DATABASE_URL` → a read-only role's session-pooler string
     (recommended; leave blank to fall back to `DATABASE_URL`).
   - `CORS_ORIGINS` → your Vercel origin, e.g. `https://<project>.vercel.app`
     (comma-separate to allow more, e.g. a custom domain).
4. **Apply** → first build runs `pnpm install --frozen-lockfile`, start runs
   `pnpm --filter @yunoball/server start`. Watch **Logs** for
   `YunoBall API up on :<port>`; the `/health` check must go green.
5. Copy the service URL (`https://yunoball-api.onrender.com`) — it's the
   `NEXT_PUBLIC_API_URL` for Vercel (step 1) and must appear in `CORS_ORIGINS`.

> ⚠️ Render's **free** plan sleeps after ~15 min idle → a ~50s cold start on the
> next request. Use the **Starter** plan for anything user-facing.

Any other Node host works the same way — just provide the env vars and run:

```bash
pnpm install --frozen-lockfile
DATABASE_URL=... pnpm --filter @yunoball/server start
```

Env vars (same everywhere):
- `DATABASE_URL` → Supabase **session pooler** connection (`...pooler.supabase.com:5432/...`).
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
