# Deployment

Recommended topology: **frontend on Vercel**, **API on a persistent Node host**
(Render/Fly), **Postgres on Supabase**, **data loaded by GitHub Actions**.

```
Vercel (Next.js)  ──►  Express API (Render / Fly)  ──►  Supabase Postgres
                                                            ▲
                       GitHub Actions: ingest.yml (Tuesdays) ┘
```

## 0. The order that works

Each piece depends on the one before it, so a first deploy goes in this
order and nothing else:

1. **Database** — create the Supabase project, apply the schema, load data.
2. **API** — deploy it against that database; wait for `/ready` to go green.
3. **Frontend** — build it with the API's origin baked in.
4. **Ingest job** — give the workflow the database secret so Tuesdays keep
   the warehouse current.

Doing 3 before 2 ships a frontend with no API; doing 2 before 1 gives an API
whose `/ready` never passes (it checks Postgres).

## 1. Database → Supabase

1. Create a Supabase project. Under **Connect**, copy the **session pooler**
   string (port **5432**). Not the transaction pooler on 6543 — that is for
   serverless and drops the session features the persistent API relies on.
2. From any machine with open egress to GitHub release assets (nflverse
   publishes there):
   ```bash
   DATABASE_URL=... pnpm db:migrate        # idempotent; safe to re-run
   DATABASE_URL=... pnpm ingest:nfl --all  # 1999 → now, ~16 min incl. plays
   ```
   `--all` skips any season nflverse hasn't published yet (the current one,
   before its first games) and says so; every season missing is an error.
3. Optional but recommended: a read-only role for the engine's SQL.
   ```sql
   CREATE ROLE yunoball_ro LOGIN PASSWORD '...';
   GRANT CONNECT ON DATABASE postgres TO yunoball_ro;
   GRANT USAGE ON SCHEMA public TO yunoball_ro;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO yunoball_ro;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO yunoball_ro;
   ```
   Its session-pooler string becomes `READONLY_DATABASE_URL`.

## 2. API → Render (persistent Node service)

The API keeps a warm connection pool and an in-process answer cache, so a
**persistent service** is the right shape (not serverless functions). Render
builds the root `Dockerfile` (`runtime: docker` in `render.yaml`) and runs the
container. The code binds Render's injected `$PORT` and enables TLS for any
non-localhost database host.

1. Render → **New → Blueprint** → this repo. Render reads `render.yaml` and
   provisions `yunoball-api`.
2. Fill the `sync:false` secrets when prompted (they never live in git):
   - `DATABASE_URL` → the Supabase **session pooler** string from step 1.
   - `READONLY_DATABASE_URL` → the read-only role's string (blank falls back
     to `DATABASE_URL`).
   - `CORS_ORIGINS` → the Vercel origin, e.g. `https://<project>.vercel.app`
     (comma-separate a custom domain).
3. **Apply.** Watch **Logs** for `YunoBall API up on :<port>`. The health
   check is `/ready`, which verifies Postgres is reachable — a green check
   means the database secret is right, not just that the process started.
4. Copy the service URL. It is `NEXT_PUBLIC_API_URL` for Vercel and must
   appear in `CORS_ORIGINS`.

> Render's **free** plan sleeps after ~15 min idle → a ~50 s cold start on
> the next request. Use **Starter** for anything user-facing.

Any other Node host works the same way:

```bash
pnpm install --frozen-lockfile
DATABASE_URL=... pnpm --filter @yunoball/server start
```

## 3. Frontend → Vercel

1. New Vercel Project → import this repo. **Root Directory** = `apps/web`;
   `apps/web/vercel.json` pins the framework and commands.
2. Environment variable: `NEXT_PUBLIC_API_URL` → the API origin from step 2.
   It is inlined at **build** time; the build refuses to run without it, on
   purpose — a production build that fell back to localhost would be an
   invisible, total outage. Changing it means redeploying.
3. Deploy. Add the Vercel URL to the API's `CORS_ORIGINS` if it isn't there.

## 4. Keeping the data current → GitHub Actions

`.github/workflows/ingest.yml` runs every Tuesday 10:00 UTC (after Monday
Night Football lands in nflverse) and can be dispatched by hand with a
season. It needs one repository secret:

- `INGEST_DATABASE_URL` → the **read-write** session-pooler string.

Each run applies the schema first, then `pnpm ingest:nfl --current` — the
season in progress. nflverse republishes a season's files all season (new
weeks, stat corrections), and the runner has no download cache, so every run
reads the current release. A finished game's plays appear on the run after
nflverse publishes them; the game page says "No play-by-play yet" until then.

The API's hot answer cache lives 1 hour (`ANSWER_CACHE_TTL_SECONDS`),
deliberately shorter than the gap between ingests, so new data reaches
answers within the hour without a restart.

## 5. CI

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | What it proves |
|---|---|
| `server-tests` | typecheck, lint, knip, and the server suite against a service Postgres |
| `web-e2e` | schema + a real full-history ingest, then Playwright against the **production build** of the web app served by `next start` — the artifact users get, not `next dev` |
| `web-build` | the web app builds with a build-time API origin |

The e2e job is the long one (~13 min: ~5 min of ingest, plays for one
season, a build, and 30-odd browser specs). It runs the API with the
per-IP rate limiter off, because one suite from one address exceeds the
30/min cap the limiter exists for.

## Environment variables (summary)

| Var | Where | Purpose | Default |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | web (build time) | API origin the browser calls | — (build fails) |
| `DATABASE_URL` | api, ingest | Supabase session pooler, read-write | — |
| `READONLY_DATABASE_URL` | api | read-only role for engine SQL | falls back to `DATABASE_URL` |
| `DATABASE_CA_CERT` / `_FILE` | api | provider CA for verified TLS | encrypted, unverified |
| `CORS_ORIGINS` | api | allowed browser origins | `http://localhost:3000` |
| `TRUST_PROXY_HOPS` | api | proxies in front of the API (Render = 1) | 1 |
| `RATE_LIMIT_PER_MINUTE` | api | per-IP cap on search/agent (0 disables) | 30 |
| `READ_RATE_LIMIT_PER_MINUTE` | api | per-IP cap on data GETs (0 disables) | 120 |
| `ANSWER_CACHE_TTL_SECONDS` | api | hot answer-cache TTL | 3600 |
| `LOG_LEVEL` | api, ingest | pino level | info |
| `INGEST_DATABASE_URL` | GitHub secret | the weekly ingest's database | — |
| `INGEST_CACHE_DIR` | ingest | where nflverse downloads land | `~/.cache/yunoball-ingest` |

## Checking a deploy

```bash
curl https://<api>/health          # {"ok":true}            — the process is up
curl https://<api>/ready           # {"ok":true,"db":"up"}  — Postgres is reachable
curl https://<api>/api/standings   # season should be the newest with played games
curl -X POST https://<api>/api/search -H 'content-type: application/json' \
  -d '{"question":"who threw for the most yards"}'   # a real leader, not "no results"
```

If `/api/standings` answers with a season of 0-0 records, the ingest loaded a
schedule but no results — re-run it and read its log; if search answers "no
matching results" for a loaded season, the hot cache is older than the data
and will roll over within the hour.
