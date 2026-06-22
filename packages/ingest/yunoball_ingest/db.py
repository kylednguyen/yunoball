"""Database connection for ingestion.

Reuses the shared engine from `yunoball_db` (direct, non-pooled connection) so
bulk INSERT/upsert and transactions behave predictably and there is a single
source of connection logic.
"""

from __future__ import annotations

from sqlalchemy.engine import Engine
from yunoball_db.base import get_engine as _get_engine


def get_engine() -> Engine:
    return _get_engine(direct=True)
