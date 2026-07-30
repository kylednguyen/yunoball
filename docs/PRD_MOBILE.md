# YunoBall Mobile — Product Requirements Document

> Status: proposed v1 scope · Drafted 2026-07-30 from a multi-agent codebase audit
> Companion docs: [PRD.md](PRD.md) · [TDD.md](TDD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md)

## 1. Product summary

YunoBall for iOS is a single-purpose native app built around the one thing the
codebase already does uniquely well: **ask any NFL question in plain English
and get a number that was computed, not generated.** The app is a thin, fast
native client over the existing Express API; the deterministic engine — 23
intents, a 33-stat allowlist, allowlisted SQL over the nflverse warehouse
(1999–present) — stays entirely server-side and unchanged.

v1 is the ask loop and nothing else: a search field, three native answer
layouts, a player drill-down, on-device question history, and a share link.
Refusals are a first-class screen, not an error state — the engine's
willingness to say "I can't compute that precisely" is the differentiator
against every LLM sports app. Everything that makes YunoBall look like a
general sports app (scores, standings, leaderboards, box scores, fantasy) is
deliberately deferred so v1 ships as a demonstrably native, single-idea
product rather than a wrapper around the responsive web build.

## 2. Client platform: Kotlin Multiplatform, iOS-first

"Kotlin for the App Store" means **Kotlin Multiplatform (KMP) + Compose
Multiplatform** (stable on iOS since 2025). Plain Kotlin/Android targets only
Google Play; KMP compiles the same Kotlin to an iOS framework, and Compose
renders the UI on both platforms. Android becomes a near-free fast-follow —
the decision is release timing, not engineering.

**How to initiate:**

1. Prereqs: a Mac with Xcode, Android Studio + the KMP plugin, JDK 17+,
   `kdoctor` to verify the toolchain, Apple Developer Program enrollment
   ($99/yr), a bundle identifier, and an App Store Connect record. None exist
   yet.
2. Generate the project with the JetBrains KMP wizard (kmp.jetbrains.com) —
   iOS + Android targets, Compose Multiplatform UI, shared module.
3. Place it at **`apps/mobile/`** as a standalone Gradle build, deliberately
   NOT added to `pnpm-workspace.yaml` — Turbo/pnpm stay unaware of it. CI
   gets a separate macOS job (`ci.yml` is currently three ubuntu jobs).
4. Module layout: `:shared` (commonMain — DTOs, Ktor client, repository +
   cache, answer mapping, TeamTheme port), `:composeApp` (Compose UI, written
   once for both platforms), `iosApp/` (thin Xcode shell consuming the shared
   framework).
5. Libraries: Ktor client (Darwin engine on iOS, OkHttp on Android),
   kotlinx-serialization-json, kotlinx-coroutines, Compose Multiplatform +
   Material 3, Coil 3 for headshots, multiplatform-settings or SQLDelight for
   history/cache, Kermit for logging. Nothing else — the API needs no auth
   handshake, no streaming.
6. Inject the API base URL via BuildConfig/xcconfig per environment — never
   hardcoded, since no stable hostname exists yet (§6.2).

## 3. Backend platform: Postgres/Supabase stays; Convex deferred

Evaluated 2026-07-30 by two adversarial audits (one arguing each side, both
required to cite code). They converged; the pro-Convex audit itself rated a
full pivot **weak** and hybrid only **moderate**.

**Decision: no pivot.** The warehouse, engine, and API stay on
Express + Postgres (Supabase-hosted prod).

| Ground | Evidence |
|---|---|
| The differentiator ports; the execution doesn't | `engine/parseRules.ts` + `spec.ts` + `narrate.ts` (~3,600 LOC) contain zero SQL. But the 21 executor modules are SQL-native: windows over the ~475k-row game log (`executors/streaksMilestones.ts`), `RANK() OVER` whole-league scans (`rank.ts`), `PERCENTILE_CONT` medians (`playerTotal.ts`) — structurally impossible under Convex's per-transaction limits (32k docs scanned, 1s user code, no join/group-by language). |
| One-directional cost | ~5,400 LOC of data-layer rewrite + ~3,600 LOC of test revalidation (the golden suites are the only enforcement of "never a wrong number"). Estimates: 6 weeks–4 months. Kickoff — the ENGINEERING_PLAN launch bar — is 5 weeks out. |
| No lock-in to escape | No `supabase-js` anywhere; deps are `pg` + `DATABASE_URL`. CI runs the whole suite against vanilla `postgres:16`. Any Postgres host is an env-var change. A pivot trades zero lock-in for the deepest kind. |
| Mobile needs none of it | The 14 `/api/*` routes are already a public, e2e-tested REST surface. A Ktor client consumes them today with zero server changes. Convex's (real, verified) first-party mobile SDKs only matter if the phone talks to the database directly — it can't; the NL engine is server-side by necessity. |

**Named trigger to revisit:** the day *both* (a) accounts/saved lineups and
(b) sub-minute live features are genuinely on the roadmap — and even then,
evaluate Supabase Auth + Realtime first, because same-database user tables
keep FKs to `players` and one operational surface. Concessions worth
banking meanwhile: Convex-style reactive invalidation highlights that our
TTL-only answer cache can serve a stale number for up to 24h after ingest
(§6.2 #11), and `answer_cache`/`query_audit` are document-shaped tables that
would be happier in a document store — neither justifies a second backend.

## 4. v1 feature requirements

Each feature names its backend dependency. **EXISTS** = ship against today's
API; **GAP** = blocked on a §6 item.

1. **Ask — natural-language search as the home screen.** The spine, not a
   feature. EXISTS: `POST /api/search` `{question}` (2–500 chars), no auth.
2. **Typeahead suggest** (questions + players + teams in one call; picking an
   entity navigates rather than searches; 180ms debounce, 2-char minimum
   client-side). EXISTS: `GET /api/search/suggest` — currently unrate-limited
   (§6.2 #3).
3. **Trending/example questions as the cold-start empty state** — the only
   capability-discovery surface; there is no endpoint publishing the intent
   grammar. EXISTS: `GET /api/search/examples` (121-question corpus). GAP:
   the `{examples: []}` wrapper isn't in `packages/types` — hand-write that
   DTO.
4. **Scalar answer card** — the hero: one big number, player's face, a
   sentence of qualifying prose. EXISTS: render from `answer_value` +
   `narration` + `player_card` + `query_context`. **Never from `rows`** — the
   pipeline strips `total`/`games` from rows (`engine/pipeline.ts:232-238`);
   the scalar survives only in `answer_value`.
5. **Head-to-head comparison card** (`intent == "compare"`): 3-column
   value | metric | value table with team-tinted winner pills — naturally
   phone-shaped. v1 ships the table only, not the web's 4 modes + dual game
   logs. EXISTS.
6. **Schema-driven result table** for every other intent: one Compose table
   driven off server-provided `columns`, card-per-row fallback below a column
   budget. EXISTS but untyped — `rows` decodes to `List<JsonObject>` by
   design (§7).
7. **Honest refusal card.** Render `narration` verbatim (11 tailored refusal
   messages each name what IS supported) + retry/example affordances. GAP:
   refusals are HTTP 200 identifiable only by absence (§6.2 #4); same for
   ambiguous-name clarification candidates.
8. **Player profile drill-down** — bio + career + season lines only, not the
   web's 5-tab/23-column page. EXISTS: `GET /api/players/:id`. GAP: response
   is unpaginated (full career game log + every TD; §6.2 #6).
9. **On-device question history + share-out.** `share_id` is a deterministic
   hash of the normalized question — it doubles as a local cache key and
   dedupes identical questions offline. Share hands off to the web's
   `/a/<share_id>`. EXISTS; GAPs: best-effort persist can 404 a just-issued
   link, and Universal Links need an AASA file (§6.2 #13/#14).

## 5. Phase 2 / out of scope

**Phase 2** (in rough order): scores + schedule; standings (also the only way
to enumerate all 32 teams — there is no `/api/teams` collection route);
leaderboards browse (13 categories); team profiles; box scores (needs native
re-composition — 6 categories × 2 teams; note `TeamGameLine` ships five
permanently-null fields ingest never writes); player splits; full profile
parity; **Android release**; real offline persistence (data changes weekly —
a 24h local cache is *more* correct than the web's 60s TTL); home feed;
glossary; PNG answer-card export (Track C.2).

**Out of scope for v1** — each is a deliberate decision, most with an App
Store rationale:

- Accounts, auth, favorites, sync, push — zero backend exists (no users
  table, no APNs/FCM, no event source), and PRD.md §6 lists accounts as a
  non-goal. Reversing that is a product decision (§9).
- Live in-progress scores — no data path exists; Track B is unbuilt.
- The fantasy lineup builder — a desktop two-pane product, and
  gambling-adjacency review risk (Apple 4.7/5.3) v1 doesn't need.
- The `/assistant` chat — `POST /api/agent` is a regex router permanently in
  `mode:"demo"`; the web hides it behind a "Pro · Coming soon" paywall with
  no billing. Shipping any Pro framing invites IAP scrutiny (Apple 3.1.1) on
  an unpurchasable feature.
- In-app SQL disclosure — `redactAnswer()` strips it today; reversing is a
  product call (§9), not a mobile feature.
- Betting/odds/projections (PRD non-goal; direct review hazard), iPad-first
  layouts, any web rewrite.

## 6. Server workstream

### 6.1 Fix now, independent of mobile

1. **The scheduled ingest is broken.** `.github/workflows/ingest.yml` passes
   no `--season` on cron fires; `ingest/cli.ts` exits 2. Every scheduled run
   since creation has failed — the only automated freshness mechanism does
   nothing. Implement the "(default: current)" the workflow input already
   promises.
2. **Doc drift** — see §10.

### 6.2 Before App Store submission (roughly priority-ordered)

1. **API versioning** — the largest structural gap. Routes are bare `/api/*`;
   the repo invariant "wire changes touch server + types + web together"
   assumes atomic redeploys, which an installed binary breaks forever. Add
   `/api/v1/*` (keep `/api/*` aliased for web until it migrates) before the
   first binary ships.
2. **Paid always-on API + stable hostname.** `render.yaml` pins `plan: free`
   (~50s cold start after idle — reads as a broken app, not a slow one), and
   every hostname in the repo is a placeholder. Custom domain + paid plan is
   already unstarted launch-bar work (Track D.2).
3. **Rate limiting that survives carrier NAT.** Per-IP 30/min write /
   120/min read collapses under CGNAT (thousands of phones, one egress IP) —
   and the three endpoints mobile hits hardest (`suggest` per keystroke,
   `examples` per cold start, `answer/:shareId` per deep link) have **no
   limiter at all**. Needs a per-device dimension and coverage of the
   unlimited three.
4. **Machine-readable refusal + clarification signals on `AnswerResult`.**
   Refusals are 200s detectable only by absence; "which Smith?" candidates
   arrive as ordinary rows with the identifying `audit.status` stripped.
   Both are core mobile UI states. Add explicit fields.
5. **A machine-readable contract + CI drift gate.** No OpenAPI/JSON Schema
   exists; `packages/types` is unpublished TS source a Kotlin toolchain
   can't consume. Interim: `ts-json-schema-generator` → quicktype →
   kotlinx.serialization classes, with a CI job that regenerates and fails
   on diff. Long-term: OpenAPI 3.1 (also captures params, status codes, the
   `{detail}` envelope).
6. **Pagination/lite variant on `GET /api/players/:id`** — currently a full
   career game log + every TD, uncompressed, on a cellular first paint.
7. **HTTP caching headers + compression.** Nothing sets
   ETag/Cache-Control; no `compression` middleware. Weekly-refresh data
   makes this nearly free performance.
8. **Runtime config endpoint** (`/api/config`): min-supported-version,
   kill switches, feature flags. The only flag today is baked at web build
   time. A shipped binary has no other control plane.
9. **Team colors/logos on the wire.** `teams.color/color2` are ingested but
   unexposed; the web hardcodes 32 palettes and string-builds ESPN logo
   URLs. Expose them or mobile duplicates both (guaranteed drift).
10. **Data-freshness field** ("data through Week N") — Track B.3; matters
    more on mobile than web. No last-ingested timestamp crosses the wire.
11. **Answer-cache invalidation on ingest.** TTL-only today (24h default):
    a Week-N ingest can leave a stale answer live for a day, against the
    product's own "wrong number is worse than no answer" bar. Also:
    `answer_cache` grows without bound (no TTL, no cleanup job).
12. **JSON error envelope everywhere** — unmatched routes return Express's
    HTML "Cannot GET"; malformed/oversize bodies surface as 500 instead of
    400/413. Strict Kotlin decoders choke on HTML.
13. **`apple-app-site-association`** on the web domain for Universal Links
    into `/a/<share_id>` (apps/web/public contains only fonts), plus OG/meta
    on `/a/` pages (Track D.3).
14. **Make `persistAnswer` non-best-effort** — it swallows write errors
    after the `share_id` already went out, so a just-shared deep link can
    404 on arrival.
15. **Redis-backed rate limiter + answer cache** before the API scales past
    one instance — both are in-process Maps whose own comments say exactly
    this, and mobile traffic is what forces the scaling.

## 7. Client technical notes

- **DTOs:** mirror ~32 of the 44 interfaces in `packages/types/src/index.ts`
  (568 lines, no generics/imports/inheritance — near-best-case for codegen).
  Two shapes aren't in the contract and must be hand-written: the
  `{detail}` error envelope and the `{examples: []}` wrapper.
- **JSON config is non-negotiable:** `Json { ignoreUnknownKeys = true;
  explicitNulls = false }`. The repo's convention is additive widening; a
  strict decoder hard-fails a shipped binary on the next added field. TS `?`
  (absent) vs `| null` (present-null) both appear on `AnswerResult` and map
  differently.
- **Two custom serializers:** `rows` → `List<JsonObject>` (schemaless by
  design; drive the table off `columns` at runtime, dispatch renderers on
  `intent` exactly like the web's AnswerCard), and `answer_value`
  (number|string|null) → a sealed `NumberOrString` via
  `JsonContentPolymorphicSerializer`.
- **Numerics must be exact or decoding throws at runtime:** EPA fields,
  `cpoe`, `fantasy_points_ppr`, `sacks`/`def_sacks`, `pct`, `per_game` are
  Postgres doubles → `Double`; counting stats → `Int`.
- **Wire is snake_case by design** — either keep snake_case Kotlin
  properties or generate ~600 `@SerialName` annotations; an argument for
  codegen over typing.
- **Client resilience is client work** (none is server behavior): port
  `apps/web/app/lib/api.ts` patterns — TTL cache (raise 60s → ~24h),
  in-flight dedupe, 15s GET / 30s POST timeouts, 404-means-null,
  friendly error copy, honor `Retry-After` on 429.
- **Design tokens: `apps/web/app/globals.css:15-116` is the only source of
  truth** — DESIGN_BRIEF.md has fully drifted (documents emerald; the app
  ships lime `--accent: #89f336`; every surface/ink/type/spacing value
  differs). 5 surface steps, 3 near-white ink tiers (hierarchy by weight,
  not grey), 6-token accent family, 4px spacing scale, 6 radii, one ease +
  two durations. Dark-only (`color-scheme: dark`; no light ramp exists).
- **Port `teamTheme()` verbatim** (`apps/web/app/lib/teamTheme.ts`, 137
  pure lines: 32 palettes + WCAG luminance/chroma helpers) as
  `TeamTheme(teamId)` → Compose colors via CompositionLocal, applied only to
  accent-family slots — backgrounds and neutrals never recolor. Ignore
  `--chart`/`--chart-strong`: declared but consumed by nothing.
- **Typography:** Geist Variable is the only bundled asset in the repo; iOS
  needs a TTF/OTF cut. The web scale (14px body) is tight for a phone —
  step it up and support Dynamic Type rather than transcribing 1:1.
- **Assets are net-new:** no app icon, splash, favicon, or manifest exists
  anywhere. All imagery hotlinks `a.espncdn.com` — async loading with the
  web's initials-avatar/hide fallbacks is mandatory.
- **Privacy:** the repo has zero analytics/telemetry/crash reporting — an
  honest "Data Not Collected" App Privacy label is available. Preserve it
  deliberately; don't lose it by reflexively adding SDKs.

## 8. App Store risks

| Risk | Position |
|---|---|
| **NFL club marks** — 32 logos hotlinked from ESPN's CDN via a client-side URL template | Shipping marks inside a commercial binary ≠ a website hotlinking them (Guideline 5.2.1/5.2.5 + NFL/ESPN terms). No license evidenced in repo. Mitigation exists: text/color-only team identity (theming carries it); decide in §9. |
| **Player likenesses** — headshots via nflverse/ESPN URLs | NFLPA group-licensing question for a commercial app. The web already degrades to initials avatars, so a headshot-free build is trivial; product acceptability is the question. |
| **nflverse redistribution** | Open data, but license/attribution posture needs explicit review before a paid-store binary; no attribution surface exists anywhere today. Add one regardless. |
| **Apple 4.2 minimum functionality** | A search box over a public API pattern-matches "repackaged website" — and the responsive web app is findable. Mitigate deliberately: native answer cards, Universal Links, on-device history, offline recents, native share, haptics, Dynamic Type. |
| **Refusals read as brokenness** | A reviewer typing three unsupported questions concludes the app doesn't work. Onboarding, example steering, and the refusal card's "here's what I can do" framing are launch-critical, and worth a sentence in App Review notes. |
| **Gambling adjacency** | Betting/odds already PRD non-goals; keeping the fantasy builder out of v1 completes the posture. `fantasy_points_ppr` as a stat is fine. |
| **Wire drift vs shipped binaries** | Untyped `rows` means an executor SELECT-list rename breaks a shipped app with no compile error anywhere. The §6.2 #5 CI gate + `ignoreUnknownKeys` are the mitigations. |

## 9. Open questions (owner decisions)

1. **Monetization:** free v1, or paid tier? "Paid" is a multi-week backend
   track (no auth, no billing exists), not a toggle.
2. **Imagery:** ship without club marks/headshots (initials + team-color
   identity) if licensing can't be cleared — or is licensed imagery a hard
   gate on submission?
3. **Scope fork:** is the ask-anything engine the entire app (the 9-feature
   v1 above), or must v1 also feel like a "sports app" (scores/standings —
   roughly triples the surface)?
4. **Timing vs kickoff:** mobile competes with Track B/D for the same weeks
   (see §11). Land v1 before, during, or after September?
5. **Refusal posture:** lean into "we refuse rather than guess" as
   marketing, or minimize visible refusals via aggressive steering? Shapes
   onboarding and App Review framing.
6. **SQL disclosure:** docs promise it, `redactAnswer()` forbids it. Ship it
   (one-line server change + UI) or drop the claim from the docs?
7. **Android:** fast-follow or explicitly deferred? Changes how much lands
   in commonMain from day one.
8. **Accounts:** is the "no accounts" non-goal permanent? If yes, mobile
   retention must be designed around anonymous on-device state only (no
   push, no favorites, no sync).
9. **Freshness contract:** data is weekly at best (and the cron is broken
   today). What does the app promise on a Sunday afternoon?

## 10. Doc drift found during this audit (fix alongside)

- CLAUDE.md routes all work through `docs/ENGINEERING.md`,
  `design-language.md`, `components.md` — none exist, in tree or history.
  Real mapping: engineering → TDD.md + ARCHITECTURE.md; design language →
  DESIGN_BRIEF.md; components → FRONTEND_SPEC.md §3.
- DESIGN_BRIEF.md foundations are entirely stale (emerald→lime accent, every
  surface/ink/type/spacing value). Brief mobile off `globals.css`, not docs.
- TDD.md says 21 intents / ~30 stats; `engine/spec.ts` defines 23 / 33.
  BACKEND_SCHEMA.md says "twelve tables"; `schema.sql` has 14.
- Advertised answer-card features (SQL disclosure, CSV export, query
  interpretation, source note) don't exist in the shipping web component.
- `.gitignore` ends with `/docs/` ("kept locally, never published") while
  the docs tree is tracked — new docs files are silently skipped by
  `git add` (this file was force-added). Remove the stale rule.
- README claims a Redis container; docker-compose defines only Postgres.
  CLAUDE.md says local Postgres on :5433; compose publishes 5432 (the 5433
  remap lives in a gitignored override).
- RLS + read-only role are claimed in docs but applied only by hand in the
  Supabase console — absent from `schema.sql`, so no second environment can
  be provisioned reproducibly.

## 11. Milestones

Mobile is a net-new track; ENGINEERING_PLAN's four tracks don't include it,
and its M3 "LAUNCH BAR" (early-September kickoff) must not slip for it.
Sequencing that respects that:

- **M-0 (this week, tiny):** fix the ingest cron default-season bug; start
  the doc-drift cleanup; decide §9 questions 1–4.
- **M-A (overlaps Track D, pre-kickoff):** §6.2 items 1–3 (versioned
  routes, paid plan + domain, rate-limit rework) — all but versioning are
  already launch-bar items for the *web* product.
- **M-B (parallel, no server dependency):** scaffold `apps/mobile`, DTO
  generation + CI gate, design-token/TeamTheme port, ask loop against the
  dev API. Nothing here blocks on M-A.
- **M-C (post-kickoff):** refusal/clarification wire fields, profile
  pagination, config endpoint, caching/compression; TestFlight beta of the
  9-feature v1.
- **M-D (target ~Nov 2026):** App Store submission — after imagery (§9.2)
  and review-framing (§8) decisions, with AASA + attribution shipped.

## 12. Success metrics

Inherit the web's answer-rate/correctness bars (PRD.md §7), plus mobile's
own: TestFlight → App Store conversion, D7 retention on the history screen,
questions-per-session, share-link taps that open the app (Universal Links),
crash-free sessions ≥ 99.5%, and — the one that validates the thesis —
refusal-card retry rate (a user who rephrases after an honest refusal is the
product working).
