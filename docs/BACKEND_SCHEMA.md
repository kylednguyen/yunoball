# YunoBall — Backend Schema

> The Postgres warehouse: a star model over nflverse data.
> Source of truth: `apps/server/src/db/schema.sql` (idempotent —
> `pnpm db:migrate` is safe on a fresh or existing database).

## 1. Shape

```
seasons ◄────────── games ──────────► teams
   ▲                  ▲                 ▲
player_season_stats   ├── player_game_stats    (player × game)
   │                  ├── player_game_advanced (pbp aggregates)
   ▼                  ├── team_game_stats      (team × game)
players ◄─────────────┴── scoring_plays        (touchdown events)
   ▲
   └── rosters                                 (player × season × team)

app tables: answer_cache · query_audit        history: draft_picks
crosswalk:  player_id_map (gsis → espn/pfr/pff/otc/esb ids + headshot, no FK)
```

Fourteen tables in all:

- **Dimensions:** `seasons`, `teams`, `players`, `games`
- **Facts:** `player_game_stats`, `team_game_stats`, `player_game_advanced`,
  `scoring_plays`, `rosters`
- **Rollups:** `player_season_stats`
- **Crosswalk:** `player_id_map` (cross-source ids + nflverse headshot URL)
- **App:** `answer_cache` (durable shareable answers), `query_audit`
  (per-question audit log)
- **History:** `draft_picks` (1980+, deliberately no season FK)

## 2. Conventions

- **Idempotent DDL.** `CREATE TABLE IF NOT EXISTS` everywhere; later columns
  are added with `ADD COLUMN IF NOT EXISTS` widening blocks at the bottom of
  `schema.sql`. Fourteen tables — this beats a migration framework.
- **Stable identifiers.** `players.player_id` = nflverse gsis id;
  `games.game_id` = canonical nflverse schedule id; `teams.team_id` =
  *current-franchise* abbreviation with relocations folded forward (e.g. the
  2015 St. Louis Rams live under `LAR`).
- **Season typing.** `season_type` is `REG | POST`; playoff rounds are
  collapsed to `POST` at ingest, with rounds recovered at query time by
  ranking weeks within a postseason.
- **NULL means unplayed.** Postponed/unplayed games keep NULL scores rather
  than being dropped.
- **Reads run least-privilege** when `READONLY_DATABASE_URL` is configured.

## 3. Table reference

### seasons
`season int PK`, `start_date`, `end_date`. One row per loaded season
(1999–present).

### teams
`team_id varchar PK` (current franchise abbr), `name`, `nickname`,
`conference` (AFC|NFC), `division`, `color`, `color2` (brand hexes).

### players
`player_id varchar PK` (gsis), `full_name` (indexed), `first_name`,
`last_name`, `position`, `birth_date`, `height_inches`, `weight_lbs`,
`college`, `rookie_season`, `jersey_number`, plus `espn_id` and
`headshot_url` — synced from `player_id_map` by the `player_ids` ingest step
and the source the API serves headshots from.

### games
`game_id varchar PK`, `season → seasons`, `week`, `season_type` (REG|POST),
`game_date`, `home_team → teams`, `away_team → teams`, `home_score` /
`away_score` (NULL until played), `stadium`, `roof`, `surface`, plus split
metadata: `weekday`, `gametime`, `temp`, `wind`, `home_coach`, `away_coach`.
Indexes: `(season, week)`, `(season, season_type)`, `home_team`, `away_team`.

### player_game_stats — PK (player_id, game_id)
One row per player per game, `team_id` for that game. Offense: completions,
attempts, passing_yards/tds, interceptions, sacks (taken) + sack_yards,
carries, rushing_yards/tds, targets, receptions, receiving_yards/tds,
fumbles(+lost), passing/receiving_air_yards, fantasy_points_ppr. Defense:
tackles (solo+assist), def_sacks, def_interceptions, forced_fumbles,
passes_defended. Indexes: game_id, team_id.

### player_season_stats — PK (player_id, season, season_type)
The REG/POST season rollup of the same stat set plus `games_played` and
`team_id`. Indexes: season, `(season, season_type)`, `(team_id, season)` —
these carry leaderboards and "players on team X in year Y".

### team_game_stats — PK (team_id, game_id)
Per-team-game: `is_home`, points_for/against, total/passing/rushing_yards,
turnovers, time_of_possession_sec, `drives`, `result` (W|L|T). Powers
standings, team stat ranks, and points/per-drive questions.

### player_game_advanced — PK (player_id, game_id)
Play-by-play distilled to per-player-game aggregates, split by role:
pass/rush/recv `_plays`, `_epa`, `_success` counts, plus `cpoe_sum`/`cpoe_n`.
Powers EPA, success-rate, and CPOE stats without storing full pbp.

### scoring_plays — PK play_id (game_id + play number)
Touchdown events only (~1.4k rows/season vs ~50k pbp rows): `game_id`,
`player_id` (the scorer), `team_id`, `qtr`, `play_type`, `description`,
`yards`. Powers first/last-TD questions, longest-TD lookups, and the
player-page touchdown log. Indexed by player and game.

### rosters — PK (player_id, season, team_id)
Which team a player was on each season, with `position`, `jersey_number`,
`status`. A mid-season move produces one row per team. Index:
`rosters_team_season_idx (team_id, season)`. Powers "who wore #18 for the
Colts in 2004" — the per-season history `players` deliberately flattens away
(that dimension keeps only the latest snapshot per player).

### player_id_map — PK player_id (gsis)
Cross-source id crosswalk from the nflverse players release: `espn_id`,
`pfr_id`, `pff_id`, `otc_id`, `esb_id`, `headshot_url`. A full snapshot with
**no FK** — it covers players outside the loaded 1999+ seasons and is the
dedup backbone for any future second source (join on ids, never on names).
The `player_ids` ingest step syncs `espn_id` + `headshot_url` forward onto
`players`.

### draft_picks — PK (season, pick)
nflverse draft history 1980+: round, pick, `team_id` (normalized to current
franchise), `player_id` (gsis when available — joins `players`),
`player_name`, position, college. **No season FK on purpose:** the draft runs
ahead of/behind the loaded stats seasons.

### query_audit
Append-only auditor log — one structured record per answered question:
`asked_at`, `question`, `spec jsonb`, `status`, `warnings jsonb`,
`confidence jsonb`, `row_count`, `duration_ms`. Stores decisions, never
free-form reasoning. This is the measurement substrate for answer-rate
metrics.

### answer_cache
Durable shareable answers behind `/a/<share_id>`: `share_id` (unique,
deterministic 32-char SHA-256 prefix of the normalized question),
`question`, `normalized_question` (unique), `sql`, `answer_json`, `hits`,
`created_at`. Fronted by the in-process cache. **No TTL:** rows are inserted
without an expiry and nothing sweeps them —
`ANSWER_CACHE_TTL_SECONDS` bounds only the in-process LRU in
`apps/server/src/lib/cache.ts`, despite the shared name. The table grows one
row per distinct normalized question; repeats bump `hits`. The stored `sql`
is server-side only: `redactAnswer()` blanks it before any HTTP response.

## 4. Index strategy

Indexes exist for the query shapes the engine actually emits:

| Shape | Index |
|---|---|
| Leaderboards: season + type filter, sort by stat | `pss_season_type_idx (season, season_type)` |
| Roster/team-season: "players on X in Y" | `pss_team_season_idx (team_id, season)` |
| Week slate / REG-POST scans | `games_season_week_idx`, `games_season_type_idx` |
| Game-log joins | `pgs_game_idx`, `pga_game_idx`, `tgs_game_idx` |
| Name lookup fallback | `players_full_name_idx` |
| TD timeline per player/game | `scoring_plays_player_idx`, `scoring_plays_game_idx` |
| Roster/jersey by team-season | `rosters_team_season_idx (team_id, season)` |

## 5. Ingestion → schema mapping

`pnpm ingest:nfl [--season N | --all | --years …] [--season-type REG] [--dry-run] [--no-cache]`

- With no season selector the CLI ingests the season in progress. A GitHub
  Actions cron (`.github/workflows/ingest.yml`) runs it bare — i.e. the
  current season — every Tuesday at 10:00 UTC, once Monday-night stats have
  landed; `workflow_dispatch` takes an optional `season` input for backfills.
- nflverse release CSVs → normalize (stable ids, relocation folding,
  REG/POST collapse) → zod-validate (skip + log malformed rows, end-of-run
  tally) → **batched idempotent upserts** in transactions with per-dataset
  failure isolation.
- Play-by-play is distilled at ingest into `scoring_plays` (TD events),
  `player_game_advanced` (EPA/success/CPOE), TD `yards`, and per-game
  `drives` — full pbp is never stored.
- Headshots are warehouse data, not a side file: the `player_ids` step loads
  the nflverse crosswalk into `player_id_map` and syncs `espn_id` +
  `headshot_url` onto `players`. At boot `apps/server/src/lib/espn.ts` reads
  those two columns into an in-memory map, preferring nflverse's
  `headshot_url` and falling back to an ESPN CDN URL built from `espn_id`;
  players with neither degrade to initials avatars.

## 6. Environments

- **Local:** Docker Postgres (`docker-compose.yml` publishes host port
  **5432**; the 5433 remap some setups use lives in a gitignored
  `docker-compose.override.yml`). Schema + data via `pnpm db:migrate` +
  `pnpm ingest:nfl`.
- **Production:** Supabase Postgres, connected through the **session pooler**
  (port 5432 — never the 6543 transaction pooler; the API is a persistent
  server).
- **Access control is not in this repo.** `schema.sql` contains no
  `ROW LEVEL SECURITY`, `CREATE POLICY`, or `GRANT` statements. The intended
  posture — RLS on with read-only policies, the API on its own role, and a
  separate read-only role behind `READONLY_DATABASE_URL` for engine-executed
  SQL — is applied by hand in the Supabase console. Only the
  `READONLY_DATABASE_URL` half is reproducible from the repo (it is just an
  env var); the RLS and grant half is not, so `pnpm db:migrate` against a
  fresh database gives you the tables and none of the policies.

## 7. Planned schema work

See [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md). Highlights: ingestion
run/source tracking tables for the standalone worker (Track B); wider splits
metadata as query coverage grows (Track A); no destructive changes — the
widening-ALTER convention continues.
