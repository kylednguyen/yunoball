# YunoBall API — Express backend over Postgres.
#
# The server runs its TypeScript source directly via tsx (a runtime dependency),
# so there is no compile step; the image just needs a prod install plus source.
# @yunoball/types is a raw-TS workspace package resolved through pnpm's symlinks.
#
#   docker build -t yunoball-api .
#   docker run -p 4000:4000 -e DATABASE_URL=... yunoball-api
#
# On Render this is driven by render.yaml (runtime: docker). The app binds the
# injected $PORT and enables TLS automatically for any non-localhost DB host.
FROM node:22-slim

# Corepack activates the pnpm version pinned in package.json (packageManager).
RUN corepack enable
WORKDIR /app

# Prod-only from the start: skips typescript/vitest/pino-pretty/@types, keeps
# tsx/express/pg/pino/cors/zod/dotenv and the @yunoball/types workspace link.
ENV NODE_ENV=production

# Manifest layer first so the install caches across source-only changes.
# --frozen-lockfile validates every workspace package.json against the lockfile,
# so all four must be present even though we only install the server's subtree.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile --prod --filter @yunoball/server...

# Source (node_modules is excluded via .dockerignore, so the install survives).
COPY . .

# Documentation only; Render injects and expects $PORT. Local default is 4000.
EXPOSE 4000

# Liveness/readiness: /ready confirms Postgres is reachable (see app.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Drop root — the app never writes to the filesystem (logs to stdout, cache in PG).
USER node

CMD ["pnpm", "--filter", "@yunoball/server", "start"]
