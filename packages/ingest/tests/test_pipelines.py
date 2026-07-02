"""Offline verification of the ingestion loaders.

nflverse's data hosts are network-restricted in CI, so we monkeypatch
nfl_data_py to return small frames shaped like the real datasets and run the
loaders against a real SQLite database. This exercises the actual reshape +
INSERT ... ON CONFLICT logic — in particular that game_id resolves correctly
for AWAY-team players (the bug the schedule lookup fixes).

Run:  cd packages/ingest && pip install pytest pandas sqlalchemy && pytest
"""

import pandas as pd
import pytest
from sqlalchemy import create_engine, text

from yunoball_ingest import pipelines

# game 2023_01_LV_KC: away=LV, home=KC, KC wins 30-20
_SCHED = pd.DataFrame([{
    "game_id": "2023_01_LV_KC", "season": 2023, "week": 1, "game_type": "REG",
    "gameday": "2023-09-10", "home_team": "KC", "away_team": "LV",
    "home_score": 30, "away_score": 20, "stadium": "Arrowhead",
    "roof": "outdoors", "surface": "grass",
}])

_TEAMS = pd.DataFrame([
    {"team_abbr": "KC", "team_name": "Kansas City Chiefs", "team_nick": "Chiefs",
     "team_conf": "AFC", "team_division": "AFC West"},
    {"team_abbr": "LV", "team_name": "Las Vegas Raiders", "team_nick": "Raiders",
     "team_conf": "AFC", "team_division": "AFC West"},
])

_ROSTERS = pd.DataFrame([
    {"player_id": "P_MAHOMES", "player_name": "Patrick Mahomes", "first_name": "Patrick",
     "last_name": "Mahomes", "position": "QB", "birth_date": None, "college": "Texas Tech",
     "season": 2023, "team": "KC"},
    {"player_id": "P_ADAMS", "player_name": "Davante Adams", "first_name": "Davante",
     "last_name": "Adams", "position": "WR", "birth_date": None, "college": "Fresno St",
     "season": 2023, "team": "LV"},
])

# Mahomes is on the HOME team (KC); Adams on the AWAY team (LV) — the key case.
_WEEKLY = pd.DataFrame([
    {"player_id": "P_MAHOMES", "season": 2023, "week": 1, "recent_team": "KC",
     "opponent_team": "LV", "passing_yards": 305, "passing_tds": 3},
    {"player_id": "P_ADAMS", "season": 2023, "week": 1, "recent_team": "LV",
     "opponent_team": "KC", "receiving_yards": 96, "receiving_tds": 1},
])

_SEASONAL = pd.DataFrame([
    {"player_id": "P_MAHOMES", "season": 2023, "games": 16, "passing_yards": 4183,
     "passing_tds": 27},
    {"player_id": "P_ADAMS", "season": 2023, "games": 17, "receiving_yards": 1144,
     "receiving_tds": 8},
])

_DDL = [
    "CREATE TABLE seasons (season INTEGER PRIMARY KEY)",
    "CREATE TABLE teams (team_id TEXT PRIMARY KEY, name TEXT, nickname TEXT, conference TEXT, division TEXT)",
    "CREATE TABLE players (player_id TEXT PRIMARY KEY, full_name TEXT, first_name TEXT, last_name TEXT, position TEXT, birth_date TEXT, college TEXT)",
    "CREATE TABLE games (game_id TEXT PRIMARY KEY, season INTEGER, week INTEGER, season_type TEXT, game_date TEXT, home_team TEXT, away_team TEXT, home_score INTEGER, away_score INTEGER, stadium TEXT, roof TEXT, surface TEXT)",
    "CREATE TABLE player_game_stats (player_id TEXT, game_id TEXT, team_id TEXT, completions INT, attempts INT, passing_yards INT, passing_tds INT, interceptions INT, carries INT, rushing_yards INT, rushing_tds INT, targets INT, receptions INT, receiving_yards INT, receiving_tds INT, PRIMARY KEY (player_id, game_id))",
    "CREATE TABLE player_season_stats (player_id TEXT, season INTEGER, season_type TEXT, team_id TEXT, games_played INT, passing_yards INT, passing_tds INT, interceptions INT, rushing_yards INT, rushing_tds INT, receptions INT, receiving_yards INT, receiving_tds INT, PRIMARY KEY (player_id, season, season_type))",
    "CREATE TABLE team_game_stats (team_id TEXT, game_id TEXT, is_home BOOLEAN, points_for INT, points_against INT, total_yards INT, passing_yards INT, rushing_yards INT, turnovers INT, time_of_possession_sec INT, result TEXT, PRIMARY KEY (team_id, game_id))",
]


@pytest.fixture()
def engine(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path/'t.db'}")
    with eng.begin() as c:
        for ddl in _DDL:
            c.execute(text(ddl))
    monkeypatch.setattr(pipelines.nfl, "import_team_desc", lambda: _TEAMS.copy())
    monkeypatch.setattr(pipelines.nfl, "import_schedules", lambda y: _SCHED.copy())
    monkeypatch.setattr(pipelines.nfl, "import_seasonal_rosters", lambda y: _ROSTERS.copy())
    monkeypatch.setattr(pipelines.nfl, "import_weekly_data", lambda y: _WEEKLY.copy())
    monkeypatch.setattr(pipelines.nfl, "import_seasonal_data", lambda y: _SEASONAL.copy())
    return eng


def _all(engine, sql):
    with engine.connect() as c:
        return [dict(r._mapping) for r in c.execute(text(sql))]


def test_game_id_resolves_for_away_player(engine):
    pipelines.load_teams(engine)
    pipelines.load_seasons(engine, [2023])
    pipelines.load_players(engine, [2023])
    pipelines.load_games(engine, [2023])
    n = pipelines.load_player_game_stats(engine, [2023])

    assert n == 2
    rows = {r["player_id"]: r["game_id"] for r in _all(engine, "SELECT player_id, game_id FROM player_game_stats")}
    # Both players resolve to the SAME canonical schedule game_id...
    assert rows["P_MAHOMES"] == "2023_01_LV_KC"
    # ...including the away-team player (the bug: old code gave 2023_01_KC_LV).
    assert rows["P_ADAMS"] == "2023_01_LV_KC"
    # No orphans: every game_id exists in games.
    games = {r["game_id"] for r in _all(engine, "SELECT game_id FROM games")}
    assert all(g in games for g in rows.values())


def test_load_teams_is_idempotent(engine):
    pipelines.load_teams(engine)
    pipelines.load_teams(engine)  # must not raise duplicate-key
    rows = _all(engine, "SELECT COUNT(*) AS n FROM teams")
    assert rows[0]["n"] == 2


def test_team_game_stats_win_loss(engine):
    pipelines.load_teams(engine)
    pipelines.load_seasons(engine, [2023])
    pipelines.load_games(engine, [2023])
    n = pipelines.load_team_game_stats(engine, [2023])
    assert n == 2  # one row per team
    res = {r["team_id"]: r["result"] for r in _all(engine, "SELECT team_id, result FROM team_game_stats")}
    assert res["KC"] == "W" and res["LV"] == "L"


def test_season_stats(engine):
    pipelines.load_teams(engine)
    pipelines.load_seasons(engine, [2023])
    pipelines.load_players(engine, [2023])
    pipelines.load_games(engine, [2023])
    assert pipelines.load_player_season_stats(engine, [2023]) == 2
    rows = {r["player_id"]: r["passing_yards"]
            for r in _all(engine, "SELECT player_id, passing_yards FROM player_season_stats")}
    assert rows["P_MAHOMES"] == 4183
