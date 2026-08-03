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
   └── rosters (player × season × team) · player_id_map (id crosswalk)

app tables: answer_cache · query_audit        history: draft_picks
mined facts: stat_facts ◄── fact_of_the_day
```

- **Dimensions:** `seasons`, `teams`, `players`, `games`
- **Facts:** `player_game_stats`, `team_game_stats`, `player_game_advanced`,
  `scoring_plays`
- **Rollups:** `player_season_stats`
- **Bridges:** `rosters` (who was on which team each season), `player_id_map`
  (gsis id → every other provider's id)
- **App:** `answer_cache` (durable shareable answers), `query_audit`
  (per-question audit log)
- **Mined facts** (a different sense of "fact" — not the star-schema one):
  `stat_facts` (probe output), `fact_of_the_day` (one published row per day)
- **History:** `draft_picks` (1980+, deliberately no season FK)

<!-- figure: schema-er -->

## 2. Conventions

- **Idempotent DDL.** `CREATE TABLE IF NOT EXISTS` everywhere; later columns
  are added with `ADD COLUMN IF NOT EXISTS` widening blocks at the bottom of
  `schema.sql`. Sixteen tables — this beats a migration framework.
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
`headshot_url` synced from `player_id_map` by the ingest's player-ids step.
**`rookie_season` is declared but never written:** no pipeline maps it, so it
is NULL in every row — the engine's "before season N" window guards on
`rookie_season IS NOT NULL` and therefore returns nothing until a source fills
it.

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
passes_defended.

Widened with 31 further columns taken from the *same* `stats_player` files the
ingest already downloads — nflverse ships 145 columns there and the original
mapping consumed 24, which left every kicker and punter unrepresented in the
warehouse. Nothing below costs an extra fetch:

- **Kicking:** `fg_made`, `fg_att`, `fg_long`, `fg_made_50_plus` (nflverse
  buckets makes by distance; this is the 50–59 and 60+ buckets summed),
  `gwfg_made` / `gwfg_att` (game-winners), `pat_made`, `pat_att`.
- **Punting:** `punts`, `punt_yards`, `punt_long`, `punt_net_yards`,
  `punts_inside_20`, `punts_blocked` (nflverse names these `pt_*`).
- **Returns:** `punt_returns`, `punt_return_yards`, `kick_returns`,
  `kick_return_yards`, `special_teams_tds`.
- **Situational:** `passing_first_downs`, `rushing_first_downs`,
  `receiving_first_downs`, `passing_yards_after_catch`,
  `receiving_yards_after_catch`, `penalties`, `penalty_yards`.
- **Extended defense:** `def_tackles_for_loss`, `def_qb_hits`,
  `def_interception_yards`, `def_tds`, `def_safeties`.

Indexes: game_id, team_id.

### player_season_stats — PK (player_id, season, season_type)
The REG/POST season rollup of the game log's stat set — minus `carries`,
`targets` and the air-yards pair, which this table doesn't declare — plus
`games_played` and `team_id`. It has all 31 widened columns above: they
are defined once in `normalize.ts` and shared by both row schemas, so the two
grains can't drift apart. Indexes: season, `(season, season_type)`,
`(team_id, season)` — these carry leaderboards and "players on team X in
year Y".

### team_game_stats — PK (team_id, game_id)
Per-team-game: `is_home`, points_for/against, `drives`, `result` (W|L|T), plus
the box score from the nflverse `stats_team` release: total/passing/rushing
yards, `turnovers` (interceptions thrown + fumbles lost — downs are not
turnovers), `first_downs`, `penalties`, `penalty_yards`, `sacks_taken`,
`def_sacks`, `fg_made`, `fg_att`, `passing_epa`, `rushing_epa`. Powers
standings, team stat ranks, and points/per-drive questions.

Three caveats worth knowing before you query it:

- The first four box-score columns (total_yards, passing_yards, rushing_yards,
  turnovers) were declared when the table was created but **never written** —
  the loader built rows from the schedule alone, so they were NULL in every
  production row. The `stats_team` fetch now fills them. Every box-score column
  is nullable because that fetch is best-effort: if the release is unavailable
  the row still carries the result, as it always did.
- `first_downs` is *scrimmage* first downs (passing + rushing), not the
  box-score total: at team grain receiving_first_downs counts the same plays as
  passing_first_downs, and penalty first downs aren't published.
- **`time_of_possession_sec` is still never populated.** nflverse does not
  publish it in `stats_team`; it is derivable from play-by-play drive timing,
  which is future work. The game service still selects it and the game page
  still lists it, but that page drops any team-stat row that is null on both
  sides — so it goes missing rather than showing a wrong number.

### player_game_advanced — PK (player_id, game_id)
Play-by-play distilled to per-player-game aggregates, split by role:
pass/rush/recv `_plays`, `_epa`, `_success` counts, plus `cpoe_sum`/`cpoe_n`.
Powers EPA, success-rate, and CPOE stats without storing full pbp.

### scoring_plays — PK play_id (game_id + play number)
Touchdown events only (~1.4k rows/season vs ~50k pbp rows): `game_id`,
`player_id` (the scorer), `team_id`, `qtr`, `play_type`, `description`,
`yards`, `td_kind`. Powers first/last-TD questions, longest-TD lookups, and the
player-page touchdown log. Indexed by player and game. `td_kind` is classified
at ingest from the pbp's own discriminator columns
(pass | rush | int_return | fumble_return | kick_return | punt_return | other)
rather than at query time: int_return + fumble_return *are* the defensive
touchdowns, and "other" catches own-fumble and blocked-kick recoveries that
description matching would miscount as defensive.

### rosters — PK (player_id, season, team_id)
Full historical rosters — which team a player was on each season, with
`position`, `jersey_number` and `status`. A mid-season move produces a row per
team, which is why `team_id` is in the key. Indexed `(team_id, season)`. This
is the fact behind "who wore #18 for the Colts in 2004"; `players` keeps only
the latest snapshot per player, so it can't answer that.

### player_id_map — PK player_id
Cross-source id crosswalk from the nflverse players release: gsis id →
`espn_id`, `pfr_id`, `pff_id`, `otc_id`, `esb_id`, plus `headshot_url`. Full
snapshot, **no FK** — it covers players beyond the loaded 1999+ seasons. This
is the dedup backbone for any future second source: join on ids, never names.

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
`created_at`. Fronted by the in-process cache; TTL via
`ANSWER_CACHE_TTL_SECONDS`.

### stat_facts — PK fact_id
Notable statistical facts mined from the warehouse by the probe registry
(`src/facts`). `fact_id` is a 24-char SHA-1 prefix of
(probe_id, variant key, subject_id, season, week), so re-mining upserts a fact
in place instead of duplicating it.

Identity and claim: `probe_id`, `family` (threshold | drought | streak | pace |
conjunction | anti), `subject_kind` (player | team), `subject_id` (**no FK** —
subjects can age out), `subject_name`, `season`, `week`, `season_type`,
`headline`, `metric`, `value`, `question` (a deep link into `/search`).

Provenance: `sql` and `evidence jsonb` (the peer rows behind the claim) are
NOT NULL — a fact that can't show its work doesn't ship, and the API serves
both on the detail route the way an answer card exposes its SQL. `headline` is
rendered by the probe's own template; no free-form text ever lands here.

Scoring and honesty: `population` (how many times this has happened in the
scanned era), `prior_season` (previous occurrence; NULL = never before),
`rarity`, `surprise`, and `coverage_floor` — the earliest season the probe
could actually see, derived from its source datasets at mine time. A claim may
never reach past its floor; see `assertCoverage()` in `facts/claim.ts` and
[FACTS.md](FACTS.md). Indexes: `surprise DESC`, `(season DESC, week DESC)`,
`(subject_kind, subject_id)`.

### fact_of_the_day — PK day
`day date`, `fact_id → stat_facts ON DELETE CASCADE`, `selected_at`. One
published fact per day. Selection is a pure function of the date over the
ranked backlog, so the cron job and the API compute the same answer and a
missed run self-heals on the next read — the write is `ON CONFLICT (day) DO
NOTHING`, so a re-run never swaps the fact out from under someone who already
read it.

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
| Roster history: "who was on X in Y" | `rosters_team_season_idx (team_id, season)` |
| Fact backlog: rank by surprise, subject cooldown | `stat_facts_surprise_idx`, `stat_facts_subject_idx` |

## 5. Ingestion → schema mapping

`pnpm ingest:nfl --season N | --all | --years … [--season-type REG] [--dry-run]`

- nflverse release CSVs → normalize (stable ids, relocation folding,
  REG/POST collapse) → zod-validate (skip + log malformed rows, end-of-run
  tally) → **batched idempotent upserts** in transactions with per-dataset
  failure isolation.
- Play-by-play is distilled at ingest into `scoring_plays` (TD events),
  `player_game_advanced` (EPA/success/CPOE), TD `yards`, and per-game
  `drives` — full pbp is never stored.
- `player_game_stats` and `player_season_stats` both come from `stats_player`
  (weekly file / REG+POST season files). The widened special-teams,
  situational and extended-defense columns are mapped by one shared function
  because the two release files use identical column names at both grains.
- `team_game_stats` is built from the schedule (result, points) and widened
  with the `stats_team` weekly release, keyed `game_id|team_id`. That fetch is
  best-effort per season: a failure warns and leaves the box-score columns
  null rather than failing the step, matching the per-dataset failure
  isolation the rest of the ingest guarantees.
- Every pipeline verifies its source columns before mapping (`checkColumns`):
  a missing *identity* column fails the run, a missing *stat* column warns
  loudly. Without this an upstream rename would coerce to null and summed
  stats would fabricate zeros — corrupt data with exit code 0.
- ESPN ids and headshot URLs come from the `player_id_map` step (the nflverse
  players release), which also syncs `espn_id` / `headshot_url` onto the
  `players` dimension the API reads.

## 6. Environments

- **Local:** Docker Postgres (`docker-compose.yml` publishes 5432; if that host
  port is taken, remap it in a `docker-compose.override.yml` and update
  `DATABASE_URL`). Schema + data via `pnpm db:migrate` + `pnpm ingest:nfl`.
- **Production:** Supabase Postgres, connected through the **session pooler**
  (port 5432 — never the 6543 transaction pooler; the API is a persistent
  server). RLS enabled with read policies; the API connects with its own
  role, with a read-only role for engine-executed SQL.

## 7. Planned schema work

See [ENGINEERING_PLAN.md](ENGINEERING_PLAN.md). Highlights: ingestion
run/source tracking tables for the standalone worker (Track B); wider splits
metadata as query coverage grows (Track A); no destructive changes — the
widening-ALTER convention continues.
