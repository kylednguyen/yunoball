"""Stage 4 — Execute validated SQL through the read-only client.

The read-only role enforces a statement_timeout (set at provisioning); we run
in a single short-lived connection and return rows + column order for rendering.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from yunoball_db.base import get_engine

# Module-level engine bound to the least-privilege role.
_engine = None


def _ro_engine():
    global _engine
    if _engine is None:
        _engine = get_engine(readonly=True)
    return _engine


async def execute_sql(safe_sql: str) -> tuple[list[dict[str, Any]], list[str]]:
    # SQLAlchemy core is sync; the queries are short and the route is async,
    # so this is fine for now. Swap to an async driver if it becomes a bottleneck.
    with _ro_engine().connect() as conn:
        result = conn.execute(text(safe_sql))
        columns = list(result.keys())
        rows = [dict(row._mapping) for row in result]
    return rows, columns
