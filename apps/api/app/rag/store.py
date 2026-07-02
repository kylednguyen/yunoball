"""Shared DB plumbing for the durable answer store (used by cache.persist)."""

from __future__ import annotations

from sqlalchemy.engine import Engine

from yunoball_db.base import get_engine

_read_engine: Engine | None = None


def read_engine() -> Engine:
    """Pooled engine for the durable answer store (Postgres-only paths)."""
    global _read_engine
    if _read_engine is None:
        _read_engine = get_engine()
    return _read_engine
