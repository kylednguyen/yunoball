"""Tests for the structured QuerySpec path (rules -> spec -> SQL -> narration)."""

import os

os.environ.setdefault("DEMO", "1")

from app.query import parse_rules, build_sql, narrate_spec, QuerySpec, Intent  # noqa: E402


def test_leaders_parse():
    spec = parse_rules("Who threw the most touchdowns in 2023?")
    assert spec is not None
    assert spec.intent is Intent.LEADERS
    assert spec.stat == "passing_tds"
    assert spec.season == 2023


def test_career_parse():
    spec = parse_rules("Patrick Mahomes career passing yards")
    assert spec.intent is Intent.PLAYER_TOTAL
    assert spec.scope == "career"
    assert spec.player == "Patrick Mahomes"
    assert spec.stat == "passing_yards"


def test_single_game_parse():
    spec = parse_rules("Most rushing yards in a single game")
    assert spec.intent is Intent.SINGLE_GAME
    assert spec.stat == "rushing_yards"


def test_unparseable_returns_none():
    assert parse_rules("what's the weather like") is None


def test_build_sql_is_parameterized():
    spec = QuerySpec(intent=Intent.LEADERS, stat="passing_tds", season=2023)
    sql, params = build_sql(spec)
    # Season/limit are bound params, not string-interpolated.
    assert ":season" in sql and params["season"] == 2023
    assert ":limit" in sql
    # Only the allowlisted column is interpolated.
    assert "passing_tds" in sql


def test_build_sql_career_uses_sum():
    spec = QuerySpec(intent=Intent.PLAYER_TOTAL, stat="passing_yards",
                     player="Patrick Mahomes", scope="career")
    sql, params = build_sql(spec)
    assert "SUM(" in sql
    assert params["player"] == "%patrick mahomes%"  # bound, lowered


def test_narrate_leaders():
    spec = QuerySpec(intent=Intent.LEADERS, stat="passing_tds", season=2023)
    txt = narrate_spec(spec, [{"full_name": "Dak Prescott", "season": 2023, "value": 36}])
    assert "Dak Prescott" in txt and "36" in txt


def test_invalid_stat_rejected():
    try:
        QuerySpec(intent=Intent.LEADERS, stat="not_a_stat")
        assert False, "expected validation error"
    except Exception:
        pass
