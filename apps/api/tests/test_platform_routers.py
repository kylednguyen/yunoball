"""Scores, standings, fantasy and agent endpoints over the demo seed.

Run with:  cd apps/api && DEMO=1 pytest
Uses asyncio.run() to call the async endpoints directly (no server needed).
"""

import asyncio
import os

os.environ.setdefault("DEMO", "1")

import pytest  # noqa: E402

from app.database import get_engine  # noqa: E402
from app.routers.agent import _demo_agent  # noqa: E402
from app.routers.fantasy import fantasy_players  # noqa: E402
from app.routers.games import games  # noqa: E402
from app.routers.standings import standings  # noqa: E402
from app.seed import TEAM_WINS_2023, is_seeded, seed_demo  # noqa: E402


@pytest.fixture(autouse=True)
def _seed():
    eng = get_engine()
    if not is_seeded(eng):
        seed_demo(eng)


def test_games_full_slate_and_week_filter():
    resp = asyncio.run(games(season=2023, week=12))
    assert resp.week == 12
    assert len(resp.games) == 16
    assert resp.weeks == list(range(1, 18))
    pinned = next(g for g in resp.games if g.game_id == "2023_12_SF_SEA")
    assert (pinned.away.score, pinned.home.score) == (31, 13)
    assert all(g.final for g in resp.games)


def test_games_defaults_to_latest_week():
    resp = asyncio.run(games(season=None, week=None))
    assert resp.season == 2023
    assert resp.week == 17


def test_standings_match_real_2023_records():
    resp = asyncio.run(standings(season=2023))
    rows = {
        t.team_id: t
        for conf in resp.conferences
        for div in conf.divisions
        for t in div.teams
    }
    assert len(rows) == 32
    for team_id, wins in TEAM_WINS_2023.items():
        assert rows[team_id].wins == wins, team_id
        assert rows[team_id].losses == 17 - wins, team_id
    # Division tables are sorted best-first.
    afc_east = next(
        d
        for conf in resp.conferences
        for d in conf.divisions
        if d.division == "AFC East"
    )
    pcts = [t.pct for t in afc_east.teams]
    assert pcts == sorted(pcts, reverse=True)


def test_fantasy_pool_filters_and_ppr():
    resp = asyncio.run(fantasy_players(season=2023, position="TE", q=None, limit=50))
    assert resp.players and all(p.position == "TE" for p in resp.players)
    # Ordered by fantasy points, descending.
    pts = [p.fantasy_points_ppr for p in resp.players]
    assert pts == sorted(pts, reverse=True)
    # Spot-check the PPR formula: rec + rec_yds/10 + rec_td*6.
    laporta = next(p for p in resp.players if p.name == "Sam LaPorta")
    expected = round(86 + 889 * 0.1 + 10 * 6, 1)
    assert laporta.fantasy_points_ppr == expected


def test_fantasy_search():
    resp = asyncio.run(fantasy_players(season=2023, position=None, q="mahomes", limit=50))
    assert [p.name for p in resp.players] == ["Patrick Mahomes"]


def test_agent_routes_standings():
    reply, steps = asyncio.run(_demo_agent("What are the standings this year?"))
    assert steps[0].tool == "standings"
    assert "Baltimore Ravens: 13-4" in reply


def test_agent_routes_scores():
    reply, steps = asyncio.run(_demo_agent("show me week 12 scores"))
    assert steps[0].tool == "scores"
    assert "Week 12" in reply


def test_agent_start_sit_schematic_verdict():
    reply, steps = asyncio.run(
        _demo_agent("Should I start Tyreek Hill or Mike Evans?")
    )
    assert steps[0].tool == "fantasy_judge"
    assert reply.startswith("Start Tyreek Hill")
    assert "Sit Mike Evans" in reply
    # The verdict explains itself: production, floor and environment factors.
    assert "The case:" in reply
    assert "PPR/gm" in reply
    assert "receptions/gm" in reply
    assert "PF/gm" in reply


def test_agent_falls_back_to_stats_search():
    reply, steps = asyncio.run(_demo_agent("Patrick Mahomes career passing yards"))
    assert steps[0].tool == "stats_search"
    assert "Mahomes" in reply
