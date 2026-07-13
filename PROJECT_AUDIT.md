# YunoBall — Project Audit & Living Engineering Log

**Originated:** 2026-07-13 · **Baseline commit:** `c253ec4` (main) · **Method:** full code read of all three workspaces plus empirical verification — every quality gate was executed locally against a real Postgres warehouse with the 2023 and 2024 seasons ingested from nflverse, and CI history was pulled from GitHub. Findings are marked **[verified]** when demonstrated by execution, otherwise they come from direct code reading with file:line references.

> **This document is the single source of truth and the canonical backlog.** The
> ranked findings (§4–§17) are the issue list; the **Remediation Status Ledger**,
> **Validation History**, **Engineering Decisions**, and **Changelog** below are
> updated as work lands so the audit stays an accurate reflection of the project.

---

## Remediation Status Ledger

Issue IDs (C#, H#, M#, L#) refer to the ranked refactors in §16.

### ✅ Completed

| ID | Issue | Landed | Evidence |
|---|---|---|---|
| **C2** | Working lint across the monorepo | Batch 1 | ESLint 9 flat config (`eslint.config.mjs`) + `lint` scripts in all 3 workspaces; `pnpm lint` green (was: unrunnable). Fixed the real violations it surfaced (dead `outcome()`, 3 unused imports, raw `<a>` in `error.tsx`). |
| **C1** | CI e2e restored to green | Batch 1 | `ci.yml` ingests `--years 2023 2024`; 3 stale/data-coupled specs re-pinned to verified reality. Full suite **13/13 local** (was 10/13 failing as CI ran it). |
| **C6** | Pool error handler + query/connect timeouts | Batch 1 | `pool.on("error")` on both pools; `connectionTimeoutMillis`; statement caps (RO 15s / RW 120s). Server 287 tests still green. |
| **H1** | Verified DB TLS (CA pinning) | Batch 1 | `DATABASE_CA_CERT`/`_FILE` → `rejectUnauthorized:true`; unverified fallback now logs a loud warning instead of being silent. |
| **C7** | Guard `NEXT_PUBLIC_API_URL` | Batch 1 | Prod build now **fails loudly** when unset (verified: "Refusing to ship a localhost API URL") instead of shipping localhost. |
| **H9** | Timeouts on `ask()`/`askAgent()` POSTs | Batch 1 | `AbortSignal.timeout(30s)`; `friendlyError` already translates the abort. |
| **H11** | Aligned local ports to 5432 | Batch 1 | `.env.example`, `ingest.test.ts` default → 5432 (compose default); quick start now works on a fresh clone. New env vars + `TRUST_PROXY_HOPS` documented. |
| **C3** | Compare no longer substitutes fantasy points | Batch 2 | `compareValueExpr` computes the requested stat (ratio/formula/computed) from each side's box-score totals and orders/narrates on it; non-comparable advanced stats are refused, not mis-answered. Verified live: completion % 67.3% vs 65.2% (leader correctly flips to Mahomes), passer rating, yards/carry, total TDs all correct; passing-EPA refused. +2 regression tests. |
| **H6** | Ratio thresholds compare the ratio, not the numerator | Batch 2 | `gameCountSql` and `playerStreakSql` use `ratioRowExpr` for ratio stats ("games over 5 yards per carry" now means YPC > 5, not rushing yards > 5). |
| **C4** | Capability gate + `buildSql`×`EXPLAIN` sweep test | Batch 2 | New `statComputableFor(intent, stat)` (column-availability per storage grain) drives a single pipeline gate that refuses a mis-routed stat honestly instead of emitting SQL that fails to plan. `teamStat` now computes ratio/formula stats (aggExpr); `qualifyingCount`/`playerStreak` handle passer rating. New `test/sweep.test.ts` EXPLAINs every routable intent×stat against a scratch schema (185 combos) — a permanent guard for the whole executor layer. Verified live: "chiefs completion %" → 66.3%; "rank in yards per carry" → honest refusal; "passer rating over 100" → 6 players. |

### 🟡 In Progress

| ID | Issue | Batch |
|---|---|---|
| — | (Batch 2 complete — next: Batch 3) | — |

### ⬜ Open (next up)

Batch 3 (ingest integrity: **C5**, **H8**), Batch 4 (prod hardening: **H3**, **H5**, **H7**, **H10**), Batch 5+ (Medium/Low). See §16 for the full ranked list.

> **Follow-up noted (enhancement, not a defect):** `player_rank`/`qualifying_count` currently *refuse* game-only-ratio stats (yards per carry, catch rate) at season/career scope, because those denominators (carries, targets) live only in the game log. A future upgrade could route those two executors through the game log — as `leaders` already does — to answer them instead of refusing. Tracked as **M11**.

---

## Validation History

| Date | Batch | build | typecheck | lint | unit | e2e | Notes |
|---|---|---|---|---|---|---|---|
| 2026-07-13 | Baseline | ✅ web | ✅ | ❌ unrunnable | ✅ 287 | ❌ 10/13 fail (CI red on all 4 main runs) | Audit baseline |
| 2026-07-13 | Batch 1 | ✅ web (+ C7 guard verified to fail on missing env) | ✅ 3/3 | ✅ 3/3 | ✅ 287/287 | ✅ **13/13** (2023+2024) | All gates green locally; CI steps reproduced |
| 2026-07-13 | Batch 2 (C3, H6) | ✅ web | ✅ 3/3 | ✅ 3/3 | ✅ **288/288** (+2 compare regressions) | ✅ **13/13** | Compare fix verified live across ratio/formula/computed/refusal cases |
| 2026-07-13 | Batch 2 (C4) | ✅ web | ✅ 3/3 | ✅ 3/3 | ✅ **289/289** (+ sweep: 185 combos EXPLAIN'd) | ✅ **13/13** | Capability gate verified live; every routable intent×stat plans cleanly |
| 2026-07-13 | PR #16 CI | — | — | — | — | ❌→ fix | First real CI run (PR) caught a C1 regression: the ingest CLI rejected `--years 2023 2024` (node parseArgs needs repeated flags). Fixed the CLI to accept space-separated / positional years and re-verified with the *exact* CI command. |

---

## Engineering Decisions (ADRs)

**ADR-001 — Split statement-timeout policy by pool, not a single global cap.**
The read-only pool (user-facing engine/API reads) gets a tight 15s `statement_timeout`; the read/write pool gets a generous 120s cap because ingest legitimately runs multi-second batch upserts (the 2024 `scoring_plays` step alone is ~14s of work). A single global 15s cap would have broken ingest — a regression. Both are env-tunable (`DB_STATEMENT_TIMEOUT_MS`, `DB_WRITE_STATEMENT_TIMEOUT_MS`). When no separate read-only URL is set, reads run on the RW pool and are still bounded (just at the looser cap). Rejected: forcing a second pool always (doubles connections against Supabase's free-plan limit).

**ADR-002 — TLS verification is opt-in via CA, with a loud warning otherwise.**
Pinning a CA unconditionally would break the common Supabase-pooler setup where operators haven't wired the cert yet. So verified TLS activates when `DATABASE_CA_CERT`/`DATABASE_CA_CERT_FILE` is supplied; without it the connection stays encrypted-but-unverified **and logs a warning on every boot**, converting a silent MITM exposure into a visible, actionable one. Production should always set the CA.

**ADR-003 — E2E specs assert verified real data; flakiness removed by determinism, not mocking.**
Rather than introduce a mocked data tier (a larger change), the three failing specs were re-pinned to values verified against the live 2023+2024 warehouse (e.g. Mahomes is QB #12 of 79 by 2024 PPR — so the old "QB #1 of" assertion was simply wrong), and the randomized-sample-query flake was replaced with a deterministic tabular query. The suite still exercises real end-to-end behavior. A mocked tier remains a future option (see Future Improvements).

**ADR-006 — One capability gate over storage grain, not per-executor table routing.**
The stat-bearing executors aggregate different tables (`player_season_stats`, `player_game_stats`, `player_game_advanced`), and a stat is only answerable where its columns live. Rather than teach every executor to route every stat to the right table (a large, error-prone change), a single `statComputableFor(intent, stat)` predicate — derived from each stat's referenced columns vs. each grain's column set — gates the pipeline once, right after parse: a stat an intent can't compute becomes an honest refusal, never invalid SQL. `test/sweep.test.ts` pins the invariant by EXPLAIN-planning every routable pair. The two executors that already route by grain (`leaders`, `player_total`) and `player_rank`'s advanced branch are exempted. Accepted trade: `player_rank`/`qualifying_count` refuse game-only ratios (yards per carry) instead of routing to the game log — tracked as M11.

**ADR-005 — COMPARE computes the requested stat from box-score totals; advanced pbp stats are refused, not approximated.**
COMPARE aggregates each player's box-score line (now including `carries`/`targets`) and derives the requested stat — a ratio (`num/den`), the passer-rating formula, a computed sum, or a plain column — as `cmp_value`, which drives both the leader ordering and the narration. This replaces the old `fantasy_points_ppr` fallback that silently answered ratio/formula questions with fantasy points under the requested label. Stats whose inputs don't live in the box-score aggregate (EPA, air yards, success rate, CPOE — they live in `player_game_advanced`) are **refused at parse time** rather than approximated or crashed on, keeping the "never a wrong number" contract. `isComparableStat` derives comparability from the same column-availability check, so the parser and executor can't disagree.

**ADR-004 — Lint is a real gate: errors for correctness, warnings only for documented-intentional patterns.**
The flat config keeps `typescript-eslint` recommended + Next/React-hooks rules as errors, but downgrades `no-explicit-any` to a warning (the engine's typed escape hatch is deliberate) and suppresses individual intentional cases inline with rationale (CDN `<img>`, ESPN's untyped API). The gate exits clean with zero warnings, so any *new* warning stands out instead of drowning in noise.

---

## Changelog

- **2026-07-13 — Batch 2 complete (C4):** Added a capability gate (`statComputableFor`) that refuses a stat an executor can't compute from its storage grain, turning a class of latent 500s (SUM() over an empty ratio expr; game-only columns referenced against the season rollup) into honest refusals. `teamStat` now computes ratio/formula stats; `qualifyingCount`/`playerStreak` handle passer rating. New `test/sweep.test.ts` EXPLAINs every routable intent×stat pair against a scratch schema as a permanent regression guard. 289 unit + 13 e2e green.
- **2026-07-13 — Batch 2 partial (C3, H6):** COMPARE now computes and ranks on the actual requested stat (ratio/formula/computed) from each side's box-score totals — the fantasy-points substitution that produced wrong numbers under the right label is gone; advanced pbp stats are refused rather than mis-answered. Ratio thresholds (game-count, streaks) qualify on the per-game ratio, not the raw numerator. +2 regression tests; 288 unit + 13 e2e green.
- **2026-07-13 — Batch 1 (Trust the gates):** ESLint 9 across the monorepo; CI e2e green (2023+2024 ingest + spec fixes); Postgres pool hardening (error handler, timeouts, optional CA-verified TLS); prod build guard on `NEXT_PUBLIC_API_URL`; POST-request timeouts; local ports aligned to 5432; new DB/proxy env vars documented in `.env.example`. Net: the quality gates that every other issue's Definition of Done depends on are now trustworthy.
- **2026-07-13 — Audit originated.**

---

---

## 1. Executive summary

YunoBall is an unusually well-designed prototype: a deterministic NL → `QuerySpec` → SQL engine over a curated warehouse, with a genuine "never a wrong number" architecture, injection-proof SQL construction, strong ingestion engineering, and accessibility maturity far above typical. The gaps are not in the application's ideas — they are concentrated in three places: **the quality gates are broken** (CI has never been green on main; lint cannot run), **a handful of engine corners produce wrong numbers or 500s** in exactly the untested executor layer, and **the process's edges are unhardened** (DB pool errors, timeouts, TLS verification, cache invalidation).

### Baseline state of the quality gates [verified — at origination]

> Historical snapshot at commit `c253ec4`. For current status see the
> **Remediation Status Ledger** above — Batch 1 has since made lint runnable and
> restored e2e/CI to green.

| Gate | Status | Evidence |
|---|---|---|
| `pnpm typecheck` | ✅ passes | 3/3 workspaces, strict + `noUncheckedIndexedAccess` |
| Server unit tests | ✅ 287/287 pass | engine, battery, audit, ingest suites vs scratch Postgres |
| `next build` (prod) | ✅ passes | healthy bundles, 102–118 kB first-load JS — **but CI never runs it** |
| `pnpm ingest:nfl` | ✅ works end-to-end | real 2024 + 2023 ingests, 285 games each, clean skip ledger |
| `pnpm lint` | ❌ **cannot run** | no ESLint config or dependency exists anywhere; `next lint` drops into an interactive prompt and exits 1 |
| CI on `main` | ❌ **red on all 4 recorded runs** | `server-tests` job green; `web-e2e` job fails at `pnpm e2e` every time |
| Playwright e2e | ❌ 10/13 fail as CI runs it | see decomposition below |

### Why CI is red — decomposed [verified]

The e2e suite was run locally three times to isolate causes:

1. **With 2024-only data (exactly what CI ingests): 10 of 13 tests fail.** The specs hard-assert 2023 facts (`e2e/explore.spec.ts:5` navigates `/teams?season=2023` expecting "12-5"; `e2e/search.spec.ts:8-16` expects Dak Prescott as the 2023 passing-TD leader), but `.github/workflows/ci.yml:62` ingests `--season 2024` only.
2. **With 2023+2024 loaded: 10 of 13 pass.** The 3 residual failures:
   - `explore.spec.ts:46` — the leaders UI was converted from a `<table>` to a link list by the recent UI-refresh commits, so `locator("tbody tr")` matches nothing. The Playwright page snapshot shows the *data is correct* (McCaffrey #1, 1,459 yds) — the selector is stale.
   - `explore.spec.ts:88` — strict-mode violation: the UI refresh added a second `.yb-page-sub` element on the player page.
   - `search.spec.ts:43` — asserts Drake Maye postseason stats that require seasons beyond 2023/24 in the warehouse (data-coupled, not a code bug).

**Conclusion:** the e2e suite is sound in design but was coupled to a specific warehouse state, and the last several UI PRs were merged without a green run. The "red is normal" state neutralizes CI as a signal — this is the single most corrosive issue in the repo, because every other guarantee depends on gates that people trust.

---

## 2. Architecture overview

### System shape

pnpm + turborepo monorepo, TypeScript end to end, one wire contract:

```
apps/web        Next.js 15 (App Router, React 19) — hand-rolled `yb-*` design system in globals.css
apps/server     Express 5 — routes → controllers (zod) → services → repositories
                ├── engine/   NL → QuerySpec (discriminated AST, 21 intents) → allowlisted SQL → narration
                ├── ingest/   nflverse CSVs → normalize → validate (zod) → idempotent batched upserts
                └── db/       plain schema.sql + idempotent migrate; RW pool + optional read-only pool
packages/types  shared API types, consumed as raw .ts (server via tsx, web via transpilePackages)
```

Postgres is the single stateful dependency (11-table star schema: dims `seasons/teams/players/games`, facts `player_game_stats/player_season_stats/team_game_stats/scoring_plays/player_game_advanced`, plus `draft_picks`, and two operational tables `answer_cache`/`query_audit`). Deployment: Render (API, free plan, runs under `tsx` with no build step) + Vercel (web). Local dev: docker-compose Postgres.

### The query pipeline (the product's core)

`pipeline.ts:89-244`: L1 cache (normalized text) → fuzzy entity resolution (a CPython-difflib port, parity-tested) → deterministic rule parser → **pre-SQL auditor** (DB-probing validator that catches contradictions, coverage-wall violations, Super Bowl year normalization) → L2 cache (spec key) → SQL builder (exhaustive switch over the intent union with a `never` guard) → read-only execution → templated narration → durable share row. Zero LLM calls. Questions that don't parse refuse rather than guess.

This is the right architecture for a stats product, and the honesty machinery (three-bucket outcomes: spec / tailored refusal / null; `query_audit` rows with verdict + confidence + latency) is genuinely rare.

### Key architectural decisions and their standing

| Decision | Assessment |
|---|---|
| Structured intent, never raw SQL from user input | Sound; verified injection-proof (§7) |
| Plain-SQL schema + `CREATE TABLE IF NOT EXISTS` migrate | Already leaking — see §8: schema.sql now carries duplicate DDL truth |
| In-process caches + rate limiting ("single instance by design") | Honest and documented (`ponytail:` markers), but with no invalidation story after ingest |
| Server runs under `tsx` in production | No compile gate at deploy; tsx in prod deps; slow cold boots on a sleeping free plan |
| Types package as raw `.ts` | Works today because both consumers transpile; fine while private and types-only |
| e2e against a real ingested warehouse | High-fidelity in principle; currently the broken gate (§1) |

---

## 3. Evaluation rubric (project-specific)

Generic best practices under-weight what makes *this* product live or die. The codebase is judged against these dimensions, in priority order:

1. **Answer integrity** — the product's one promise is "never a wrong number." Any path that renders a wrong value under a right label is a Sev-1 product defect, worse than a crash. Refusals are acceptable; silent substitutions are not.
2. **Trustworthy gates** — a deterministic engine is only as good as the tests that pin it. Red-by-default CI, unrunnable lint, and untested SQL generation corners break the feedback loop everything else depends on.
3. **Warehouse fidelity** — ingestion must fail loudly on upstream drift, never fabricate values, and keep the live API coherent with the data underneath it.
4. **Single-dependency resilience** — Postgres is the only stateful dependency; the process must survive its bad days (idle-client errors, slow queries, pooler restarts) rather than crash or wedge.
5. **Shareability** — answers are the growth loop; share pages must unfurl, entity pages must be crawlable, and a hung search box is a product failure.
6. **Velocity for a solo maintainer** — one person ships this; duplication, dead scaffolding, and hand-maintained parallel lists are where solo projects rot.

Scores (1–5): answer integrity **3** (architecture 5, executor corners 2) · gates **1** · warehouse fidelity **3.5** · resilience **2** · shareability **2** · velocity **3**.

---

## 4. Strengths

1. **Parameterization discipline is real.** Every user-derived value across ~30 service queries and all 18 engine executors is a bound parameter; every interpolated identifier traces to a code allowlist; ORDER BY directions are ternaries over closed unions; operators go through whitelist maps (`counts.ts:19`). An adversarial trace found zero injection paths. Defense in depth: read-only role option, zod length caps, rate limiting.
2. **The honesty architecture.** Pre-SQL auditing, tailored refusals, in-progress-season warnings, a durable `query_audit` analytics loop, and answers that expose their exact SQL and source rows. The ~180-case battery test is explicitly organized around wrong-bucket prevention ("superb owl", draft-"picks"-vs-interceptions, surname collisions).
3. **Ingestion engineering.** Param-budget chunking, per-call transactions, in-batch conflict-key dedupe, strict zod validation before write, a skip ledger with reasons and samples (`context.ts:31-44`), atomic `.part`→rename downloads with retry/backoff, streamed play-by-play, and test fixtures encoding real messiness (relocations, postponed games, ghost players).
4. **Accessibility and design-system maturity.** Skip link, `inert`-based drawer with a correct focus trap, a textbook ARIA combobox (`SearchSuggest.tsx:149-156`), `aria-sort`, reduced-motion handling, 44px touch targets, contrast-annotated tokens, and `teamTheme.ts` computing WCAG luminance for accent ink.
5. **Deploy mechanics already production-shaped.** Real liveness/readiness split (`/health` vs DB-probing `/ready`, which Render watches), idempotent graceful shutdown with pool drain and a force-exit timer, `sync:false` secrets, trust-proxy-correct rate limiting with a bounded key map.
6. **Self-aware tradeoffs.** Every known single-instance shortcut is flagged in-code (`ponytail:` markers); docs include real operational specifics (Supabase session-vs-transaction pooler guidance).

---

## 5. Answer-integrity defects (engine)

The parse layer is well-tested; these live in the executor layer, where **only 5 test assertions exist across 18 executors**.

- **[verified] CRITICAL — `compare` silently substitutes fantasy points for ratio/formula stats.** `shared.ts:293-296`: `compareOrderCol` falls back to `fantasy_points_ppr` whenever the stat isn't a simple column (`completion_pct`, `passer_rating`, `yards_per_carry`, `total_tds`, …), and narration labels that number with the requested stat. Live reproduction against the local warehouse: *"josh allen vs patrick mahomes completion percentage"* → **"Josh Allen leads Patrick Mahomes in completion percentage, 771.7 to 563.2"** — those are fantasy-point totals (`ORDER BY agg.fantasy_points_ppr DESC` in the returned SQL). Wrong number, right label: the exact failure class the product exists to prevent.
- **CRITICAL — a crash class: season-rollup executors × stats they can't compute.** `teamStat.ts:38` emits `SUM()` (empty expr) for ratio/formula stats → SQL syntax error; `rank.ts:52-61` and `counts.ts:46-64` reference season-table columns that don't exist for `yards_per_carry`/`catch_rate`/air-yards (`shared.ts:185-186` admits "No carries column in the season table"). Plausible questions ("chiefs completion percentage in 2023", "where does Henry rank in yards per carry") → 500s.
- **HIGH — ratio thresholds compare the numerator, not the ratio.** `counts.ts:16-18` and `streaksMilestones.ts:14` use `COALESCE(s.${def.ratio.num},0)`; "games over 5 yards per carry" counts games with `rushing_yards > 5` (≈ all of them). The correct helper `ratioRowExpr` exists and is used by `singleGame.ts:12` — an inconsistency, not a missing capability.
- **MEDIUM — silent scope-dropping.** `rookie` is ignored whenever a game-level filter applies (`playerTotal.ts:54-67`); `median` ignores `firstN`/`lastN`; compare ignores season ranges and generic stat cues ("allen vs mahomes touchdowns" compares passing yards, `parseRules.ts:598`).
- **MEDIUM — wrong-bucket routing.** "Best draft picks ever" falls through to a career-interceptions leaderboard (`parseRules.ts:654-672` + `spec.ts:187`); defensive INTs are unqueryable but their vocabulary ("picked off") maps to INTs *thrown*; bare first names in the resolver index ("will", "drake", "chase" — `resolve.ts:90-92`) hijack questions like "who will win mvp".
- **MEDIUM — milestone honesty guard promised but absent.** `streaksMilestones.ts:48-50` comments and `narrate.ts:279-281` narrates a "careers starting in the warehouse era" restriction that the SQL never applies.
- **LOW —** `scoring.ts:41` orders TD plays by varchar `play_id` (lexicographic: play "100" before "21"), so first/last-TD-within-a-game can pick the wrong play; Thursday-afternoon Thanksgiving games count as "primetime" (`shared.ts:167-172`); pre-2021 "week 18" questions quietly get REG.

---

## 6. Broken quality gates & CI/CD

- **[verified] CRITICAL — CI red on all recorded main runs** (§1). `server-tests` is consistently green; `web-e2e` consistently fails.
- **[verified] CRITICAL — lint is dead repo-wide.** Root `lint` → `turbo run lint` → only web defines the script → `next lint` (deprecated, removed in Next 16) with **no ESLint config and no eslint in the lockfile** → interactive prompt, exit 1. README.md:95-96 claims CI "runs all of it"; CI has no lint step at all.
- **HIGH — CI never verifies a production build.** `next build` passes today [verified] but nothing enforces it; e2e runs against `next dev` even in CI (`playwright.config.ts:26-31`). The server has no build/compile gate at deploy either (tsx strips types without checking).
- **MEDIUM — CI flake surface & waste:** the ci.yml:60-61 comment claims nflverse downloads are "cached across pipelines within the run," but no `actions/cache` step exists — every run re-downloads release assets (incl. multi-MB pbp) from GitHub; Playwright browsers re-download every run; no `concurrency` cancel-in-progress, no `timeout-minutes`.
- **MEDIUM — no supply-chain surveillance:** no `pnpm audit`, no Dependabot/Renovate, no CodeQL.
- **LOW — turbo is mostly decorative.** Root scripts bypass it with `pnpm --filter`; the `build` task with `.next/**` outputs is wired to no root script; no remote cache. Either wire `build`/`test`/`lint`/`typecheck` through it or drop the dependency.

---

## 7. Security

Overall posture is strong for an anonymous read-only API; the gaps are at the transport and resource-abuse layers.

- **HIGH — DB TLS is unverified.** `db/pool.ts:20-22`: every non-localhost connection uses `ssl: { rejectUnauthorized: false }` — encrypted but MITM-able, credentials ride the channel. Pin the provider CA (Supabase publishes one).
- **HIGH — the cheapest endpoints to abuse are the unthrottled ones.** Only `/api/search` and `/api/agent` are rate-limited (`controllers/index.ts:51,159`). `/api/search/suggest` runs a leading-wildcard `LIKE` per keystroke with **no index that can serve it** (see §10) and no LIKE-wildcard escaping (`services/search.ts:15-16` — `%%%` forces full scans); `/api/players/:id` runs 6 queries including an unbounded full game log; `/api/leaderboards` runs 8 parallel queries.
- **MEDIUM — unauthenticated durable-growth vectors.** Every question INSERTs into `query_audit` and distinct questions into `answer_cache`; neither has TTL, cleanup, or an `asked_at` index (schema.sql:167-189). Bounded only by the 30/min/IP limiter (~43k rows/day/IP).
- **MEDIUM — baseline hardening absent:** no helmet / `x-powered-by` disable / `nosniff`; unknown API routes return Express's HTML 404 instead of the `{detail}` JSON contract; `CORS_ORIGINS` split doesn't trim whitespace, and the localhost-regex origin is allowed in production (`config.ts:28-31`).
- **LOW — `:shareId` is the only unvalidated input** on the surface (`controllers/index.ts:71-75`); parameterized downstream, but it breaks the "all inputs validated" invariant. Deliberate disclosure to sign off on: `/api/search` returns the executed SQL (transparency feature; schema names only).
- **No auth story** — acceptable for public sports data, but undocumented as a decision; there is no admin surface to accidentally expose today.

---

## 8. Reliability, operations & data pipeline

### Process resilience

- **CRITICAL — no `pool.on("error")` handler on either pool** (`db/pool.ts`). `pg.Pool` emits `error` for idle-client failures (pooler restarts, network resets); with no listener it becomes an `uncaughtException` → `logger.fatal` → process exit (`index.ts:43-46`). One dropped idle connection restarts the API.
- **HIGH — no `statement_timeout`, `connectionTimeoutMillis`, or `query_timeout` anywhere.** A pathological query wedges a connection forever; when the DB is unreachable, `pool.connect` waits indefinitely so even `/ready` hangs rather than failing fast. `max: 10` per pool is hardcoded (two pools ⇒ 20 conns/instance) — not tunable against Supabase pooler limits.
- **MEDIUM —** `getAnswerByShareId` swallows DB errors into `null` → a DB outage renders share links as 404s (`lib/cache.ts:119-122`); `logAudit` failures are `.catch(() => {})` — the audit trail can silently stop; the `unhandledRejection` handler logs-and-continues while its comment claims it exits (`index.ts:38-42`); request logs have no duration or request id (`app.ts:21-26`).

### Ingest ↔ API coherence

- **HIGH — nothing invalidates caches after ingest.** Ingest is a separate process; the answer caches serve stale data for up to 24h, and the entity-resolver indexes (`resolve.ts:54,107`) have **no TTL at all** — a newly ingested rookie is unresolvable until process restart (`latestSeason` got a 10-min TTL, `pipeline.ts:38-39`; the same treatment was skipped here).
- **MEDIUM — mid-ingest state is visible and gets frozen into caches.** Each table commits independently; the API can observe a new week's games with zero stats, and that answer persists durably. No advisory lock prevents overlapping ingest runs.

### Ingestion integrity

- **CRITICAL — the provider disk cache never invalidates** (`providers/nflverse.ts:39`: exists + size>0 ⇒ reuse). nflverse republishes current-season assets weekly; the tool's primary in-season use case ("re-run to pick up this week") silently re-ingests last month's file and reports success. Needs ETag/max-age revalidation or `--no-cache`.
- **CRITICAL — upstream column renames fabricate zeros, not failures.** Coercers return null for missing columns, and summed fields turn that into 0 (`pipelines.ts:167-171`: `tackles: (int(r.def_tackles_solo) ?? 0) + …`). nflverse has done exactly this rename before. No skip-ledger entry, exit 0. Add a per-asset expected-header assertion.
- **HIGH —** `Ctx.known()` swallows *all* DB errors into an empty set (`context.ts:21-27`) → a transient failure mass-drops every row as "unknown player/team" with exit 0; `--all` accumulates 25+ seasons of weekly CSVs in memory before one giant transaction (`pipelines.ts:134-135`) — the per-season pattern already exists in `loadScoringPlays`; backfilling an old season regresses the players dimension (last-write-wins overwrites 2024 bios with 2010 values, `pipelines.ts:66-68`); `--dry-run` without `DATABASE_URL` crashes despite the CLI claiming it works (`cli.ts:73-78`).

### Migration strategy

- **HIGH — dual-maintained DDL truth.** `CREATE TABLE IF NOT EXISTS` ignores column additions on existing DBs, so schema.sql:192-229 already carries a parallel wall of `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` duplicating columns listed in the CREATE bodies. Nothing verifies fresh-create ≡ evolved. Renames/type changes/drops have no path at all. Render has no `preDeployCommand`, so prod migration is a manual laptop step — code can ship ahead of schema. Adopt numbered migrations (node-pg-migrate/dbmate) + `preDeployCommand`.

---

## 9. Frontend architecture

- **CRITICAL — `NEXT_PUBLIC_API_URL` falls back to `http://localhost:4000` in production builds** (`app/lib/api.ts:65`, also baked into the layout preconnect). A prod build missing the env var compiles silently and every browser fetches localhost. Assert at build time.
- **CRITICAL — the share page has no `generateMetadata`.** `/a/[id]` is the growth loop, is already a server component, and already awaits the answer (`a/[id]/page.tsx:12`) — yet links unfurl with the generic site title, no OG card. ~15 lines to fix.
- **HIGH — everything data-bearing is a client component.** 9 of 13 routes fetch in `useEffect`; crawlers see skeletons; titles are set via a `document.title` hack with a 300ms `setTimeout` race (`hooks.ts:148-155`); deep links double-fetch because URL params are read post-mount (`hooks.ts:93-96` — `/teams/SF?season=2023` fetches the default season first, then re-fetches). Moving entity pages to server-component fetching with `revalidate` fixes SEO, the waterfall, the title hack, and the double-fetch in one change.
- **HIGH — the flagship search can spin forever.** GETs have `AbortSignal.timeout(15_000)` but the two POSTs — `ask()` and `askAgent()`, the slowest endpoints — have no timeout (`api.ts:122-130, 220-228`).
- **HIGH — ~2,000 lines of dead scaffolding mislead contributors.** Nothing imports `components/ui/*` (14 stock shadcn files incl. a 726-line sidebar); `lib/utils.ts`, `hooks/use-mobile.ts`, and 7 dependencies (`radix-ui`, `class-variance-authority`, `lucide-react`, `clsx`, `tailwind-merge`, `tailwindcss`, `tw-animate-css`) exist only to serve it. **Tailwind is configured but never imported** — `globals.css` has no `@import "tailwindcss"`; the real UI is the hand-rolled `yb-*` system. Delete the tree or commit to it.
- **MEDIUM — a11y gaps in an otherwise strong story:** `Dropdown.tsx:115-131` never exposes the keyboard highlight to assistive tech (no `aria-activedescendant` — the sibling `SearchSuggest` does it correctly); invalid `aria-selected` on non-tab buttons (`fantasy/page.tsx:271-280`); incomplete tabpanel wiring on the player page.
- **MEDIUM — missing production surface:** no `public/` at all (favicon 404s), no `robots.ts`/`sitemap.ts`, no `not-found.tsx`, no error reporting, no security headers/CSP in `next.config.ts`.
- **MEDIUM —** `players/[id]/page.tsx` is 786 lines because it inlines three table components, a column-config DSL, and formatters; the module-level `jsonCache` in `api.ts` is shared cross-request on the server and never evicts.

---

## 10. Performance

- **HIGH — name search is unindexable as written.** Every lookup is `LOWER(full_name) LIKE '%…%'` (`services/search.ts:29`, `engine/audit.ts:133`); the btree on `players(full_name)` (schema.sql:36) serves neither the case-fold nor the leading wildcard. This backs the per-keystroke public typeahead → seq-scan + join per keystroke. Add a `pg_trgm` GIN index on `LOWER(full_name)`.
- **MEDIUM — the parser is O(all players) per question, several times over.** `playerHit`/`allPlayerHits` re-sort the full index keyset **on every call** and regex-test key by key (`parseRules.ts:166,181`); fuzzy resolution is O(spans × players) with a Map allocation per `quickRatio` (`resolve.ts:163-173`) and runs even on exact hits. Tokenize-and-hash inverts this to O(question).
- **MEDIUM —** `getPlayerProfile` runs 6 independent queries sequentially and its game/scoring logs have no LIMIT (`players.ts:16-155`); `/api/leaderboards` fires 8 parallel queries where one `UNION`/`LATERAL` would do.
- **LOW —** redundant index `pss_season_idx` (prefix of `pss_season_type_idx`); dead never-written columns in `team_game_stats` (schema.sql:123-127); `answer_cache.answer_json` is `text` not `jsonb`; game-log leaders scan the full fact table (fine at current ~10⁵–10⁶ rows; watch it).

---

## 11. Scalability limits

All stateful things are per-process and honestly documented as such: the rate limiter Map (N replicas ⇒ N× the limit), L1/L2 answer caches, resolver indexes, `latestSeason`, `questionsCache`. Single-instance is a legitimate current design. The real cliff-edges before "add Redis" ever matters: missing pool timeouts (§8), the unbounded `answer_cache`/`query_audit` growth (§7), the un-invalidated caches after ingest (§8), and `--all` ingest memory (§8). The `lib/cache.ts` four-function facade means a Redis swap later is contained — good.

---

## 12. Testing gaps

Existing coverage is lopsided-good: the parse layer and ingest normalization are genuinely well-tested (287 tests [verified]); the e2e specs assert real user value. Missing:

1. **The executor layer** — 5 SQL assertions total across 18 executors; every §5 crash bug lives in the untested set. Highest-leverage single addition: a sweep test `for each intent × each STATS key: buildSql() doesn't throw && EXPLAIN succeeds` against the scratch DB.
2. **Narration** — 4 cases across ~25 template branches; the compare mislabeling sits in an untested corner. The battery validates specs only — wrong numbers downstream of a correct spec are invisible to it.
3. **The entire HTTP layer** — zero controller/service tests (no supertest): validation bounds, 429 + Retry-After, error contract, the agent's regex intent router.
4. **Engine plumbing** — `resolve.ts` (index key generation, nickname install), `lib/cache.ts` (LRU/TTL), `specCacheKey` completeness (hand-maintained 40-field list guarded only by a comment — enumerate against the union in a test).
5. **Ingest** — the pbp/scoring pipeline (the most complex one) has no fixture; provider retry/cache/gzip untested; the upstream-column-rename drift scenario (would have caught the fabricated-zeros bug).
6. **Web** — no unit tests for the pure, bug-prone bits (`passerRating`, `teamTheme` WCAG math, `friendlyError` regexes, `SortTable` null-sinking); e2e doesn't cover the share round-trip, fantasy lineup persistence, box score, keyboard flows, or error states.

---

## 13. Developer experience

- **[verified] The quick start fails on a fresh clone:** `.env.example` points `DATABASE_URL` at port **5433** while docker-compose publishes **5432** (README claims "local-Docker defaults are pre-filled"). The test default also assumes 5433 (`ingest.test.ts:20`) while CI uses 5432 — the blessed port is whatever the author's uncommitted override says.
- **Missing root scripts:** no `pnpm test`, no `pnpm build`, no combined `pnpm dev` (the turbo `dev` task exists, unwired). README documents `pnpm --filter` incantations instead.
- **No formatting/hooks/review guardrails:** no Prettier, no `.editorconfig`, no husky/lint-staged, no CODEOWNERS, no PR template — for a repo that already takes PRs.
- **Config traps:** `TRUST_PROXY_HOPS` is read by `config.ts:35` but documented nowhere; `NEXT_PUBLIC_ASSISTANT_ENABLED` is missing from turbo `globalEnv` (a cache-invalidation footgun the moment turbo's build cache is used); `apps/server/tsconfig.json` doesn't extend `tsconfig.base.json` (hand-copied options, silently lacks `isolatedModules`).
- **Docs drift** (small edits, big trust): README says compose includes Redis (it doesn't; Redis exists only in comments); compose uses `pgvector/pgvector:pg16` while nothing uses pgvector and CI uses plain `postgres:16`; DEPLOYMENT.md says Render watches `/health` (it watches `/ready`); ci.yml claims download caching that doesn't exist; ARCHITECTURE.md's system map states "read-only role" unconditionally while it silently falls back to the RW pool when `READONLY_DATABASE_URL` is unset — and no role-provisioning SQL ships in the repo.

---

## 14. Code smells & duplication (top instances)

| Smell | Instances |
|---|---|
| Season-resolution preamble copy-pasted | 7× across services (`fantasy.ts:21-24`, `games.ts:11-15,95-99`, `leaderboards.ts:74-79`, `standings.ts:21-24`, `teams.ts:42-45`, `players.ts:359-369`) |
| Byte-identical REG/POST query pair + mapping literal | `players.ts:44-99` and `:157-213` — one `season_type = $2` param away from half the size |
| COALESCE stat-column list variants | ~6 across services; schema drift needs 6 edits |
| `repositories/` is a fig leaf | 2 files; ~25 raw SQL statements live in services; `lib/cache.ts` and `engine/audit.ts` own tables outright |
| `parseRules.ts` | a single 660-line function whose correctness depends on implicit rule ordering, pinned only by the battery |
| Prominence formula / defensive-position list / month maps | 3×, 4×, 2× respectively across engine modules |
| Frontend helpers duplicated despite `lib/format.ts` | `fmtDate`+`MONTHS` 3×, `ord` vs `formatRank`, streak-class ternary 5× |
| Dead code | `SbRef.playedYear`, unreachable LIKE fallbacks, spec `limit` ignored by three executors, `.gitignore` entry for a nonexistent workspace, the entire shadcn tree (§9) |
| Magic values drifting | ascending-board floor `8` in SQL and narration independently; `"since 1999"` hardcoded 3× while `STATS_MIN_SEASON` exists |

---

## 15. Opportunities for simplification

1. **Delete the dead shadcn/Tailwind tree** — ~2,000 lines + 7 deps, misleads every contributor, and Tailwind isn't even imported (§9).
2. **One `resolveSeason()` helper** kills 7 copies; **one parameterized REG/POST query** halves `players.ts`'s core.
3. **Collapse `pss_season_idx`,** drop never-written `team_game_stats` columns, remove the pgvector image — align local and CI on `postgres:16`.
4. **Either use turbo or drop it** — currently a dependency that fans out `tsc --noEmit`.
5. **Parser rule table** — restructure `parseRules` into an ordered `(guard, build)` table across 3–4 files; makes the load-bearing ordering explicit and diff-reviewable.
6. **Import types directly from `@yunoball/types`** in web pages instead of re-exporting 43 names through `api.ts`.

---

## 16. Recommended refactors, ranked

Effort: S < ½ day · M ≈ 1–2 days · L ≈ 3+ days.

### Critical — the product is wrong or the gates are down

| # | Refactor | Effort | Why | Status |
|---|---|---|---|---|
| C1 | **Restore CI to green**: ingest `--years 2023 2024` in ci.yml, fix the stale selectors, re-pin data-coupled asserts to verified reality | S | [verified] CI has never passed on main; every other guarantee depends on a trusted gate | ✅ **Done** (Batch 1) |
| C2 | **Make lint real**: flat ESLint config (typescript-eslint + next plugin), `lint` scripts in all 3 workspaces, CI step, fix fallout | M | [verified] `pnpm lint` is unrunnable; README claims otherwise | ✅ **Done** (Batch 1) |
| C3 | **Fix `compare`'s stat substitution** (`shared.ts:293`): compute ratio/formula aggregates per side or refuse | S–M | [verified live] wrong numbers under the user's label — the core product promise broken | ✅ **Done** (Batch 2) |
| C4 | **Add a capability check per (executor × StatDef)** and an intent×stat `buildSql`+`EXPLAIN` sweep test; fix `teamStat`/`rank`/`counts` fallout | M | Kills the 500-crash class and permanently guards the whole executor layer | ✅ **Done** (Batch 2) |
| C5 | **Provider cache revalidation** (ETag/max-age/`--no-cache`) + **per-asset header assertions** before mapping | M | In-season re-ingests silently load stale data; upstream renames fabricate zeros with exit 0 | ⬜ Batch 3 |
| C6 | **`pool.on("error")` + `statement_timeout` + `connectionTimeoutMillis`** on both pools | S | One idle-client blip currently restarts the API; one bad query wedges it | ✅ **Done** (Batch 1) |
| C7 | **Guard `NEXT_PUBLIC_API_URL`** (throw in prod build when unset) | S | A silent misconfiguration ships a fully broken app | ✅ **Done** (Batch 1) |

### High — trust, freshness, growth loop

| # | Refactor | Effort | Status |
|---|---|---|---|
| H1 | Pin the DB CA instead of `rejectUnauthorized: false` (`pool.ts:21`) | S | ✅ **Done** (Batch 1) |
| H2 | Cache coherence after ingest: TTL/refresh on resolver indexes, ingest-triggered flush (or short TTL) for answer caches, advisory lock against overlapping ingests | M | ⬜ Batch 3 |
| H3 | `generateMetadata` + OG card on `/a/[id]`; add `public/` basics (favicon, robots, sitemap, `not-found.tsx`) | S | ⬜ Batch 4 |
| H4 | Move entity pages to server-component fetching with `revalidate` (fixes SEO, waterfall, title hack, deep-link double-fetch) | L | ⬜ Batch 4+ |
| H5 | Rate-limit `/suggest`, `/players/:id`, `/leaderboards`; escape LIKE wildcards; LIMIT the game-log queries; `pg_trgm` GIN index on `LOWER(full_name)` | M | ⬜ Batch 4 |
| H6 | Ratio thresholds via `ratioRowExpr` in `counts.ts`/`streaksMilestones.ts` | S | ✅ **Done** (Batch 2) |
| H7 | Add `next build` + a server compile gate to CI; build the server for prod (tsup → `node dist/`), demote tsx to dev | M | ⬜ Batch 4 |
| H8 | Fix `Ctx.known()` error swallowing; per-season batching for `--all`; guard players-dimension backfill regression | M | ⬜ Batch 3 |
| H9 | Timeouts on `ask()`/`askAgent()` POSTs | S | ✅ **Done** (Batch 1) |
| H10 | Numbered migrations + `preDeployCommand: pnpm db:migrate` on Render | M | ⬜ Batch 4 |
| H11 | Align local ports (compose 5432 everywhere; fix `.env.example`, `ingest.test.ts` default, README) | S | ✅ **Done** (Batch 1) |

### Medium — debt that compounds

- M1: Extract `resolveSeason()`; collapse the REG/POST duplicate in `players.ts`; move `answer_cache`/`query_audit` SQL into repositories.
- M2: Delete the dead shadcn tree + unused deps; move `app/search.tsx` into `app/components/`.
- M3: Supertest HTTP tests (validation, 429, error contract) + unit tests for `rateLimit`/`cache`/`records`/`friendlyError`/`teamTheme`.
- M4: Honor-or-refuse ignored spec fields (`rookie`+filters, `median`+windows, compare ranges) in `audit`; implement the milestone era guard; add `def_interceptions`; reserve common-word first names.
- M5: Retention + `asked_at` index for `query_audit`/`answer_cache`; fix `hits` semantics; `answer_json` → jsonb.
- M6: CI caching (nflverse `INGEST_CACHE_DIR`, Playwright browsers, `.turbo`), `concurrency`, `timeout-minutes`; Dependabot + `pnpm audit` + CodeQL.
- M7: helmet/`nosniff`/`x-powered-by`, JSON 404 catch-all, trim `CORS_ORIGINS`, gate the localhost origin to non-prod; validate `:shareId`; unify 400 vs 422.
- M8: `aria-activedescendant` in `Dropdown.tsx`; fix `aria-selected` misuse; complete tabpanel wiring; request duration + id in server logs.
- M9: Split `players/[id]/page.tsx` into `components/player/*`; consolidate duplicated frontend helpers; adopt `useApi` (or SWR) in the 5 hand-rolled fetch effects.
- M10: Root `test`/`build`/`dev` scripts wired through turbo; Prettier + `.editorconfig` + lint-staged; missing FKs and CHECK constraints; document `TRUST_PROXY_HOPS`; add `NEXT_PUBLIC_ASSISTANT_ENABLED` to turbo `globalEnv`.
- M11 *(new, from C4)*: Route `player_rank`/`qualifying_count` through the game log for game-only-ratio stats (yards per carry, catch rate) so they answer instead of refusing — mirrors what `leaders` already does. Enhancement; the capability gate makes today's behavior an honest refusal, not a crash.

### Low — polish

- L1: Fix all §13 docs drift (Redis, pgvector, `/health` vs `/ready`, CI caching comment, read-only hedge) and ship role-provisioning SQL for the read-only role.
- L2: Numeric play ordering for `scoring_plays`; Thanksgiving/primetime and pre-2021 week-18 edges.
- L3: Parser rule-table restructure; tokenize-and-hash entity matching; `Promise.all` the player-profile queries.
- L4: Drop dead columns/index; `server/tsconfig` extends base; engines `^22`; `--filter` install on Render; `ScoreTicker` raw `<a>` → `Link`; stale `.gitignore` entry.

---

## 17. Suggested sequencing

1. **Milestone 0 — trust the gates (C1, C2, C6, C7, H11):** CI green on main, lint runnable and enforced, the process survives a DB blip, fresh clones work. Roughly two days; everything after this compounds.
2. **Milestone 1 — honor the promise (C3, C4, C5, H6):** no wrong numbers, no 500s from plausible questions, no silently stale or fabricated data. The `buildSql`×`EXPLAIN` sweep test is the keystone — it converts this whole bug class from "found by users" to "found by CI."
3. **Milestone 2 — production hardening (H1–H3, H5, H7–H10):** TLS, cache coherence, share-page unfurls, abuse limits, real builds, migrations.
4. **Milestone 3 — architecture payoff (H4, M-tier):** server-component data fetching, HTTP test coverage, dead-code deletion, dedup.

---

## Appendix — verification log

All executed 2026-07-13 against a scratch Postgres 16 (`initdb` + trust auth), Node 22, pnpm 10.33.0:

```
pnpm install --frozen-lockfile          ✅
pnpm typecheck                          ✅ 3/3 workspaces
pnpm db:migrate                         ✅ "schema applied"
pnpm --filter @yunoball/server test     ✅ 287/287 (4 files: engine, battery, audit, ingest)
pnpm lint                               ❌ next lint deprecated + no ESLint config → interactive prompt, exit 1
pnpm build:web                          ✅ 12 routes; first-load JS 102–118 kB
pnpm ingest:nfl --season 2024           ✅ 285 games, 7,049 scoring plays, 12,927 draft picks
pnpm e2e (2024-only warehouse)          ❌ 10 failed / 3 passed  ← reproduces CI exactly
pnpm ingest:nfl --season 2023           ✅
pnpm e2e (2023+2024 warehouse)          ❌ 3 failed / 10 passed  ← 2 stale selectors + 1 data-coupled assert
POST /api/search compare-ratio probe    ❌ "…leads…in completion percentage, 771.7 to 563.2"
                                           (fantasy-point totals; SQL orders by fantasy_points_ppr)
GitHub Actions, branch=main             ❌ 4/4 runs failed; server-tests ✅ / web-e2e ❌ every run
```
