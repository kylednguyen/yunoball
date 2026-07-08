"""Scores, standings, fantasy and agent endpoints over the demo seed.

Run with:  cd apps/api && DEMO=1 pytest
Uses asyncio.run() to call the async endpoints directly (no server needed).
"""

import asyncio
import os

os.environ.setdefault("DEMO", "1")

import pytest  # noqa: E402

from fastapi import HTTPException  # noqa: E402

from app.database import get_engine  # noqa: E402
from app.routers.agent import _demo_agent  # noqa: E402
from app.routers.fantasy import fantasy_players  # noqa: E402
from app.routers.games import games, performers  # noqa: E402
from app.routers.players import player_profile  # noqa: E402
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


def test_performers_ranked_with_stat_lines():
    resp = asyncio.run(performers(season=2023, week=7, limit=10))
    assert resp.week == 7
    assert resp.performers, "expected weekly performers"
    # Ranked by PPR, descending, ranks are 1..n.
    pts = [p.fantasy_points_ppr for p in resp.performers]
    assert pts == sorted(pts, reverse=True)
    assert [p.rank for p in resp.performers] == list(range(1, len(resp.performers) + 1))
    # Every performer has an opponent and a non-empty stat line.
    top = resp.performers[0]
    assert top.opponent and top.stat_line and top.stat_line != "no production"


def test_performers_reflect_pinned_game():
    # Henry's pinned 178-yard week 7 line should surface in his stat line.
    resp = asyncio.run(performers(season=2023, week=7, limit=25))
    henry = next((p for p in resp.performers if p.name == "Derrick Henry"), None)
    assert henry is not None
    assert "178 rush yds" in henry.stat_line


def test_performers_defaults_to_last_week():
    resp = asyncio.run(performers(season=None, week=None, limit=10))
    assert resp.season == 2023 and resp.week == 17


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


def test_agent_routes_weekly_performers():
    reply, steps = asyncio.run(_demo_agent("who were the top performers in week 7?"))
    assert steps[0].tool == "performers"
    assert "Performers of week 7" in reply
    assert "PPR" in reply


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


def test_player_profile_career_and_game_log():
    # Derrick Henry: one 2023 season row + a pinned single-game line.
    p = asyncio.run(player_profile("00-0032764"))
    assert p.name == "Derrick Henry"
    assert p.position == "RB"
    assert p.career.rushing_yards == 1167
    assert [s.season for s in p.seasons] == [2023]
    game = next(g for g in p.game_log if g.game_id == "2023_07_TEN_MIA")
    assert game.rushing_yards == 178
    assert game.opponent == "MIA" and not game.home
    assert game.result == "W" and (game.team_score, game.opp_score) == (27, 14)


def test_player_profile_multi_season_career():
    p = asyncio.run(player_profile("00-0033873"))  # Mahomes: 2022 + 2023 rows
    assert p.career.seasons == 2
    assert p.career.passing_yards == 4183 + 5250
    assert [s.season for s in p.seasons] == [2023, 2022]


def test_player_profile_404():
    with pytest.raises(HTTPException) as err:
        asyncio.run(player_profile("nope-not-a-player"))
    assert err.value.status_code == 404


def test_leaderboard_rows_carry_player_ids():
    from app.routers.leaderboards import leaderboards

    resp = asyncio.run(leaderboards(season=2023, category="passing_yards", limit=3))
    rows = resp.boards[0].rows
    assert rows and all(r.player_id for r in rows)


def test_agent_falls_back_to_stats_search():
    reply, steps = asyncio.run(_demo_agent("Patrick Mahomes career passing yards"))
    assert steps[0].tool == "stats_search"
    assert "Mahomes" in reply
