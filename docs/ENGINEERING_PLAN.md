# YunoBall — Engineering Plan

> Where the product goes next and in what order. Baseline: the shipped
> prototype described in [PRD.md](PRD.md) / [TDD.md](TDD.md) — deterministic
> query engine, 1999–present warehouse, hub surfaces, share pages, deployed
> topology (Vercel / Render / Supabase).
> Written 2026-07-17. The 2026 NFL season kicks off in early September —
> that date anchors Track B.

## 0. Baseline (done)

- Query engine: 21 intents, ~30 allowlisted stats, scope grammar (rounds,
  venues, months, primetime, weather, ranges), two-tier cache + durable
  shares, structured audit log, zero LLM calls.
- Warehouse: full nflverse ingest with validation, idempotent upserts, pbp
  distillation (scoring plays, EPA aggregates); Supabase prod instance loaded
  and RLS-enabled.
- Product: home dashboard, scores/standings/leaderboards, player/team/box
  score pages, fantasy pool, demo-mode assistant, `/a/` share pages.
- Delivery: CI with real-ingest e2e, Docker/Render blueprint, Vercel web.

## Track A — Query coverage expansion

**Goal:** raise the answer rate — the % of real questions that parse and
return a correct answer (measured from `query_audit`).

1. **Team-stat unlock (highest-leverage).** `team_game_stats` is loaded but
   barely queried: total/passing/rushing yards, turnovers, time of
   possession, drives are refused today outside points questions. Extend
   `team_stat` executors + parser vocabulary to cover them (totals, per-game,
   per-drive, leaders among teams, season ranges).
2. **Archetype-driven backlog.** Work through the query-space archetype map
   (the ~289-archetype grammar documented on the `query-dev` branch —
   `docs/query-space.md`; land that doc on main). Prioritize by (a) data
   already loaded, (b) frequency in `query_audit` misses.
3. **Splits depth.** The `GameWindow` grammar already carries month,
   primetime, weather, venue, opponent — audit which stat × window
   combinations refuse and close the gaps; add division/conference windows.
4. **Awards & milestones maturity.** Broaden `award` beyond MVP/SBMVP as
   data allows; more milestone races ("fastest to N").
5. **Measurement loop.** A small answer-rate report over `query_audit`
   (parse rate, refusal reasons, top unanswered phrasings) — the tracker for
   this whole track.

**Exit criteria:** team-stat questions answer correctly; answer rate visibly
climbing month over month; query-space doc merged to main.

## Track B — Live/current-season data (deadline: 2026 kickoff)

**Goal:** the 2026 season shows up in YunoBall within hours of games ending,
without manual runs.

1. **Standalone ingestion worker.** Promote ingest from a hand-run CLI to a
   worker app (`pnpm worker`) with **run/source tracking** (which dataset,
   which season, when, row counts, outcome — persisted) and **resumable
   backfills**. Builds on the existing pipeline; never replaces it. Stays on
   license-safe sources (nflverse spine; ESPN/Wikidata only where nflverse
   lacks coverage).
2. **In-season cadence.** Scheduled refresh matched to nflverse release
   timing (stats land within ~24h of games): current-week schedules, scores,
   player/team game stats, rollup recompute, cache invalidation for affected
   answers.
3. **Freshness surfacing.** "Data through Week N" indicator; leaderboards
   and standings default to the in-progress season once Week 1 loads.
4. **Roster/headshot refresh.** Automate the ESPN-id fetch for rookies and
   movers as part of the worker.

**Exit criteria:** worker deployed and scheduled before Week 1; a full season
runs with zero manual ingest commands.

## Track C — Product polish & UX

**Goal:** the answer experience feels like the product, not a demo.

1. **Dedicated result page** (the `search-results-audit.md` refactor):
   submit navigates to `/a/<share_id>` (persistence already awaits before
   returning); homepage stays a discovery surface; `/a/` gets loading /
   not-found / retry states and a route-level action bar. `AnswerCard`
   remains the single renderer.
2. **PNG export** of the rendered answer card (clean capture target around
   the existing markup — no duplicate rendering path).
3. **Team-color rollout.** Extend `teamTheme` re-tinting to every
   single-team context (answers, box scores, fantasy rows) with its
   contrast-checked ink guarantees; solid team-color player cards everywhere
   player identity leads.
4. **Mobile pass.** Dense tables under horizontal containment, nav/search
   ergonomics, ticker behavior.
5. **Assistant v2.** Wire the agent beyond demo mode over the same trusted
   endpoints — multi-step answers with visible tool steps; still zero
   free-generated numbers.

**Exit criteria:** shared links render a first-class page worth screenshotting;
mobile answer flow is comfortable; assistant answers compound questions.

## Track D — Production hardening

**Goal:** boring reliability at near-zero cost.

1. **Observability.** Structured pino logs shipped somewhere queryable; an
   answer-rate + latency dashboard fed by `query_audit`; alert on readiness
   failures and worker-run failures.
2. **Deploy posture.** Move the API off Render's free tier before launch
   traffic (free sleeps after ~15 min → ~50s cold starts); keep `/ready` as
   the health gate; document rollback (redeploy previous image).
3. **SEO & sharing.** `/a/` pages get real titles/meta/OG images (pairs with
   Track C's PNG export); sitemap for player/team pages.
4. **Security posture.** Keep RLS + read policies on Supabase; rate-limit
   review once traffic exists; dependency audit in CI.
5. **Data safety.** The warehouse is rebuildable from nflverse, so backups
   are cheap insurance for the app tables (`answer_cache`, `query_audit`) —
   confirm Supabase PITR settings and document restore.

**Exit criteria:** a bad deploy or a failed ingest pages a human; share pages
unfurl properly in social/chat apps.

## Sequencing

```
Now ──► M1 (≈2 wks): Track A.1 team-stat unlock + A.5 answer-rate report
              Track C.1 dedicated result page
        M2 (≈4 wks): Track B.1 worker + run tracking; C.2 PNG export;
              D.3 share-page SEO
        M3 (by 2026 kickoff, early Sept): B.2–B.4 in-season automation;
              D.1–D.2 observability + paid dyno — LAUNCH BAR
        M4 (in-season): A.2–A.4 archetype grind; C.3–C.5 polish; D.4–D.5
```

Rationale: A.1 + C.1 are the highest user-visible leverage per effort and
de-risk nothing later; the worker must exist well before kickoff so September
is automation-tuning, not a rewrite; the archetype grind is steady-state work
that benefits from the measurement loop existing first.

## Risks

| Risk | Mitigation |
|---|---|
| nflverse release timing/format drift in-season | Provider isolation + zod validation already quarantine bad rows; worker run-tracking makes drift visible the day it happens |
| Coverage grind produces wrong answers under pressure to say *something* | Keep the honesty rule absolute; every new archetype ships with golden cases in `engine.test.ts` |
| Render/Supabase free-tier limits under real traffic | D.2 upgrade before launch; API is portable to any Node host by design |
| Scope creep toward accounts/predictions | Out of scope per [PRD.md](PRD.md) §6 until the four tracks land |
