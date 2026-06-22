"""Stage 4 — Execute validated SQL through the read-only engine.

In production the read-only role enforces a statement_timeout; in demo it runs
against the seeded SQLite file. Returns rows + column order for rendering.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from ..database import get_readonly_engine


async def execute_sql(safe_sql: str) -> tuple[list[dict[str, Any]], list[str]]:
    with get_readonly_engine().connect() as conn:
        result = conn.execute(text(safe_sql))
        columns = list(result.keys())
        rows = [dict(row._mapping) for row in result]
    return rows, columns
