# YunoBall — Product Requirements Document

> Status: current product + roadmap · Last updated 2026-07-17
> Companion docs: [TDD.md](TDD.md) · [APP_FLOW.md](APP_FLOW.md) · [DESIGN_BRIEF.md](DESIGN_BRIEF.md) · [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md) · [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md)

## 1. Product summary

YunoBall is **the all-in-one NFL platform where every number is computed from
real data** — an improved take on StatMuse, NFL-first. Users ask questions in
plain English and get exact, sourced answers; around that core sit scores,
standings, leaderboards, player/team profiles, a fantasy lineup surface, and a
tool-routing assistant — all served from one authoritative warehouse
(nflverse, 1999–present).

**Core thesis:** a stats product lives or dies on accuracy. Free-form LLM
generation hallucinates numbers, so YunoBall never generates a number. A
deterministic parser translates a question into a typed `QuerySpec`; a
template builder writes safe SQL; Postgres is the source of truth. Every
answer can show the exact SQL and rows behind it.

## 2. Target users

| Persona | Need | What they use |
|---|---|---|
| The stats-curious fan | "Who led the league in rushing in 2003?" answered instantly, correctly | Search, answer pages |
| The debate settler | Proof to win an argument — a number *with receipts* | Search, SQL disclosure, share links |
| The fantasy player | Season production, per-game rates, weekly performers, lineup ideas | Fantasy, leaderboards, performers, player pages |
| The browser | Scores, standings, and leaders without asking anything | Hub pages (`/scores`, `/standings`, `/leaderboards`) |

## 3. Problems we solve

1. **LLM sports answers can't be trusted** — chatbots hallucinate stats.
   YunoBall computes every number from warehouse facts; zero LLM calls in the
   answer path.
2. **StatMuse is a black box** — you get a number, not the query behind it.
   YunoBall exposes the SQL, the resolved entities, the interpretation, and
   the source rows for every answer.
3. **Stats sites fragment the experience** — scores here, splits there,
   fantasy elsewhere. YunoBall serves them all from one warehouse with one
   design language.

## 4. Feature requirements (shipped)

### 4.1 Natural-language search (the core)
- Free-text question box with autocomplete (players, teams, supported questions).
- Deterministic answer pipeline: fuzzy entity resolution → rule-based parse to
  a typed `QuerySpec` (21 intents: leaders, player totals, comparisons, game
  logs, streaks, milestones, drafts, team stats, bios, awards…) → allowlisted
  SQL → templated narration. See [TDD.md](TDD.md) §4.
- Scope grammar: seasons and ranges, REG/POST, playoff rounds, Super Bowl
  only, home/away, weeks, months, opponent, primetime, weather, rookie
  seasons, first/last-N games, per-game and median rates.
- **Honesty rule:** questions that don't parse get "can't answer that yet" —
  never a guess. A second-layer auditor records status, warnings, and
  confidence for every question.
- Every answer carries: narration, sortable result table, player identity
  card(s), query interpretation, SQL disclosure, CSV export, share action.

### 4.2 Shareable answers
- Every parsed answer gets a deterministic `share_id`; `/a/<share_id>` serves
  the persisted answer permanently (Postgres-backed).

### 4.3 Hub surfaces
- **Scores** (`/scores`) — week-by-week finals with box scores per game.
- **Standings** (`/standings`) — W-L-T, pct, PF/PA, diff, streak; computed
  live from game results; conference → division structure.
- **Leaderboards** (`/leaderboards`) — season stat leaders as dense tables;
  defaults to the most recent loaded season.
- **Top performers** — weekly fantasy-point leaders with stat lines.

### 4.4 Profiles
- **Player pages** (`/players/[id]`) — bio, career totals, season-by-season
  (REG + POST tabs), full game log with EPA columns, touchdown log, splits
  (home/road, wins/losses, month, conference, division, opponent), headshots.
- **Team pages** (`/teams/[id]`) — record and division rank, offense/defense
  stat ranks, team leaders, key players, season schedule/results; team-color
  themed.
- **Box scores** (`/games/[id]`) — full player stat lines for both teams.

### 4.5 Fantasy
- `/fantasy` — build a PPR lineup from real season production; sortable player
  pool with per-game rates.

### 4.6 Assistant
- `/assistant` — a tool-routing agent over the same trusted endpoints
  (currently demo mode; steps are surfaced to the user).

## 5. Non-functional requirements

| Requirement | Bar |
|---|---|
| **Accuracy** | A wrong number is worse than no answer. Ambiguous vocabulary is deliberately excluded from the parser (e.g. "pick" ≠ interception). |
| **Transparency** | Every answer must expose its SQL, entities, and interpretation. |
| **Latency** | Cached answers instant (two-tier cache); cold answers a single indexed query. No LLM in the loop. |
| **Cost** | Zero inference cost; one small Postgres + one Node service + static frontend. |
| **Safety** | SQL injection impossible by construction (allowlists + bound params); reads run under a read-only role; per-IP rate limiting on search/agent. |

## 6. Non-goals (current)

- Live in-progress game scores (data is release-file based; see roadmap).
- Betting/odds, projections, or ML predictions.
- User accounts, saved lineups, personalization.
- Sports beyond the NFL (the architecture allows it; the product doesn't yet).
- Full play-by-play storage (only touchdown events and per-game advanced
  aggregates are distilled from pbp).

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

1. **Query coverage expansion** — grow the answerable question space
   (team-stat questions over loaded-but-unused data, more splits, awards).
2. **Live/current-season data** — standalone ingestion worker with run
   tracking and resumable backfills; in-season freshness for the 2026 season.
3. **Product polish & UX** — dedicated `/a/` result experience with PNG
   export, team-color rollout, mobile, assistant beyond demo mode.
4. **Production hardening** — observability, SEO for share pages, deploy
   reliability, cost posture.
