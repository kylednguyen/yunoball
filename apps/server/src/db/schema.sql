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
