"""Tests for answer enrichment — pure logic (no LLM, DB-tolerant)."""

from __future__ import annotations

from app.pipeline.enrich import categorize, classify, enrich
from app.schemas import ResolvedEntity


def test_classify_by_table():
    assert classify("SELECT 1 FROM player_season_stats s") == "player_season"
    assert classify("SELECT 1 FROM player_game_stats pgs") == "player_game"
    assert classify("SELECT 1 FROM team_game_stats t") == "team"
    assert classify("SELECT 1 FROM plays p") == "play"


def test_categorize_by_stat_type():
    assert categorize("passing_yards") == "passing"
    assert categorize("rushing_yards") == "rushing"
    assert categorize("receiving_yards") == "receiving"
    assert categorize("points") == "scoring"
    assert categorize("wins") == "record"
    assert categorize("full_name") == "general"


def test_primary_and_chips_derive_from_rows():
    out = enrich(
        question="Who threw the most passing touchdowns in 2023?",
        sql="SELECT p.full_name, s.passing_tds FROM player_season_stats s "
        "JOIN players p USING (player_id) WHERE s.season = 2023 AND s.season_type='REG'",
        rows=[{"full_name": "Dak Prescott", "passing_tds": 36}],
        columns=["full_name", "passing_tds"],
        entities=[],
    )
    assert out["query_type"] == "player_season"
    assert out["primary"].value == "36"
    assert out["primary"].subject == "Dak Prescott"
    assert out["primary"].unit == "passing touchdowns"
    assert "2023" in out["primary"].context
    assert any("TD" in c.label for c in out["chips"])
    # No resolved player entity → no comparison cards (never fabricated).
    assert out["comparisons"] == []


def test_empty_rows_yield_followups_and_warning():
    out = enrich(
        question="Who led the league in rushing in 1999?",
        sql="SELECT p.full_name FROM player_season_stats s JOIN players p USING (player_id) WHERE s.season=1999",
        rows=[],
        columns=["full_name"],
        entities=[],
    )
    assert out["primary"] is None
    assert len(out["followups"]) >= 3
    assert any("2022" in w for w in out["source"].warnings)


def test_value_never_invented_uses_row_value():
    out = enrich(
        question="Christian McCaffrey rushing yards in 2023",
        sql="SELECT p.full_name, s.rushing_yards FROM player_season_stats s "
        "JOIN players p USING (player_id) WHERE s.season=2023",
        rows=[{"full_name": "Christian McCaffrey", "rushing_yards": 1459}],
        columns=["full_name", "rushing_yards"],
        entities=[
            ResolvedEntity(
                mention="Christian McCaffrey",
                entity_type="player",
                canonical_id="does-not-exist",
                display_name="Christian McCaffrey",
                confidence=1.0,
            )
        ],
    )
    assert out["primary"].value == "1,459"  # exactly the row value, formatted
