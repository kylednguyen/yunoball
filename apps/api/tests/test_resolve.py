"""Tests for entity resolution.

Candidate generation is pure; the resolution assertions need the seeded
warehouse and are skipped when it's unreachable.
"""

from __future__ import annotations

import asyncio

import pytest

from app.pipeline.resolve import _candidates, resolve_entities
from app.pipeline.execute import execute_sql


def _phrases(question: str) -> list[str]:
    return [p for p, _ in _candidates(question)]


def test_candidates_keep_names_drop_stopwords():
    phrases = _phrases("Patrick Mahomes career passing yards")
    assert "Patrick Mahomes" in phrases
    assert "passing" not in phrases
    assert "career" not in phrases


def test_candidates_do_not_bridge_connectors():
    # "vs" splits the run, so no span spans both names.
    phrases = _phrases("Tyreek Hill vs Travis Kelce")
    assert "Tyreek Hill" in phrases
    assert "Travis Kelce" in phrases
    assert all("vs" not in p.lower().split() for p in phrases)


def test_candidates_longest_first():
    phrases = _phrases("Josh Jacobs")
    assert phrases[0] == "Josh Jacobs"


def _db_ready() -> bool:
    try:
        rows, _ = asyncio.run(execute_sql("SELECT COUNT(*) AS n FROM entity_aliases"))
        return rows and rows[0]["n"] > 0
    except Exception:
        return False


needs_db = pytest.mark.skipif(not _db_ready(), reason="aliases not seeded; skipping")


@needs_db
def test_resolves_player_and_team():
    ents = asyncio.run(resolve_entities("How many games did the Chiefs win in 2023?"))
    teams = [e for e in ents if e.entity_type == "team"]
    assert any(e.canonical_id == "KC" for e in teams)


@needs_db
def test_resolves_two_players_cleanly():
    ents = asyncio.run(resolve_entities("Tyreek Hill vs Travis Kelce receiving yards"))
    names = {e.display_name for e in ents}
    assert "Tyreek Hill" in names
    assert "Travis Kelce" in names
    # No spurious extra entities from surname fragments.
    assert len(ents) == 2
