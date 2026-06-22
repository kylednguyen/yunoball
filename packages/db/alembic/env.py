"""Alembic migration environment.

Resolves the DB URL from the environment, ensures pgvector + pg_trgm exist
before running migrations, and targets the shared SQLAlchemy metadata so
`alembic revision --autogenerate` reflects models.py.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import text

from yunoball_db.base import Base, get_engine
from yunoball_db import models  # noqa: F401  (register models on Base.metadata)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_online() -> None:
    engine = get_engine(direct=True)
    with engine.connect() as connection:
        # Extensions must exist before Vector columns / trigram indexes.
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    raise SystemExit("Offline migrations are not supported; set DIRECT_DATABASE_URL.")
else:
    run_migrations_online()
