# YunoBall — Engineering Plan

> Where the product goes next and in what order. Baseline: the shipped
> prototype described in [PRD.md](PRD.md) / [TDD.md](TDD.md) — deterministic
> query engine, 1999–present warehouse, hub surfaces, share pages, deployed
> topology (Vercel / Render / Supabase).
> Written 2026-07-17, revised 2026-08-02 (§0.1). The 2026 NFL season kicks off
> in early September — that date anchors Track B.

## 0. Baseline (done)

- Query engine: 23 intents, ~30 allowlisted stats, scope grammar (rounds,
  venues, months, primetime, weather, ranges), two-tier cache + durable
  shares, structured audit log, zero LLM calls.
- Warehouse: nflverse ingest (nine release assets) with validation, idempotent
  upserts, pbp distillation (scoring plays, EPA aggregates); Supabase prod
  instance loaded and RLS-enabled.
- Product: home dashboard, scores/standings/leaderboards, player/team/box
  score pages, fantasy pool, demo-mode assistant, `/a/` share pages.
- Delivery: CI with real-ingest e2e, Docker/Render blueprint, Vercel web.

## 0.1 Shipped since (2026-08-02)

- **Warehouse breadth.** The nflverse `stats_player` files the ingest already
  downloads carry 145 columns and the mapping consumed 24; it now takes 31 more
  at both the game and season grain (`ingest/pipelines.ts`), so kicking,
  punting, returns, first downs, YAC, penalties and the extended defensive line
  stop being discarded from files already sitting in the disk cache.
  Twenty-two of them are registered in the engine's allowlist, which is now 55
  stats. `fg_long` and `punt_long` are deliberately not: every executor SUMs,
  and a summed "longest" is a wrong number.
- **Team box scores.** `team_game_stats` declared `total_yards`,
  `passing_yards`, `rushing_yards` and `turnovers` from the start but was built
  from the schedule alone, so they were NULL in every production row. The
  `stats_team` release fills them, plus first downs, penalties, sacks taken,
  defensive sacks, field goals made/attempted and passing/rushing EPA. Fetched
  best-effort: if it is unavailable the row still carries its result, as
  before. This is the *data* half of A.1 — the engine half is untouched.
- **Fact of the day.** A probe registry, a miner and a daily selection
  (`src/facts/`, `stat_facts` + `fact_of_the_day`, `GET /api/facts/*`, a home
  card and `/facts`, `.github/workflows/facts.yml`) — five probe families, 39
  variants. Coverage floors are derived from the warehouse at mine time and
  enforced twice, so a mined line can never claim to see further back than the
  data does. Not on this plan when it was written; it is the first surface that
  says something without being asked a question. Design doc:
  [FACTS.md](FACTS.md).

## Track A — Query coverage expansion

**Goal:** raise the answer rate — the % of real questions that parse and
return a correct answer (measured from `query_audit`).

1. **Team-stat unlock (highest-leverage).** The data landed (§0.1), so the
   refusal is now purely engine-side: `TeamStatSpec.metric` is
   `points_for | points_against` and `executors/teamStat.ts` picks between
   exactly those two columns, while yards, turnovers, first downs, penalties
   and team EPA sit in the table unqueryable. Extend `team_stat` executors +
   parser vocabulary to cover them (totals, per-game, per-drive, leaders among
   teams, season ranges). Time of possession stays refused until something
   writes it: nflverse does not publish it in `stats_team`, so it has to come
   from pbp drive timing.
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
6. **The rest of the nflverse catalogue.** The ingest reads nine release assets
   (`ingest/providers/nflverse.ts`); everything below is published in the same
   place, in the same CSV shape, and is simply not loaded. The newer ones are
   worth less than their column counts suggest — an answer or a probe over a
   dataset can only reach back to its first season, which is exactly how the
   fact miner's coverage floor already behaves.

   | Dataset | Coverage | Why |
   |---|---|---|
   | `weekly_rosters` | 2002+ | **Correctness, not coverage.** `player_season_stats.team_id` comes from nflverse's `recent_team`, one row per (player, season, type) — so a traded player's whole season collapses onto the team he finished it with. Weekly roster rows carry the real (player, week, team); the `rosters` table already models multiple teams in a season, the season stats don't. |
   | `snap_counts` | 2012+ | Snap share: the denominator behind "did he start", and an honest qualifier for rate stats. Keyed by `pfr_player_id`, which joins through `player_id_map` (already loaded). |
   | `nextgen_stats` | 2016+ | Time to throw, separation, air-yard splits. One file per stat type (`ngs_passing`/`rushing`/`receiving.csv.gz`) covering every season at once, not one file per year like everything the ingest reads today — a different loop shape, not just another mapping. |
   | `pfr_advstats` | 2018+ | Pressures, drops, missed tackles. Season files per stat type plus per-year weekly files. nflverse publishes them, so this stays inside the nflverse-only rule — we still never scrape PFR ourselves. |
   | `espn_data` (QBR) | 2006+ | Season- and week-level QBR — the one mainstream number the warehouse can't compute from what it holds. |
   | `pbp_participation` | 2016+ | Personnel, formation, box count and who was on the field for each play. |
   | `ftn_charting` | 2022+ | Play-level charting: motion, play action, RPO, blitzers, pressure. Deep splits on a thin floor. |
   | `depth_charts` | 2001+ | Weekly depth position — starter/backup context for roster and player pages. |

   Then the small self-contained files, a day each when a page needs them:
   `combine` (2000+; joins the draft through the `pfr_player_id` /
   `cfb_player_id` the draft file already carries and the mapping drops),
   `officials`, `trades`, and `contracts` — the OverTheCap history, published
   as `.rds`, `.parquet` *and* a gzipped CSV, so the existing provider handles
   it (`pbp` is already `.csv.gz`).

**Exit criteria:** team-stat questions answer correctly; answer rate visibly
climbing month over month; query-space doc merged to main.

## Track B — Live/current-season data (deadline: 2026 kickoff)

**Goal:** the 2026 season shows up in YunoBall within hours of games ending,
without manual runs.

1. **Standalone ingestion worker.** The cheapest version of this exists and
   does not work: `.github/workflows/ingest.yml` runs `pnpm ingest:nfl` every
   Tuesday at 10:00 UTC, but passes `--season` only on `workflow_dispatch`,
   and the CLI exits 2 when given no season — so the scheduled run fails, and
   `facts.yml`, gated on a *successful* ingest, never mines from it. That is a
   one-line fix and the first thing in this track. Then promote ingest from a
   hand-run CLI to a worker app (`pnpm worker`) with **run/source tracking**
   (which dataset, which season, when, row counts, outcome — persisted) and
   **resumable backfills**. Builds on the existing pipeline; never replaces
   it. Stays on license-safe sources (nflverse spine; ESPN/Wikidata only where
   nflverse lacks coverage).
2. **In-season cadence.** Scheduled refresh matched to nflverse release
   timing (stats land within ~24h of games): current-week schedules, scores,
   player/team game stats, rollup recompute, cache invalidation for affected
   answers. The Tuesday cron is the placeholder for the timing; the recompute
   and the invalidation are what's missing.
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
   confirm Supabase PITR settings and document restore. `stat_facts` re-mines
   from the probes, but `fact_of_the_day` does not come back: selection is a
   pure function of the day over *the backlog as it stood*, and the backlog
   moves with every mining run.

**Exit criteria:** a bad deploy or a failed ingest pages a human; share pages
unfurl properly in social/chat apps.

## Sequencing

```
Now ──► M1 (≈2 wks): Track A.1 team-stat unlock + A.5 answer-rate report
              Track C.1 dedicated result page; B.1 scheduled-ingest fix
        M2 (≈4 wks): Track B.1 worker + run tracking; C.2 PNG export;
              D.3 share-page SEO; A.6 weekly_rosters (traded-player fix)
        M3 (by 2026 kickoff, early Sept): B.2–B.4 in-season automation;
              D.1–D.2 observability + paid dyno — LAUNCH BAR
        M4 (in-season): A.2–A.4 archetype grind; A.6 remaining ingest tiers;
              C.3–C.5 polish; D.4–D.5
```

Rationale: A.1 + C.1 are the highest user-visible leverage per effort and
de-risk nothing later; the scheduled-ingest fix leads because the fact miner is
chained to it; the worker must exist well before kickoff so September is
automation-tuning, not a rewrite; `weekly_rosters` outranks the rest of A.6
because it is a wrong team on a season line, not a missing feature; the
archetype grind is steady-state work that benefits from the measurement loop
existing first.

## Risks

| Risk | Mitigation |
|---|---|
| nflverse release timing/format drift in-season | Provider isolation + zod validation already quarantine bad rows; worker run-tracking makes drift visible the day it happens |
| Coverage grind produces wrong answers under pressure to say *something* | Keep the honesty rule absolute; every new archetype ships with golden cases in `engine.test.ts` |
| A mined fact claims more history than the warehouse holds | Coverage floors are derived at mine time rather than hardcoded, and enforced twice — `sinceClause()` phrasing plus `assertNoUnsupportedYear()` throwing on the rendered headline. A dataset loaded from A.6 tightens every probe over it automatically ([FACTS.md](FACTS.md)) |
| Render/Supabase free-tier limits under real traffic | D.2 upgrade before launch; API is portable to any Node host by design |
| Scope creep toward accounts/predictions | Out of scope per [PRD.md](PRD.md) §6 until the four tracks land |
