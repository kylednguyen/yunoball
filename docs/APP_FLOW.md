# YunoBall — App Flow

> How a user moves through the product: routes, journeys, and states.
> Companion docs: [PRD.md](PRD.md) · [TDD.md](TDD.md) · [DESIGN_BRIEF.md](DESIGN_BRIEF.md)

## 1. Route map

| Route | Surface | Data source |
|---|---|---|
| `/` | Home: search box + dashboard (score ticker, top performers, standings snapshot, leaders) | `/api/games`, `/api/games/performers`, `/api/standings`, `/api/leaderboards` |
| `/a/[shareId]` | Persisted answer page (the shareable result) | `GET /api/search/answer/:shareId` |
| `/scores` | Week-by-week finals with season/week pickers | `/api/games` |
| `/games/[gameId]` | Game summary; `/box` the full box score; `/plays` the field view — every play drawn on the field with a stepper and drive list | `/api/games/:gameId/boxscore`, `/api/games/:gameId/plays` |
| `/standings` | Conference → division standings, season picker | `/api/standings` |
| `/leaderboards` | Season stat leader boards (dense tables) | `/api/leaderboards` |
| `/leaders` | Leaders overview | `/api/leaderboards` |
| `/players/[playerId]` | Player profile: bio, career, seasons (REG/POST), game log, TD log, splits | `/api/players/:id`, `/api/players/:id/splits` |
| `/teams/[teamId]` | Team profile: record, ranks, leaders, key players, schedule | `/api/teams/:id` |
| `/fantasy` | PPR lineup builder over season production | `/api/fantasy/players` |
| `/assistant` | Chat-style tool-routing assistant (demo mode) | `POST /api/agent` |
| `/glossary` | Stat definitions | static |

Global navigation: top bar with primary sections and the search entry point
(search lives in the nav, not buried in a page). Breadcrumbs (`Crumbs`) on
drill-down pages.

## 2. The core journey: question → answer

```text
User types in the search box
  → GET /api/search/suggest (debounced)
      autocomplete: matching players (headshots), teams, supported questions
  → user submits (or picks a suggestion / example question)
  → POST /api/search { question }
      engine: L1 cache → resolve → parse → L2 cache → build → execute → narrate
  → AnswerResult
      ├─ parsed & answered → AnswerCard
      │    narration · player card(s) · sortable table · comparison chart
      │    (head-to-head) · query interpretation · SQL disclosure ·
      │    CSV export · share (copies /a/<share_id>)
      └─ didn't parse → honest "can't answer that yet" + example questions
```

- Every parsed answer is durably persisted under a deterministic `share_id`
  (SHA-256 prefix of the normalized question) before the user ever shares it.
- **Current behavior:** the answer renders inline on the homepage below the
  search field. **Target behavior** (per `search-results-audit.md`): submit
  navigates to `/a/<share_id>`, which owns the full result experience
  (loading, retry, export); the homepage stays a discovery surface.

### Answer drill-downs
Result rows link onward: player names → `/players/[id]`, teams →
`/teams/[id]`, single games → `/games/[gameId]`. Answers about one
player/team re-tint the accent system to that team's colors (see
[DESIGN_BRIEF.md](DESIGN_BRIEF.md) §3).

## 3. Browse journeys

**Scoreboard loop** — `/` ticker or `/scores` → pick season/week → game card
→ `/games/[id]` box score → tap a stat line → `/players/[id]`.

**Standings loop** — `/standings` → season picker → division tables → team →
`/teams/[id]` → schedule row → box score.

**Leaders loop** — `/leaderboards` (defaults to latest loaded season) → board
row → player profile → splits/game-log tabs → questions about that player via
search.

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

1. Any answer → "share" copies `https://<host>/a/<share_id>`.
2. Recipient opens `/a/<share_id>` → server fetches the persisted
   `AnswerResult` → same AnswerCard experience, no recomputation.
3. Planned: route-level action bar and clean PNG export of the rendered card
   (Track C in [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md)).

## 6. States & edge behavior

| State | Behavior |
|---|---|
| Loading | Skeleton components (shimmer), per-surface |
| Unparseable question | Honest refusal narration + supported-question examples; never a guess |
| Ambiguous entity | Fuzzy resolver picks best match above confidence floor; resolved entities are always displayed so the interpretation is visible |
| Empty result (parsed, zero rows) | Honest "no qualifying rows" narration |
| API error | Friendly error copy + retry (kept on the requesting surface) |
| Unplayed/postponed game | Stored with NULL scores; rendered as not-final |
| Rate limit (30/min/IP default) | 429 on `/api/search` and `/api/agent` |
| Share id not found | `/a/` not-found state with a path back to search |
