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


def test_team_stat_mismatch_rejected():
    # A team stat can't ride a player intent (and vice versa).
    for intent, stat in [(Intent.LEADERS, "wins"), (Intent.TEAM_STAT, "passing_yards")]:
        try:
            QuerySpec(intent=intent, stat=stat)
            assert False, f"expected validation error for {intent} + {stat}"
        except Exception:
            pass


def test_team_record_parse():
    spec = parse_rules("Chiefs record in 2023")
    assert spec.intent is Intent.TEAM_STAT
    assert spec.stat == "record"
    assert spec.team_id == "KC"
    assert spec.season == 2023


def test_team_leaderboard_parse():
    spec = parse_rules("Highest scoring offense in 2023")
    assert spec.intent is Intent.TEAM_STAT
    assert spec.stat == "points_per_game"
    assert spec.team_id is None  # a leaderboard, no specific team


def test_build_team_record_sql():
    spec = QuerySpec(intent=Intent.TEAM_STAT, stat="record", team_id="KC", season=2023)
    sql, params = build_sql(spec)
    assert "team_game_stats" in sql and "GROUP BY" in sql
    assert params["team_id"] == "KC" and params["season"] == 2023
    # record selects wins/losses/ties, not a single value.
    assert "wins" in sql and "losses" in sql


def test_narrate_team_record():
    spec = QuerySpec(intent=Intent.TEAM_STAT, stat="record", team_id="KC", season=2023)
    txt = narrate_spec(spec, [{"team": "Kansas City Chiefs", "wins": 3, "losses": 1, "ties": 0}])
    assert "Kansas City Chiefs" in txt and "3-1" in txt


def test_passing_yards_not_hijacked_by_team_route():
    # "yards" is a weak team cue; a real player stat must still win.
    spec = parse_rules("Most passing yards in 2023")
    assert spec.intent is Intent.LEADERS
    assert spec.stat == "passing_yards"


def test_comparison_parse_defaults_passing_yards():
    spec = parse_rules("Patrick Mahomes vs Josh Allen")
    assert spec.intent is Intent.COMPARISON
    assert spec.stat == "passing_yards"     # default when no stat named
    assert spec.scope == "career"           # career unless a season is given
    assert spec.player == "Patrick Mahomes" and spec.player2 == "Josh Allen"


def test_comparison_parse_with_stat():
    spec = parse_rules("Josh Allen vs Jalen Hurts rushing yards")
    assert spec.intent is Intent.COMPARISON
    assert spec.stat == "rushing_yards"


def test_build_comparison_filters_both_players():
    spec = QuerySpec(intent=Intent.COMPARISON, stat="passing_yards",
                     player="Patrick Mahomes", player2="Josh Allen", scope="career")
    sql, params = build_sql(spec)
    assert "IN (:n1, :n2)" in sql and "SUM(" in sql
    assert params["n1"] == "patrick mahomes" and params["n2"] == "josh allen"


def test_narrate_comparison():
    spec = QuerySpec(intent=Intent.COMPARISON, stat="passing_yards",
                     player="Patrick Mahomes", player2="Josh Allen", scope="career")
    txt = narrate_spec(spec, [
        {"full_name": "Patrick Mahomes", "total": 9433},
        {"full_name": "Josh Allen", "total": 4306},
    ])
    assert "Patrick Mahomes leads Josh Allen" in txt and "9433" in txt
