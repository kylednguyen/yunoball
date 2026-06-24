"""Tests for intent -> safe SQL templates (pure; no LLM, no DB).

All cases pass an explicit season so latest_season() (which reads the DB) is
never hit, keeping these unit-pure. Generated SQL is also run through guard_sql
to confirm the templates pass the safety guard.
"""

from __future__ import annotations

import pytest

from app.pipeline.guard_sql import guard_sql
from app.pipeline.intent import build_sql
from app.schemas import ResolvedEntity


def player(name, pid):
    return ResolvedEntity(
        mention=name, entity_type="player", canonical_id=pid, display_name=name, confidence=1.0
    )


def team(abbr):
    return ResolvedEntity(
        mention=abbr, entity_type="team", canonical_id=abbr, display_name=abbr, confidence=1.0
    )


def test_player_season_total():
    sql = build_sql(
        {"intent": "player_season_total", "stat_type": "passing_yards", "season": 2023},
        [player("Patrick Mahomes", "00-0033873")],
    )
    assert "player_season_stats" in sql
    assert "s.season=2023" in sql
    assert "passing_yards" in sql
    assert "00-0033873" in sql
    guard_sql(sql)  # passes the safety guard


def test_league_leader_has_order_and_limit():
    sql = build_sql(
        {"intent": "league_leader", "stat_type": "rushing_yards", "season": 2022, "limit": 5},
        [],
    )
    assert "ORDER BY" in sql and "LIMIT 5" in sql and "rushing_yards" in sql
    guard_sql(sql)


def test_defensive_leader_maps_sacks_to_def_sacks():
    sql = build_sql(
        {"intent": "defensive_leader", "stat_type": "sacks", "season": 2023},
        [],
    )
    assert "def_sacks" in sql
    guard_sql(sql)


def test_player_comparison_needs_two_players():
    plan = {"intent": "player_comparison", "stat_type": "rushing_yards", "season": 2023}
    assert build_sql(plan, [player("A", "1")]) is None  # only one
    sql = build_sql(plan, [player("A", "1"), player("B", "2")])
    assert "IN ('1','2')" in sql
    guard_sql(sql)


def test_threshold_games():
    sql = build_sql(
        {"intent": "threshold_games", "stat_type": "passing_yards", "threshold": 300},
        [player("Patrick Mahomes", "00-0033873")],
    )
    assert "passing_yards >= 300" in sql
    guard_sql(sql)


def test_single_game_leader_defaults_to_one():
    sql = build_sql({"intent": "single_game_leader", "stat_type": "rushing_yards", "season": 2023}, [])
    assert "LIMIT 1" in sql
    guard_sql(sql)


def test_average_stat_for_player():
    sql = build_sql(
        {"intent": "average_stat", "stat_type": "passing_yards", "season": 2023},
        [player("Joe Burrow", "x")],
    )
    assert "AVG(pgs.passing_yards)" in sql
    guard_sql(sql)


def test_team_season_total():
    sql = build_sql(
        {"intent": "team_season_total", "stat_type": "passing_yards", "season": 2023},
        [team("NE")],
    )
    assert "team_game_stats" in sql and "NE" in sql
    guard_sql(sql)


def test_unknown_stat_falls_back_to_none():
    assert build_sql({"intent": "league_leader", "stat_type": "vibes", "season": 2023}, []) is None


def test_missing_player_falls_back_to_none():
    # player_season_total with no resolved player and no name slot -> None
    assert build_sql({"intent": "player_season_total", "stat_type": "passing_yards", "season": 2023}, []) is None
