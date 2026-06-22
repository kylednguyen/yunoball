"""Engine factory for the API.

Works for both demo (SQLite) and production (Postgres). The generated SQL runs
through the read-only engine; in demo mode both point at the same SQLite file.
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from .config import settings

_engine: Engine | None = None
_ro_engine: Engine | None = None


def _normalize(url: str) -> str:
    # Use psycopg v3 driver for Postgres; SQLite passes through unchanged.
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1).split("?", 1)[0]
    return url


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(_normalize(settings.effective_database_url))
    return _engine


def get_readonly_engine() -> Engine:
    global _ro_engine
    if _ro_engine is None:
        _ro_engine = create_engine(_normalize(settings.effective_readonly_url))
    return _ro_engine
