# YunoBall — App Flow

> How a user moves through the product: routes, journeys, and states.
> Companion docs: [PRD.md](PRD.md) · [TDD.md](TDD.md) · [DESIGN_BRIEF.md](DESIGN_BRIEF.md)

## 1. Route map

| Route | Surface | Data source |
|---|---|---|
| `/` | Home: search (in the nav) + dashboard (score ticker, featured matchup, fact of the day, top performers, standings snapshot, leaders, playoff picture, trending questions) | `/api/games`, `/api/games/performers`, `/api/standings`, `/api/leaderboards`, `/api/fantasy/players`, `/api/facts/today`, `/api/search/examples` |
| `/a/[shareId]` | Persisted answer page (the shareable result) | `GET /api/search/answer/:shareId` |
| `/scores` | Week-by-week finals with season/week pickers | `/api/games`, `/api/games/performers` |
| `/games/[gameId]` | Game summary — team comparison, top performers, scoring log, game info | `/api/games/:gameId/boxscore` |
| `/games/[gameId]/box` | Box score tab — both teams' player stat lines, by category (same fetch as the summary) | `/api/games/:gameId/boxscore` |
| `/standings` | Conference → division standings, season picker | `/api/standings` |
| `/leaders` | League leaders hub: every player category as a dense sortable table, plus a team-rankings tab; team/position filters live in the URL | `/api/leaderboards`, `/api/standings` |
| `/leaderboards` | Legacy path — server-side redirect to `/leaders`, carrying `?season` through | — |
| `/players/[playerId]` | Player profile: bio, career, seasons (REG/POST), game log, TD log, splits | `/api/players/:id`, `/api/players/:id/splits` |
| `/teams` | All 32 teams as cards, grouped by division; records come from standings, so the page owns no endpoint | `/api/standings` |
| `/teams/[teamId]` | Team profile: record, ranks, leaders, key players, schedule | `/api/teams/:id` |
| `/facts` | Fact archive: everything the nightly miner has surfaced, most surprising first, each row carrying its own coverage window | `/api/facts` |
| `/fantasy` | PPR lineup builder over season production | `/api/fantasy/players` |
| `/assistant` | Chat-style tool-routing assistant; gated behind a Pro paywall unless `NEXT_PUBLIC_ASSISTANT_ENABLED=true` | `POST /api/agent` |
| `/glossary` | Stat definitions | static |

Global navigation: primary sections plus the search entry point, as an
always-visible rail on desktop and a modal drawer on mobile (search lives in
the nav, not buried in a page). Breadcrumbs (`Crumbs`) on drill-down pages.

## 2. The core journey: question → answer

```text
User types in the search box
  → GET /api/search/suggest (debounced)
      autocomplete: matching players (headshots), teams, supported questions
  → user submits (or picks a suggestion / example question)
      a bare team name ("eagles", "kansas city chiefs") short-circuits
      straight to /teams/<id> — that isn't a question, it's navigation
  → POST /api/search { question }
      engine: L1 cache → resolve → parse → L2 cache → build → execute → narrate
  → AnswerResult (always carries a share_id) → push to /a/<share_id>
      ├─ parsed & answered → AnswerCard
      │    narration · player card(s) · resolved-entity chips · sortable
      │    table; single-player and head-to-head intents render through
      │    their own components (SinglePlayerResult, PlayerComparisonResult)
      └─ didn't parse → same result page, honest "can't answer that yet"
           narration and no rows
```

- Every answer — a refusal included — is durably persisted under a
  deterministic `share_id` (SHA-256 prefix of the normalized question) before
  the response returns, so `/a/<share_id>` can never race its own lookup.
- Submit navigates to `/a/<share_id>`, which owns the full result experience
  (loading skeleton, retry, not-found, share); the homepage stays a discovery
  surface. This is the target behavior `search-results-audit.md` called for,
  now shipped.
- The card shows no SQL, no parsed spec and no audit verdict: the server
  redacts all three before the answer crosses the wire, so there is nothing on
  the client to disclose.

### Answer drill-downs
Result rows link onward: player names → `/players/[id]`, teams →
`/teams/[id]`, single games → `/games/[gameId]`. Answers about one
player/team re-tint the accent system to that team's colors (see
[DESIGN_BRIEF.md](DESIGN_BRIEF.md) §3).

## 3. Browse journeys

**Scoreboard loop** — `/` ticker or `/scores` → pick season/week → game card
→ `/games/[id]` summary → box-score tab → tap a stat line → `/players/[id]`.

**Standings loop** — `/standings` → season picker → division tables → team →
`/teams/[id]` → schedule row → box score.

**Leaders loop** — `/leaders` (defaults to latest loaded season) → board
row → player profile → splits/game-log tabs → questions about that player via
search.

**Fantasy loop** — `/fantasy` → sort/filter player pool (position, per-game
rates) → fill lineup slots → player links for due diligence.

**Facts loop** — the Fact of the Day card sits second on the dashboard,
directly under the featured matchup, because a surprising number is the most
repeatable reason to come back. "More facts" → `/facts` archive (most
surprising first) → "Check the numbers" re-runs the fact as a search, landing
on `/a/<share_id>`; player facts also link straight to the profile. `/facts`
is not in the nav — the home card is its doorway.

## 4. Assistant flow

```text
/assistant chat input
  → POST /api/agent { messages }   (the last 20 turns, no more)
  → intent routing over the same services (search, standings, leaderboards…)
  → reply + visible tool steps (mode: "demo")
```

The assistant never free-generates numbers — it routes to the same trusted
endpoints and reports which tools it used. `mode: "demo"` is not a placeholder
for a smarter mode: the LLM tool-calling layer was dropped, so routing is the
whole product. The page itself is behind a Pro paywall until the flag flips,
so most users meet the upsell rather than the chat.

## 5. Share flow

1. Any answer already lives at `/a/<share_id>`; its "Share" button copies that
   URL and reads "Link copied" for two seconds.
2. Recipient opens `/a/<share_id>` → server fetches the persisted
   `AnswerResult` → same AnswerCard experience, no recomputation.
3. The route-level action bar (New search · Share) has shipped; a clean PNG
   export of the rendered card is still planned (Track C in
   [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md)).

## 6. States & edge behavior

| State | Behavior |
|---|---|
| Loading | Skeleton components (shimmer), per-surface |
| Unparseable question | Honest refusal narration + supported-question examples; never a guess |
| Ambiguous entity | Fuzzy resolver picks best match above confidence floor; resolved entities are always displayed so the interpretation is visible |
| Empty result (parsed, zero rows) | Honest "no qualifying rows" narration |
| Empty fact backlog | The home Fact of the Day card omits itself entirely — a missing fact is not an error, and a failed `/api/facts/today` hides it the same way; `/facts` says facts appear once the mining job has run |
| API error | Friendly error copy + retry (kept on the requesting surface) |
| Unplayed/postponed game | Stored with NULL scores; rendered as not-final |
| Rate limit (30/min/IP default) | 429 on `/api/search` and `/api/agent`; read endpoints count in their own 120/min bucket |
| Share id not found | `/a/` not-found state with a path back to search |
