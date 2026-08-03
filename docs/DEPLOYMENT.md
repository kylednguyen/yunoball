# Deployment

Recommended topology: **frontend on Vercel**, **API on a persistent Node host**
(Render/Fly), **Postgres on Supabase**.

```
Vercel (Next.js)  ──►  Express API (Render / Fly)  ──►  Supabase Postgres
```

<!-- figure: deploy-topology -->

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
**persistent service** is the right shape (not serverless functions). Render
builds the root `Dockerfile` (`runtime: docker` in `render.yaml`) and runs the
container.

The code already handles the two things hosts need: it binds Render's injected
`$PORT`, and it enables TLS automatically for any non-localhost database host —
encrypted, but *unverified* until you supply the provider CA (`DATABASE_CA_CERT`
as PEM, or `DATABASE_CA_CERT_FILE` as a path). The server logs a warning while
it is falling back, because an unverified channel is still MITM-able.

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
4. **Apply** → Render builds the root `Dockerfile` and starts the container.
   Watch **Logs** for `YunoBall API up on :<port>`; the `/ready` check must go
   green (it verifies Postgres is reachable).
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
- `READ_RATE_LIMIT_PER_MINUTE` → separate, more generous per-IP cap on the GET
  data endpoints (default 120) — one home-page load fires several of them, so
  reads and writes get their own buckets rather than starving each other.

## 3. Database → Supabase

1. Create a Supabase project; grab the pooled connection string.
2. Apply the schema and load data (from a host with open egress to GitHub
   release assets):
   ```bash
   DATABASE_URL=... pnpm db:migrate
   DATABASE_URL=... pnpm ingest:nfl --all
   DATABASE_URL=... pnpm facts:mine
   ```
   `db:migrate` applies the whole schema, `stat_facts` and `fact_of_the_day`
   included — the fact tables need no separate step. Until the first mining run
   has filled the backlog, `GET /api/facts/today` answers `fact: null` and the
   home page simply omits the fact card, so this is safe to defer.

## 4. Scheduled jobs → GitHub Actions

Two workflows keep the warehouse and the fact backlog current. Both read one
repo secret, **`INGEST_DATABASE_URL`**, and pass it as `DATABASE_URL` — it must
be a read/write connection (the API's read-only role can't write). Set it in
**Settings → Secrets and variables → Actions**.

| Job | Trigger | Runs |
|---|---|---|
| `ingest.yml` → `ingest` | Tuesdays 10:00 UTC (after MNF stats land), or manual | `pnpm ingest:nfl` |
| `facts.yml` → `mine` | `workflow_run` on a **successful** *Ingest nflverse* run, or manual | `pnpm facts:mine`, then `pnpm facts:select` |
| `facts.yml` → `select` | daily, 11:00 UTC | `pnpm facts:select` |

The two fact cadences answer to different things. Mining does full-table window
scans and only has new data to look at once the ingest lands, so it chains off
that run instead of keeping its own clock — and only on `conclusion == 'success'`,
because mining a half-loaded season produces facts about data that is about to
change. Selection is daily because *fact of the day* is a daily promise.

**Neither job is load-bearing**, which is the property to preserve if you move
this scheduling anywhere else. Selection is a pure function of the date over the
ranked backlog, so `GET /api/facts/today` computes the same answer and backfills
it on a miss; a skipped or delayed run self-heals on the next request rather than
leaving the home page on yesterday's fact. That backfill is a write, so the API's
`DATABASE_URL` role needs insert on `fact_of_the_day` — `READONLY_DATABASE_URL`
alone is not enough.

Manual runs (`workflow_dispatch`) are a **dry run unless you pass `write: true`**,
and take `probe` / `since` to scope what gets mined. Both fact jobs share one
`concurrency` group and never cancel in progress.

## 5. Generated docs

`docs/*.html` is build output: `pnpm docs:build` regenerates every page from the
markdown next to it (`docs/build.mjs`). Never hand-edit the HTML — the next build
overwrites it. The pages are deliberately self-contained (no CDN, no external
font or stylesheet), so they open straight off disk or from any static host, and
nothing in the deploy depends on them.

## Environment variables (summary)

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | web | API origin the browser calls |
| `DATABASE_URL` | api | Supabase pooled connection; also the role that backfills `fact_of_the_day` |
| `READONLY_DATABASE_URL` | api | read-only role for engine-executed SQL and API reads (optional) |
| `DATABASE_CA_CERT` / `_FILE` | api | provider CA (PEM / path) for *verified* TLS; without it the connection is encrypted but unverified |
| `CORS_ORIGINS` | api | allowed browser origins |
| `RATE_LIMIT_PER_MINUTE` | api | per-IP cap on search/agent (default 30, 0 disables) |
| `READ_RATE_LIMIT_PER_MINUTE` | api | per-IP cap on the GET data endpoints (default 120, 0 disables) |
| `ANSWER_CACHE_TTL_SECONDS` | api | TTL for the in-process answer cache (default 86400) |
| `TRUST_PROXY_HOPS` | api | proxy hops in front of the API (default 1; drives `req.ip` for the rate limiter) |
| `LOG_LEVEL` | api | pino level (default `info`) |
| `PORT` / `API_PORT` | api | bind port — the host injects `PORT`; `API_PORT` is the local override (default 4000) |
| `INGEST_DATABASE_URL` | GitHub Actions | read/write connection the ingest and fact jobs pass as `DATABASE_URL` |
