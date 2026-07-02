# @yunoball/db

The YunoBall warehouse schema — one SQLAlchemy definition (`yunoball_db/models.py`)
shared by the FastAPI backend and the ingestion CLI, with Alembic migrations.

Database: **Postgres** (Supabase). The `pg_trgm` extension (fuzzy entity
resolution) is created automatically by the migration environment. V1 does no
vector search.

## Setup

```bash
cd packages/db
python -m venv .venv && source .venv/bin/activate
pip install -e .
```

Set `DIRECT_DATABASE_URL` (the non-pooled Supabase connection) in `.env`.

## Migrations

```bash
# Generate a migration from model changes
alembic revision --autogenerate -m "init schema"

# Apply
alembic upgrade head
```

The first `alembic upgrade` enables `vector` + `pg_trgm` before creating tables.

## Schema overview

- **Dimensions:** `seasons`, `teams`, `players`, `games`
- **Facts:** `player_game_stats`, `team_game_stats`
- **Rollups:** `player_season_stats`
- **Resolve / cache:** `entity_aliases` (pg_trgm), `answer_cache`

The warehouse is intentionally box-score grained — no play-by-play, EPA, or
win-probability tables in V1.
