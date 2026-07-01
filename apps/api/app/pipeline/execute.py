"""Stage 4 — Execute validated SQL through the read-only engine.

In production the read-only role enforces a statement_timeout; in demo it runs
against the seeded SQLite file. Returns rows + column order for rendering.

SQLAlchemy core is synchronous, so the blocking call is offloaded to a worker
thread to avoid stalling the event loop under concurrent requests.
"""

from __future__ import annotations

from typing import Any

import anyio
from sqlalchemy import text

from ..database import get_readonly_engine


def _run(
    safe_sql: str, params: dict[str, Any] | None
) -> tuple[list[dict[str, Any]], list[str]]:
    with get_readonly_engine().connect() as conn:
        result = conn.execute(text(safe_sql), params or {})
        columns = list(result.keys())
        rows = [dict(row._mapping) for row in result]
    return rows, columns


async def execute_sql(
    safe_sql: str, params: dict[str, Any] | None = None
) -> tuple[list[dict[str, Any]], list[str]]:
    return await anyio.to_thread.run_sync(_run, safe_sql, params)
