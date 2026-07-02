# @yunoball/ingest

Loads [nflverse](https://github.com/nflverse) data into the YunoBall Postgres
warehouse via [`nfl_data_py`](https://github.com/nflverse/nfl_data_py).

## Setup

```bash
cd packages/ingest
python -m venv .venv && source .venv/bin/activate
pip install -e . -e ../db
```

Set `DIRECT_DATABASE_URL` (the non-pooled Supabase/Postgres connection) in `.env`.

> Note: nflverse's data hosts must be reachable from wherever you run this.
> Some sandboxed/CI networks block them — run ingestion from your own machine or
> a host with open egress.

## Usage

```bash
# Every season since 1999 — the full dataset
yunoball-ingest --all

# Specific seasons
yunoball-ingest --years 2022 2023 2024

# Just one pipeline
yunoball-ingest --years 2024 --only player_game_stats
```

Pipelines run in dependency order and are idempotent (batched
`INSERT ... ON CONFLICT`), so re-running a season is safe.

### Pipelines

| Name | Source | Grain |
|---|---|---|
| `teams` | `import_team_desc` | franchise |
| `seasons` | (years) | season |
| `players` | `import_seasonal_rosters` | player |
| `games` | `import_schedules` | game |
| `player_game_stats` | `import_weekly_data` | player × game |
| `player_season_stats` | `import_seasonal_data` | player × season |
| `team_game_stats` | `import_schedules` | team × game |

The warehouse is box-score grained (no play-by-play), so a full 1999→present
backfill stays small. Game ids are resolved from the schedule by
`(season, week, team)`, so home/away players map to the correct game.

## Order of operations

1. Apply the schema: from `packages/db`, run `alembic upgrade head` (creates
   `vector` + `pg_trgm` and all tables).
2. Then run the ingest CLI.

## Serving real data without an API key

The FastAPI app's rule-based engine works against a real Postgres too: set
`DATABASE_URL` (and leave `OPENAI_API_KEY` unset) and the supported query shapes
(leaders, career totals, single-game, team splits) answer from the full loaded
dataset at zero LLM cost.
