"""Tests for GET /api/standings against the demo seed."""

import os

os.environ.setdefault("DEMO", "1")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.database import get_engine  # noqa: E402
from app.seed import is_seeded, seed_demo  # noqa: E402


def _client() -> TestClient:
    eng = get_engine()
    if not is_seeded(eng):
        seed_demo(eng)
    return TestClient(app)


def test_standings_shape_and_order():
    res = _client().get("/api/standings?season=2023")
    assert res.status_code == 200
    body = res.json()
    assert body["season"] == 2023
    rows = body["rows"]
    assert rows, "seeded team_game_stats should produce standings"
    # Sorted by wins desc — KC's 3-1 mini-season tops the table.
    top = rows[0]
    assert top["team_id"] == "KC"
    assert (top["wins"], top["losses"]) == (3, 1)
    assert top["points_for"] == 106
    assert top["diff"] == top["points_for"] - top["points_against"]
    assert top["pct"] == 0.75
    # Ranks are sequential from 1.
    assert [r["rank"] for r in rows] == list(range(1, len(rows) + 1))


def test_standings_unknown_season_404():
    assert _client().get("/api/standings?season=1980").status_code == 404
