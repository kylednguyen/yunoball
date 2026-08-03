# YunoBall — Product Requirements Document

> Status: current product + roadmap · Last updated 2026-08-02
> Companion docs: [TDD.md](TDD.md) · [APP_FLOW.md](APP_FLOW.md) · [DESIGN_BRIEF.md](DESIGN_BRIEF.md) · [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md) · [FACTS.md](FACTS.md) · [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md)

## 1. Product summary

YunoBall is **the all-in-one NFL platform where every number is computed from
real data** — an improved take on StatMuse, NFL-first. Users ask questions in
plain English and get exact, sourced answers; around that core sit scores,
standings, league leaders, player/team profiles, a mined fact of the day, a
fantasy lineup surface, and a tool-routing assistant — all served from one
authoritative warehouse (nflverse, 1999–present).

**Core thesis:** a stats product lives or dies on accuracy. Free-form LLM
generation hallucinates numbers, so YunoBall never generates a number. A
deterministic parser translates a question into a typed `QuerySpec`; a
template builder writes safe SQL; Postgres is the source of truth. Every
answer ships with the rows it was computed from, and the SQL that produced it
is persisted alongside it — the query is kept so any published number can be
re-derived, not printed on the card.

## 2. Target users

| Persona | Need | What they use |
|---|---|---|
| The stats-curious fan | "Who led the league in rushing in 2003?" answered instantly, correctly | Search, answer pages |
| The debate settler | Proof to win an argument — a number *with receipts* | Search, source rows, share links |
| The fantasy player | Season production, per-game rates, weekly performers, lineup ideas | Fantasy, leaders, performers, player pages |
| The browser | Scores, standings, and leaders without asking anything | Hub pages (`/scores`, `/standings`, `/leaders`), fact of the day |

## 3. Problems we solve

1. **LLM sports answers can't be trusted** — chatbots hallucinate stats.
   YunoBall computes every number from warehouse facts; zero LLM calls in the
   answer path.
2. **StatMuse is a black box** — you get a number with nothing under it.
   Every YunoBall answer arrives with the rows it was computed from and the
   entities it resolved, and the query behind it is persisted server-side, so
   a disputed number can be audited after the fact.
3. **Stats sites fragment the experience** — scores here, splits there,
   fantasy elsewhere. YunoBall serves them all from one warehouse with one
   design language.

## 4. Feature requirements (shipped)

### 4.1 Natural-language search (the core)
- Free-text question box with autocomplete (players, teams, supported questions).
- Deterministic answer pipeline: fuzzy entity resolution → rule-based parse to
  a typed `QuerySpec` (23 intents: leaders, player totals, comparisons, game
  logs, streaks, milestones, drafts, team stats, bios, awards…) → allowlisted
  SQL → templated narration. See [TDD.md](TDD.md) §4.
- 55 allowlisted stats, now including kicking, punting, returns, first downs
  and yards after catch — the parser only accepts a stat the engine already
  knows how to compute, so the vocabulary and the coverage cannot drift apart.
- Scope grammar: seasons and ranges, REG/POST, playoff rounds, Super Bowl
  only, home/away, weeks, months, opponent, primetime, cold weather, rookie
  seasons, first/last-N games, per-game and median rates.
- **Honesty rule:** questions that don't parse get "can't answer that yet" —
  never a guess. A second-layer auditor records status, warnings, and
  confidence for every question.
- Every answer carries: narration, a sortable result table (player
  leaderboards get a leader drill-down card above it), player identity
  card(s), resolved-entity chips, and a share action. The SQL and the audit
  verdict are stripped at the HTTP boundary — warnings are already folded into
  the narration, so the card answers the question instead of explaining itself.

### 4.2 Shareable answers
- Every parsed answer gets a deterministic `share_id` (a hash of the
  normalized question); `/a/<share_id>` serves the persisted answer
  permanently (Postgres-backed).
- Asking a question navigates straight there rather than rendering the result
  inline, so the page a user reads is the page they send someone; it carries
  the copy-link action.

### 4.3 Hub surfaces
- **Scores** (`/scores`) — week-by-week finals with box scores per game.
- **Standings** (`/standings`) — W-L-T, pct, PF/PA, diff, streak; computed
  live from game results; conference → division structure.
- **League leaders** (`/leaders`) — 13 player categories as dense sortable
  tables, filterable by team and position, plus a whole-league team-rankings
  tab; defaults to the most recent loaded season. `/leaderboards` redirects
  here.
- **Teams** (`/teams`) — all 32 teams as cards grouped by division, records
  read off the standings endpoint so the page needs no API of its own.
- **Glossary** (`/glossary`) — every stat, fantasy term and league concept the
  product uses, defined in plain language.
- **Top performers** — weekly fantasy-point leaders with stat lines, on
  `/scores` and the home dashboard.

### 4.4 Profiles
- **Player pages** (`/players/[id]`) — Overview, Splits, Game Log, Career and
  Playoffs tabs (the last only when there are playoff rows): bio, career
  totals, season-by-season in totals or per-game, a position-aware game log,
  touchdown log, splits (home/road, wins/losses, month, opponent conference,
  opponent division, opponent), headshots.
- **Team pages** (`/teams/[teamId]`) — record and division rank,
  offense/defense stat ranks, team leaders, roster, season schedule/results;
  team-color themed.
- **Games** (`/games/[gameId]`) — summary: team comparison, top performers,
  scoring log, game info; `/games/[gameId]/box` is the full player stat lines
  for both teams.

### 4.5 Fantasy
- `/fantasy` — build a PPR lineup from real season production; player pool
  ranked by fantasy points, filterable by position and free-text, showing
  season total and per-game rate. The lineup persists in `localStorage`.

### 4.6 Assistant
- `/assistant` — a tool-routing agent over the same trusted endpoints; the API
  answers in demo mode and surfaces its steps. The page ships behind a Pro
  paywall unless `NEXT_PUBLIC_ASSISTANT_ENABLED=true`, because a half-built
  assistant costs more trust than an absent one.

### 4.7 Fact of the day
- One mined statistical fact published per day — "only the fourth 200-yard
  rushing game since 2019" — as a home-page card, with the archive at
  `/facts` ranked by how surprising each fact is.
- Facts are **mined, never generated**: reviewed SQL probes run on a schedule
  and the headline comes from the probe's own template. Every claim shows its
  population and how far back the record actually runs, because "since 1999"
  and "ever" are different claims and only one of them is provable here. See
  [FACTS.md](FACTS.md).
- Each fact links to its subject's player page and to the question that
  reproduces it, so a claim sits one click from the query behind it. The home
  card is additive — an empty backlog or a failed fetch hides it rather than
  degrading the dashboard.

## 5. Non-functional requirements

| Requirement | Bar |
|---|---|
| **Accuracy** | A wrong number is worse than no answer. Ambiguous vocabulary is deliberately excluded from the parser (e.g. "pick" ≠ interception). |
| **Transparency** | Every answer shows the rows it was computed from and the entities it resolved. The SQL and the audit verdict are recorded server-side (`answer_cache`, `query_audit`) instead of rendered — reproducible on demand, not clutter on the card. |
| **Latency** | Cached answers instant (two-tier cache); cold answers a single indexed query. No LLM in the loop. |
| **Cost** | Zero inference cost; one small Postgres + one Node service + static frontend. |
| **Safety** | SQL injection impossible by construction (allowlists + bound params); reads run under a read-only role; two-tier per-IP rate limiting — a tight bucket for search/agent, a more generous one for GET reads so normal browsing never trips it. |

## 6. Non-goals (current)

- Live in-progress game scores (data is release-file based; see roadmap).
- Betting/odds, projections, or ML predictions.
- User accounts and server-side personalization (the fantasy lineup persists
  in `localStorage` only).
- Sports beyond the NFL (the architecture allows it; the product doesn't yet).
- Full play-by-play storage (only touchdown events, per-game advanced
  aggregates and team drive counts are distilled from pbp).

## 7. Success metrics

- **Answer rate** — % of asked questions that parse and return an answer
  (measured via `query_audit`).
- **Correctness** — golden-case engine suite stays green; zero known-wrong
  answers ship.
- **Engagement** — share-link creation and `/a/` page visits; repeat
  questions served from cache.
- **Coverage** — supported question archetypes (see the query-space map),
  growing per [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md) Track A.

## 8. Roadmap summary

Four tracks, detailed in [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md):

1. **Query coverage expansion** — grow the answerable question space. The
   previously-unused columns are now written (team box scores, kicking,
   punting, returns); what remains is the question archetypes over them, more
   splits, and awards.
2. **Live/current-season data** — standalone ingestion worker with run
   tracking and resumable backfills; in-season freshness for the 2026 season.
3. **Product polish & UX** — the dedicated `/a/` result experience has landed;
   PNG export of a result, team-color rollout, mobile, assistant beyond demo
   mode.
4. **Production hardening** — observability, SEO for share pages, deploy
   reliability, cost posture.
