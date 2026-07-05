# @yunoball/db

The YunoBall warehouse schema — one SQLAlchemy definition (`yunoball_db/models.py`)
shared by the FastAPI backend and the ingestion CLI, with Alembic migrations.

Database: **Postgres + pgvector** (Supabase). pgvector and pg_trgm extensions are
created automatically by the migration environment.

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
- **Facts:** `player_game_stats`, `team_game_stats`, `plays`
- **Rollups:** `player_season_stats`
- **RAG:** `entity_aliases`, `query_examples`, `answer_cache` (pgvector HNSW indexes)
