"""Unit tests for the SQL safety guard — pure, no DB/LLM needed."""

from __future__ import annotations

import pytest

from app.pipeline.guard_sql import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    UnsafeSqlError,
    guard_sql,
)


def test_plain_select_gets_default_limit():
    out = guard_sql("SELECT full_name FROM players")
    assert "limit" in out.lower()
    assert str(DEFAULT_LIMIT) in out


def test_existing_small_limit_preserved():
    out = guard_sql("SELECT full_name FROM players LIMIT 5")
    assert "5" in out
    assert str(MAX_LIMIT) not in out


def test_oversized_limit_capped():
    out = guard_sql("SELECT full_name FROM players LIMIT 999999")
    assert str(MAX_LIMIT) in out


def test_trailing_semicolon_ok():
    assert guard_sql("SELECT 1 FROM players;")  # does not raise


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO players (player_id) VALUES ('x')",
        "UPDATE players SET full_name='x'",
        "DELETE FROM players",
        "DROP TABLE players",
        "TRUNCATE players",
        "ALTER TABLE players ADD COLUMN x int",
        "CREATE TABLE evil (id int)",
    ],
)
def test_writes_and_ddl_rejected(sql):
    with pytest.raises(UnsafeSqlError):
        guard_sql(sql)


def test_multiple_statements_rejected():
    with pytest.raises(UnsafeSqlError):
        guard_sql("SELECT 1 FROM players; SELECT 2 FROM teams")


def test_non_allowlisted_table_rejected():
    with pytest.raises(UnsafeSqlError):
        guard_sql("SELECT * FROM pg_catalog.pg_user")


def test_unparseable_rejected():
    with pytest.raises(UnsafeSqlError):
        guard_sql("this is not sql")


def test_allowlisted_join_ok():
    out = guard_sql(
        "SELECT p.full_name, s.passing_yards FROM player_season_stats s "
        "JOIN players p USING (player_id) WHERE s.season = 2023"
    )
    assert "limit" in out.lower()
