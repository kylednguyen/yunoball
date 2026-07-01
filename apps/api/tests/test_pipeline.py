"""Smoke tests for the SQL guard (raw-fallback path).

The structured NL->SQL path is covered in test_query_spec.py.
Run with:  cd apps/api && DEMO=1 pytest
"""

import os

os.environ.setdefault("DEMO", "1")

import pytest  # noqa: E402

from app.pipeline.guard_sql import guard_sql, UnsafeSqlError  # noqa: E402


def test_guard_allows_select():
    out = guard_sql("SELECT full_name FROM players")
    assert out.lower().startswith("select")
    assert "limit" in out.lower()  # LIMIT is enforced


@pytest.mark.parametrize(
    "bad",
    [
        "DROP TABLE players",
        "DELETE FROM players",
        "SELECT * FROM players; DROP TABLE players",
        "SELECT * FROM pg_user",
        "UPDATE players SET full_name = 'x'",
    ],
)
def test_guard_rejects_unsafe(bad):
    with pytest.raises(UnsafeSqlError):
        guard_sql(bad)
