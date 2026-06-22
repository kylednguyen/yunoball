# @yunoball/ingest

Loads [nflverse](https://github.com/nflverse) data into the YunoBall Postgres
warehouse via [`nfl_data_py`](https://github.com/nflverse/nfl_data_py).

## Setup

```bash
cd packages/ingest
python -m venv .venv && source .venv/bin/activate
pip install -e .
```

Set `DIRECT_DATABASE_URL` (the non-pooled Supabase connection) in your `.env`.

## Usage

```bash
# Load a few recent seasons (dimensions + facts, in dependency order)
yunoball-ingest --years 2022 2023 2024

# Re-run a single pipeline
yunoball-ingest --years 2024 --only player_game_stats
```

Pipelines are idempotent (upsert on primary key), so re-running a season is safe.

## Order of operations

1. Apply the schema first: `pnpm db:push` (from repo root) and run
   `packages/db/sql/00_extensions.sql` once to enable `vector` + `pg_trgm`.
2. Then run the ingest CLI.

## Roadmap

- [ ] Play-by-play loader (`import_pbp_data`) for situational queries
- [ ] `player_season_stats` rollups (`import_seasonal_data`)
- [ ] `team_game_stats` from schedules + PBP aggregates
- [ ] Bulk COPY instead of row-by-row upsert
- [ ] Backfill seasons 1999–present
