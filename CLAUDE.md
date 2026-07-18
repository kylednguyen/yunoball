# YunoBall — agent instructions

Monorepo: `apps/web` (Next.js 15 app-router UI), `apps/server` (Express/TS
API + rule-based query engine + nflverse ingest), `packages/types` (shared
wire types), Postgres warehouse (Docker :5433 local, Supabase prod). All
numbers computed from nflverse data.

## The rule

**Before making any change, open [docs/ENGINEERING.md](docs/ENGINEERING.md)
and follow its routing table.** It routes each change type to its canonical
doc — [design-language.md](docs/design-language.md) for anything visual,
[components.md](docs/components.md) for components,
[ARCHITECTURE.md](docs/ARCHITECTURE.md) / [DEPLOYMENT.md](docs/DEPLOYMENT.md)
for structure and deploys — and holds the engine, ingest, and wire-type rules
inline. Consult the routed doc before editing; if your change conflicts with
it, apply the change AND update the doc in the same commit. A canonical doc
that drifts is worse than no doc.

## Hard invariants (the ones that break things)

- **Never run `next build` while the dev server is running** — corrupts `.next`.
- **Never a wrong number**: the engine refuses what it can't answer precisely
  (see the engine rules in ENGINEERING.md before touching `src/engine/`).
- **nflverse only** for data; never scrape Pro-Football-Reference.
- Wire-format changes touch server + `packages/types` + web **together**.
- Style only with tokens/`yb-*` classes; team colors only via `teamTheme()`.

Everything else — commands, verification battery, conventions, doc
maintenance — is in [docs/ENGINEERING.md](docs/ENGINEERING.md).
