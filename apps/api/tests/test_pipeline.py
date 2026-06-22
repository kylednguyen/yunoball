"""Smoke tests for the SQL guard and the demo NL->SQL rules.

Run with:  cd apps/api && DEMO=1 pytest
"""

import os

os.environ.setdefault("DEMO", "1")

import pytest  # noqa: E402

from app.pipeline.guard_sql import guard_sql, UnsafeSqlError  # noqa: E402
from app.mock_nl2sql import mock_generate_sql  # noqa: E402


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


def test_mock_leaders_query():
    sql = mock_generate_sql("Who threw the most touchdowns in 2023?")
    assert "passing_tds" in sql
    assert "2023" in sql
    guard_sql(sql)  # must survive the guard


def test_mock_career_query():
    sql = mock_generate_sql("Patrick Mahomes career passing yards")
    assert "sum(" in sql.lower()
    assert "mahomes" in sql.lower()
    guard_sql(sql)
