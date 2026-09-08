# YunoBall — agent instructions

Monorepo: `apps/web` (Next.js 15 app-router UI), `apps/server` (Express/TS
API + rule-based query engine + nflverse ingest), `packages/types` (shared
wire types), Postgres warehouse (Docker :5433 local, Supabase prod). All
numbers computed from nflverse data.

## The rule

**Before making any change, open the doc that owns it.** Consult it before
editing; if your change conflicts with it, apply the change AND update the doc
in the same commit. A canonical doc that drifts is worse than no doc.

| Changing…                              | Read first                                       |
| -------------------------------------- | ------------------------------------------------ |
| Anything visual (tokens, `yb-*`, CSS)  | [docs/DESIGN_BRIEF.md](docs/DESIGN_BRIEF.md)     |
| Components and page composition        | [docs/FRONTEND_SPEC.md](docs/FRONTEND_SPEC.md)   |
| Routes, navigation, page flow          | [docs/APP_FLOW.md](docs/APP_FLOW.md)             |
| Engine (`src/engine/`), parsing, SQL   | [docs/TDD.md](docs/TDD.md)                       |
| Schema, ingest, warehouse tables       | [docs/BACKEND_SCHEMA.md](docs/BACKEND_SCHEMA.md) |
| Structure, module boundaries           | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     |
| Deploys, hosting, env                  | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)         |
| Play-by-play, the field view, live data | [docs/PLAY_VIEW.md](docs/PLAY_VIEW.md)          |
| Scope, product decisions               | [docs/PRD.md](docs/PRD.md)                       |

## Hard invariants (the ones that break things)

- **Never run `next build` while the dev server is running** — corrupts `.next`.
- **Never a wrong number**: the engine refuses what it can't answer precisely
  (see the engine rules in ENGINEERING.md before touching `src/engine/`).
- **nflverse only** for data; never scrape Pro-Football-Reference.
- Wire-format changes touch server + `packages/types` + web **together**.
- Style only with tokens/`yb-*` classes; team colors only via `teamTheme()`.

## Verification battery

Green before every commit. The e2e suite needs the local stack up (`docker
compose up -d`, `pnpm db:migrate`, then an ingest) — CI runs the same battery
plus a real nflverse ingest.

```bash
pnpm typecheck
pnpm lint
pnpm knip
pnpm --filter @yunoball/server test
pnpm e2e                # Playwright, boots both dev servers itself
pnpm build:web          # never while a dev server is running
```
