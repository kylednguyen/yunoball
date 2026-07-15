-- YunoBall warehouse schema — a star model over nflverse data.
--   Dimensions: seasons, teams, players, games
--   Facts:      player_game_stats, team_game_stats
--   Rollups:    player_season_stats
--   App:        answer_cache (durable shareable answers)
--
-- Idempotent (IF NOT EXISTS everywhere): `pnpm --filter @yunoball/server db:migrate`
-- is safe to run against a fresh database or an existing one.

CREATE TABLE IF NOT EXISTS seasons (
    season      integer PRIMARY KEY,
    start_date  date,
    end_date    date
);

CREATE TABLE IF NOT EXISTS teams (
    team_id     varchar PRIMARY KEY,  -- current franchise abbr, e.g. "KC"
    name        varchar NOT NULL,
    nickname    varchar,
    conference  varchar,              -- AFC | NFC
    division    varchar
);

CREATE TABLE IF NOT EXISTS players (
    player_id     varchar PRIMARY KEY,  -- nflverse gsis id
    full_name     varchar NOT NULL,
    first_name    varchar,
    last_name     varchar,
    "position"    varchar,
    birth_date    date,
    height_inches smallint,
    weight_lbs    smallint,
    college       varchar,
    rookie_season integer
);
CREATE INDEX IF NOT EXISTS players_full_name_idx ON players (full_name);

CREATE TABLE IF NOT EXISTS games (
    game_id     varchar PRIMARY KEY,  -- canonical nflverse schedule id
    season      integer NOT NULL REFERENCES seasons (season),
    week        smallint NOT NULL,
    season_type varchar NOT NULL DEFAULT 'REG',  -- REG | POST
    game_date   date,
    home_team   varchar NOT NULL REFERENCES teams (team_id),
    away_team   varchar NOT NULL REFERENCES teams (team_id),
    home_score  smallint,             -- NULL until played (postponed/unplayed)
    away_score  smallint,
    stadium     varchar,
    roof        varchar,
    surface     varchar
);
CREATE INDEX IF NOT EXISTS games_season_week_idx ON games (season, week);
CREATE INDEX IF NOT EXISTS games_home_team_idx ON games (home_team);
CREATE INDEX IF NOT EXISTS games_away_team_idx ON games (away_team);

CREATE TABLE IF NOT EXISTS player_game_stats (
    player_id   varchar NOT NULL REFERENCES players (player_id),
    game_id     varchar NOT NULL REFERENCES games (game_id),
    team_id     varchar NOT NULL REFERENCES teams (team_id),
    completions smallint,
    attempts    smallint,
    passing_yards integer,
    passing_tds smallint,
    interceptions smallint,
    sacks       double precision,
    carries     smallint,
    rushing_yards integer,
    rushing_tds smallint,
    targets     smallint,
    receptions  smallint,
    receiving_yards integer,
    receiving_tds smallint,
    fumbles     smallint,
    fumbles_lost smallint,
    fantasy_points_ppr double precision,
    sack_yards  smallint,
    tackles     smallint,          -- solo + assists
    def_sacks   double precision,
    def_interceptions smallint,
    forced_fumbles smallint,
    passes_defended smallint,
    PRIMARY KEY (player_id, game_id)
);
CREATE INDEX IF NOT EXISTS pgs_game_idx ON player_game_stats (game_id);
CREATE INDEX IF NOT EXISTS pgs_team_idx ON player_game_stats (team_id);

CREATE TABLE IF NOT EXISTS player_season_stats (
    player_id   varchar NOT NULL REFERENCES players (player_id),
    season      integer NOT NULL REFERENCES seasons (season),
    season_type varchar NOT NULL DEFAULT 'REG',
    team_id     varchar,
    games_played smallint,
    passing_yards integer,
    passing_tds smallint,
    interceptions smallint,
    rushing_yards integer,
    rushing_tds smallint,
    receptions  smallint,
    receiving_yards integer,
    receiving_tds smallint,
    fantasy_points_ppr double precision,
    completions smallint,
    attempts    smallint,
    sacks       double precision,  -- sacks taken (QB)
    sack_yards  smallint,
    fumbles     smallint,
    fumbles_lost smallint,
    tackles     smallint,          -- solo + assists
    def_sacks   double precision,
    def_interceptions smallint,
    forced_fumbles smallint,
    passes_defended smallint,
    PRIMARY KEY (player_id, season, season_type)
);
CREATE INDEX IF NOT EXISTS pss_season_idx ON player_season_stats (season);

CREATE TABLE IF NOT EXISTS team_game_stats (
    team_id   varchar NOT NULL REFERENCES teams (team_id),
    game_id   varchar NOT NULL REFERENCES games (game_id),
    is_home   boolean NOT NULL,
    points_for smallint,
    points_against smallint,
    total_yards integer,
    passing_yards integer,
    rushing_yards integer,
    turnovers smallint,
    time_of_possession_sec integer,
    result    varchar,  -- W | L | T
    PRIMARY KEY (team_id, game_id)
);
CREATE INDEX IF NOT EXISTS tgs_game_idx ON team_game_stats (game_id);

-- Touchdown events distilled from play-by-play: who scored, in which game,
-- how. Powers "first/last TD" and "when did X score" questions plus the
-- player-page touchdown log. Deliberately NOT full pbp — scoring plays only.
CREATE TABLE IF NOT EXISTS scoring_plays (
    play_id     varchar PRIMARY KEY,  -- game_id + play number
    game_id     varchar NOT NULL REFERENCES games (game_id),
    player_id   varchar NOT NULL REFERENCES players (player_id),  -- the scorer
    team_id     varchar REFERENCES teams (team_id),               -- scoring team
    qtr         smallint,
    play_type   varchar,  -- pass | run | kickoff | punt | ...
    description text
);
CREATE INDEX IF NOT EXISTS scoring_plays_player_idx ON scoring_plays (player_id);
CREATE INDEX IF NOT EXISTS scoring_plays_game_idx ON scoring_plays (game_id);
CREATE INDEX IF NOT EXISTS scoring_plays_team_idx ON scoring_plays (team_id);

-- NFL draft history (nflverse draft_picks, 1980+). No season FK: the draft
-- runs ahead of (and behind) the stats warehouse's loaded seasons. player_id
-- carries the gsis id for the modern era and joins players when present.
CREATE TABLE IF NOT EXISTS draft_picks (
    season      integer NOT NULL,
    round       smallint NOT NULL,
    pick        smallint NOT NULL,   -- overall selection number
    team_id     varchar NOT NULL,    -- normalized to the current franchise
    player_id   varchar,
    player_name varchar NOT NULL,
    position    varchar,
    college     varchar,
    PRIMARY KEY (season, pick)
);
CREATE INDEX IF NOT EXISTS draft_picks_player_idx ON draft_picks (player_id);
CREATE INDEX IF NOT EXISTS draft_picks_team_idx ON draft_picks (team_id, season);

-- Second-layer auditor log: one structured record per answered question.
-- Stores decisions, never free-form reasoning.
CREATE TABLE IF NOT EXISTS query_audit (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    asked_at timestamptz NOT NULL DEFAULT now(),
    question text NOT NULL,
    spec jsonb,
    status varchar NOT NULL,
    warnings jsonb,
    confidence jsonb,
    row_count integer,
    duration_ms integer
);

-- Durable shareable answers for /a/<share_id> (fronted by the in-process cache).
CREATE TABLE IF NOT EXISTS answer_cache (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    share_id varchar UNIQUE,
    question text NOT NULL,
    normalized_question text NOT NULL UNIQUE,
    sql text,
    answer_json text NOT NULL,
    hits integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent widening for databases created before these columns existed.
ALTER TABLE player_game_stats
    ADD COLUMN IF NOT EXISTS sack_yards smallint,
    ADD COLUMN IF NOT EXISTS tackles smallint,
    ADD COLUMN IF NOT EXISTS def_sacks double precision,
    ADD COLUMN IF NOT EXISTS def_interceptions smallint,
    ADD COLUMN IF NOT EXISTS forced_fumbles smallint,
    ADD COLUMN IF NOT EXISTS passes_defended smallint;
ALTER TABLE player_season_stats
    ADD COLUMN IF NOT EXISTS completions smallint,
    ADD COLUMN IF NOT EXISTS attempts smallint,
    ADD COLUMN IF NOT EXISTS sacks double precision,
    ADD COLUMN IF NOT EXISTS sack_yards smallint,
    ADD COLUMN IF NOT EXISTS fumbles smallint,
    ADD COLUMN IF NOT EXISTS fumbles_lost smallint,
    ADD COLUMN IF NOT EXISTS tackles smallint,
    ADD COLUMN IF NOT EXISTS def_sacks double precision,
    ADD COLUMN IF NOT EXISTS def_interceptions smallint,
    ADD COLUMN IF NOT EXISTS forced_fumbles smallint,
    ADD COLUMN IF NOT EXISTS passes_defended smallint;

-- Metadata columns for bio/split questions (nflverse carries them all):
-- jersey numbers, coaches, team colors, kickoff time/weekday and weather
-- for primetime/weather splits, and air yards.
ALTER TABLE players
    ADD COLUMN IF NOT EXISTS jersey_number smallint;
ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS color varchar,
    ADD COLUMN IF NOT EXISTS color2 varchar;
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS weekday varchar,
    ADD COLUMN IF NOT EXISTS gametime varchar,
    ADD COLUMN IF NOT EXISTS temp smallint,
    ADD COLUMN IF NOT EXISTS wind smallint,
    ADD COLUMN IF NOT EXISTS home_coach varchar,
    ADD COLUMN IF NOT EXISTS away_coach varchar;
ALTER TABLE player_game_stats
    ADD COLUMN IF NOT EXISTS passing_air_yards integer,
    ADD COLUMN IF NOT EXISTS receiving_air_yards integer;

-- Advanced per-player-game aggregates distilled from play-by-play (EPA,
-- success counts, CPOE) — one row per player-game, split by role.
CREATE TABLE IF NOT EXISTS player_game_advanced (
    player_id    varchar NOT NULL REFERENCES players (player_id),
    game_id      varchar NOT NULL REFERENCES games (game_id),
    team_id      varchar,
    pass_plays   smallint,
    pass_epa     real,
    pass_success smallint,
    cpoe_sum     real,
    cpoe_n       smallint,
    rush_plays   smallint,
    rush_epa     real,
    rush_success smallint,
    recv_plays   smallint,
    recv_epa     real,
    recv_success smallint,
    PRIMARY KEY (player_id, game_id)
);
CREATE INDEX IF NOT EXISTS pga_game_idx ON player_game_advanced (game_id);

-- Touchdown length and per-game drive counts, also from play-by-play.
ALTER TABLE scoring_plays ADD COLUMN IF NOT EXISTS yards smallint;
ALTER TABLE team_game_stats ADD COLUMN IF NOT EXISTS drives smallint;

-- Query-shape indexes. Leaderboards filter (season, season_type); "players on
-- team X in year Y" filters team_id; REG/POST game scans filter season_type.
CREATE INDEX IF NOT EXISTS pss_season_type_idx
    ON player_season_stats (season, season_type);
CREATE INDEX IF NOT EXISTS pss_team_season_idx
    ON player_season_stats (team_id, season);
CREATE INDEX IF NOT EXISTS games_season_type_idx
    ON games (season, season_type);

-- ===========================================================================
-- P0 ingestion worker: cross-source id crosswalk + modern nflverse datasets
-- (trades, injuries, depth charts, snap counts) + run/source tracking.
-- Column sets come from the REAL nflverse release CSV headers.
-- NOTE (Supabase): the orchestrator must ENABLE RLS on every table below
-- (they are PostgREST-exposed; the worker connects as postgres and bypasses
-- RLS, but public reads must be gated by policy). e.g.
--   ALTER TABLE player_ids ENABLE ROW LEVEL SECURITY; (+ a read policy)
-- ===========================================================================

-- The nflverse players master (players.csv) carries every external id. This is
-- the cross-source join backbone: gsis <-> pfr / espn / pff / otc / esb / smart
-- / nfl. players.csv does NOT carry a sportradar id, so there is no column for
-- it. player_id is the gsis id (FK -> players): only players present in the
-- loaded rosters are crosswalked.
CREATE TABLE IF NOT EXISTS player_ids (
    player_id  varchar PRIMARY KEY REFERENCES players (player_id),
    esb_id     varchar,   -- Elias Sports Bureau id
    nfl_id     varchar,   -- NFL.com id
    pfr_id     varchar,   -- Pro-Football-Reference id
    pff_id     varchar,   -- Pro Football Focus id
    otc_id     varchar,   -- OverTheCap id
    espn_id    varchar,
    smart_id   varchar    -- nflverse smart id (uuid)
);
CREATE INDEX IF NOT EXISTS player_ids_pfr_idx ON player_ids (pfr_id);
CREATE INDEX IF NOT EXISTS player_ids_espn_idx ON player_ids (espn_id);

-- NFL trades (nflverse trades.csv, 2002+). One row per ASSET moved (a player
-- or a draft pick); trade_id groups the assets of a single trade. asset_id is
-- a deterministic composite surrogate (the source has no per-row key), so
-- upserts stay idempotent. Teams are normalized to the current franchise.
-- Players are carried as pfr_id (the source has no gsis); player_id is
-- resolved from player_ids when a match exists (nullable otherwise).
CREATE TABLE IF NOT EXISTS trades (
    asset_id    varchar PRIMARY KEY,
    trade_id    integer NOT NULL,
    season      integer,
    trade_date  date,
    gave        varchar,   -- franchise that gave up this asset
    received    varchar,   -- franchise that received it
    pick_season smallint,  -- set when the asset is a draft pick
    pick_round  smallint,
    pick_number smallint,
    conditional boolean,
    player_id   varchar,   -- gsis, resolved from pfr_id (nullable)
    pfr_id      varchar,   -- set when the asset is a player
    pfr_name    varchar
);
CREATE INDEX IF NOT EXISTS trades_trade_id_idx ON trades (trade_id);
CREATE INDEX IF NOT EXISTS trades_player_idx ON trades (player_id);
CREATE INDEX IF NOT EXISTS trades_pfr_idx ON trades (pfr_id);

-- Weekly injury reports (nflverse injuries_<year>.csv, 2009+). Keyed by
-- (player, season, game_type, week, team). player_id is the gsis id.
CREATE TABLE IF NOT EXISTS injuries (
    player_id                 varchar NOT NULL REFERENCES players (player_id),
    season                    integer NOT NULL,
    game_type                 varchar NOT NULL DEFAULT 'REG',  -- REG | POST
    week                      smallint NOT NULL,
    team                      varchar NOT NULL,  -- normalized franchise
    "position"                varchar,
    report_primary_injury     varchar,
    report_secondary_injury   varchar,
    report_status             varchar,   -- Out | Doubtful | Questionable | ...
    practice_primary_injury   varchar,
    practice_secondary_injury varchar,
    practice_status           varchar,
    date_modified             timestamptz,
    PRIMARY KEY (player_id, season, game_type, week, team)
);
CREATE INDEX IF NOT EXISTS injuries_season_week_idx ON injuries (season, week);
CREATE INDEX IF NOT EXISTS injuries_team_season_idx ON injuries (team, season);

-- Weekly depth charts (nflverse depth_charts_<year>.csv, 2001+). Keyed by
-- (player, season, game_type, week, team, position). depth_team: 1 = starter,
-- 2 = backup, ... ; formation: Offense | Defense | Special Teams.
CREATE TABLE IF NOT EXISTS depth_charts (
    player_id      varchar NOT NULL REFERENCES players (player_id),
    season         integer NOT NULL,
    game_type      varchar NOT NULL DEFAULT 'REG',  -- REG | POST
    week           smallint NOT NULL,
    team           varchar NOT NULL,  -- normalized franchise (club_code)
    "position"     varchar NOT NULL,
    depth_team     smallint,
    depth_position varchar,
    formation      varchar,
    jersey_number  smallint,
    PRIMARY KEY (player_id, season, game_type, week, team, "position")
);
CREATE INDEX IF NOT EXISTS depth_charts_season_week_idx ON depth_charts (season, week);
CREATE INDEX IF NOT EXISTS depth_charts_team_season_idx ON depth_charts (team, season);

-- Per-game snap counts (nflverse snap_counts_<year>.csv, 2012+). Keyed by
-- (pfr_player_id, game_id); game_id matches the schedule (FK -> games).
-- Players are keyed by PFR id in the source; player_id (gsis) is resolved from
-- player_ids when a match exists (nullable otherwise). *_pct are 0..1 fractions.
CREATE TABLE IF NOT EXISTS snap_counts (
    pfr_player_id varchar NOT NULL,
    game_id       varchar NOT NULL REFERENCES games (game_id),
    player_id     varchar,   -- gsis, resolved from pfr_player_id (nullable)
    season        integer NOT NULL,
    game_type     varchar NOT NULL DEFAULT 'REG',
    week          smallint NOT NULL,
    team          varchar NOT NULL,
    opponent      varchar,
    "position"    varchar,
    offense_snaps smallint,
    offense_pct   real,
    defense_snaps smallint,
    defense_pct   real,
    st_snaps      smallint,
    st_pct        real,
    PRIMARY KEY (pfr_player_id, game_id)
);
CREATE INDEX IF NOT EXISTS snap_counts_player_idx ON snap_counts (player_id);
CREATE INDEX IF NOT EXISTS snap_counts_game_idx ON snap_counts (game_id);
CREATE INDEX IF NOT EXISTS snap_counts_season_idx ON snap_counts (season, week);

-- Ingestion run log: one row per (dataset, season) attempt. season is NULL for
-- single-file datasets (players, trades, ...).
CREATE TABLE IF NOT EXISTS ingestion_runs (
    id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    source      varchar NOT NULL,   -- e.g. 'nflverse'
    dataset     varchar NOT NULL,   -- e.g. 'injuries'
    season      integer,            -- NULL for single-file datasets
    status      varchar NOT NULL,   -- running | success | error
    row_count   integer,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    error       text
);
CREATE INDEX IF NOT EXISTS ingestion_runs_dataset_idx ON ingestion_runs (dataset, season);
CREATE INDEX IF NOT EXISTS ingestion_runs_started_idx ON ingestion_runs (started_at);

-- Resumable-backfill checkpoint: the last successful load per (source, dataset,
-- season). season = -1 is the sentinel for single-file datasets (a PK can't
-- hold NULL). `worker resume` skips any pair present here unless --force.
CREATE TABLE IF NOT EXISTS source_state (
    source          varchar NOT NULL,
    dataset         varchar NOT NULL,
    season          integer NOT NULL DEFAULT -1,  -- -1 = single-file (no season)
    last_success_at timestamptz NOT NULL DEFAULT now(),
    row_count       integer,
    PRIMARY KEY (source, dataset, season)
);
