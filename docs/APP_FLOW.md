# YunoBall — App Flow

> How a user moves through the product: routes, journeys, and states.
> Companion docs: [PRD.md](PRD.md) · [TDD.md](TDD.md) · [DESIGN_BRIEF.md](DESIGN_BRIEF.md)

## 1. Route map

Fourteen routes live under `apps/web/app/`:

| Route | Surface | Data source |
|---|---|---|
| `/` | Home: score ticker + dashboard (featured matchup, performers of the week, division/league/fantasy leaders, playoff picture, trending questions) | `/api/games`, `/api/games/performers`, `/api/standings`, `/api/leaderboards`, `/api/fantasy/players` |
| `/a/[id]` | Persisted answer page (the shareable result) — the surface every search lands on | `GET /api/search/answer/:shareId` |
| `/scores` | Week-by-week finals with season/week pickers | `/api/games` |
| `/games/[gameId]` | Game summary tab (`GameExperience`) | `/api/games/:gameId/boxscore` |
| `/games/[gameId]/box` | Box score tab — both teams' player stat lines (same `GameExperience`) | `/api/games/:gameId/boxscore` |
| `/standings` | Conference → division standings, season picker | `/api/standings` |
| `/leaders` | League leaders hub: every player category as a dense sortable board, plus a team-rankings tab; team/position filters live in the URL | `/api/leaderboards`, `/api/standings` |
| `/leaderboards` | Not a surface — an 11-line server redirect to `/leaders`, preserving `?season` | — |
| `/players/[id]` | Player profile, tabbed: Overview, Splits, Game Log, Career, Playoffs | `/api/players/:id`, `/api/players/:id/splits` |
| `/teams` | All 32 teams as clickable cards grouped by division (records come from standings, so it needs no API of its own) | `/api/standings` |
| `/teams/[teamId]` | Team profile: record, ranks, leaders, key players, schedule | `/api/teams/:id` |
| `/fantasy` | PPR lineup builder over season production | `/api/fantasy/players` |
| `/assistant` | Chat-style tool-routing assistant (demo mode) | `POST /api/agent` |
| `/glossary` | Stat definitions | static |

Global navigation: a persistent top bar (`Nav`, mounted in the root layout)
carrying the inline search field plus NFL / Scores / Glossary / Fantasy
Builder. `/teams`, `/standings` and `/leaders` are reached from the dashboard
and from each other's rows rather than from the nav. Breadcrumbs (`Crumbs`,
via `PageHeader`) on drill-down pages.

## 2. The core journey: question → answer

```text
User types in the nav search field (Search, mounted in Nav)
  → GET /api/search/suggest (debounced)
      autocomplete: matching players (headshots), teams, supported questions
  → user submits (or picks a suggestion / example question)
  ├─ the text is exactly a team name/nickname/abbreviation
  │    → router.push("/teams/<team_id>"), no query runs
  └─ otherwise POST /api/search { question }
       engine: L1 cache → resolve → parse → L2 cache → build → execute → narrate
     → AnswerResult (always carries a share_id — refusals included)
     → router.push("/a/<share_id>")
          ResultExperience: question heading · New search · Share ·
          AnswerCard (narration · player card(s) · entity chips ·
          sortable table · comparison chart for head-to-head)
```

- Every answer — parsed *or* refused — is durably persisted under a
  deterministic `share_id` (SHA-256 prefix of the normalized question) before
  the user ever shares it, so the answer route can never race its own lookup.
- Submitting **navigates**; it does not render inline. The homepage stays a
  discovery surface, and only the transient states of the request (a
  "Computing answer…" line and an inline error with a retry button) appear
  beside the search field. A question that didn't parse still lands on
  `/a/<share_id>`, where the honest "can't answer that yet" narration renders
  in `.yb-answer`.
- `/?q=…` deep-links run the question on arrival and follow the same
  navigation, which is how the search field behaves from every other page.
- Still planned (per `search-results-audit.md`): a route-level action bar
  beyond share, query interpretation, SQL disclosure and CSV export.

### Answer drill-downs
Result rows link onward: player names → `/players/[id]`, teams →
`/teams/[teamId]`, single games → `/games/[gameId]`. Answers about one
player/team re-tint the accent system to that team's colors (see
[DESIGN_BRIEF.md](DESIGN_BRIEF.md) §3).

## 3. Browse journeys

**Scoreboard loop** — `/` ticker or `/scores` → pick season/week → game card
→ `/games/[gameId]` summary → `/games/[gameId]/box` box score → tap a stat
line → `/players/[id]`.

**Standings loop** — `/standings` → season picker → division tables → team →
`/teams/[teamId]` → schedule row → box score.

**Team browse loop** — `/teams` → all 32 teams as cards grouped by division
(conference jump links) → `/teams/[teamId]`.

**Leaders loop** — `/leaders` (defaults to the latest loaded season; team and
position filters live in the URL) → board row → player profile →
splits/game-log tabs → questions about that player via search. The legacy
`/leaderboards` URL redirects here, carrying `?season` along.

**Fantasy loop** — `/fantasy` → sort/filter player pool (position, per-game
rates) → fill lineup slots → player links for due diligence.

## 4. Assistant flow

```text
/assistant chat input
  → POST /api/agent { message, history }
  → intent routing over the same services (search, standings, leaderboards…)
  → reply + visible tool steps (mode: "demo")
```

The assistant never free-generates numbers — it routes to the same trusted
endpoints and reports which tools it used.

## 5. Share flow

1. On `/a/<share_id>`, the "Share" button copies the current URL
   (`https://<host>/a/<share_id>`) and flips to "Link copied" for two seconds.
2. Recipient opens `/a/<share_id>` → `ResultExperience` fetches the persisted
   `AnswerResult` from `GET /api/search/answer/:shareId` → same AnswerCard
   experience, no recomputation. A missing id renders "Result not found" with
   a path back to search.
3. Planned: a fuller route-level action bar (CSV, methodology) and clean PNG
   export of the rendered card (Track C in
   [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md)).

## 6. States & edge behavior

| State | Behavior |
|---|---|
| Loading | Skeleton components (shimmer), per-surface |
| Unparseable question | Honest refusal narration on `/a/<share_id>`; never a guess. Supported-question examples are seeded elsewhere — the Trending Questions dashboard card and the search autocomplete |
| Ambiguous entity | Fuzzy resolver picks best match above confidence floor; resolved entities are always displayed so the interpretation is visible |
| Empty result (parsed, zero rows) | Honest "no qualifying rows" narration |
| API error | Friendly error copy + retry (kept on the requesting surface) |
| Unplayed/postponed game | Stored with NULL scores; rendered as not-final |
| Rate limit (30/min/IP default) | 429 on `/api/search` and `/api/agent` |
| Share id not found | `/a/` not-found state with a path back to search |
