# YunoBall — agent instructions

Monorepo: `apps/web` (Next.js 15 app-router UI), `apps/server` (Express/TS
API + rule-based query engine + nflverse ingest), `packages/types` (shared
wire types), Postgres warehouse (Docker :5432 local, Supabase prod). All
numbers computed from nflverse data.

## The rule

**Before making any change, open its canonical doc and follow it.** If your
change conflicts with that doc, apply the change AND update the doc in the
same commit. A canonical doc that drifts is worse than no doc.

| Change | Canonical doc |
|---|---|
| Engine, ingest, wire contract, config | [docs/TDD.md](docs/TDD.md) |
| System structure | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Schema | [docs/BACKEND_SCHEMA.md](docs/BACKEND_SCHEMA.md) |
| Deploys | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Anything visual / design language | [docs/DESIGN_BRIEF.md](docs/DESIGN_BRIEF.md) |
| Component inventory | [docs/FRONTEND_SPEC.md](docs/FRONTEND_SPEC.md) |
| Roadmap, sequencing | [docs/ENGINEERING_PLAN.md](docs/ENGINEERING_PLAN.md) |
| Product scope | [docs/PRD.md](docs/PRD.md), [docs/PRD_MOBILE.md](docs/PRD_MOBILE.md) |

`apps/web/app/globals.css` wins on token *values*; the design docs give intent.

## Hard invariants (the ones that break things)

- **Never run `next build` while the dev server is running** — corrupts `.next`.
- **Never a wrong number**: the engine refuses what it can't answer precisely
  (read TDD.md §4 before touching `apps/server/src/engine/`).
- **nflverse only** for data; never scrape Pro-Football-Reference.
- Wire-format changes touch server + `packages/types` + web **together**.
- Style only with tokens/`yb-*` classes; team colors only via `teamTheme()`.

## Verification battery

`pnpm typecheck` · `pnpm lint` · `pnpm knip` ·
`pnpm --filter @yunoball/server test` (vitest, needs the Docker Postgres) ·
`pnpm e2e` (Playwright). CI runs all of it, plus a real nflverse ingest —
[.github/workflows/ci.yml](.github/workflows/ci.yml).
