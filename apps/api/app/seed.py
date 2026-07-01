"""Demo seed: a small slice of real 2022-2023 NFL stats into SQLite.

Enough to exercise the full pipeline (leaders, a specific player's career,
single-game leaders) with zero external services. Numbers are approximate
real-world regular-season figures, for demonstration only.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine

# (player_id, full_name, position, team_id)
SEED_PLAYERS: list[tuple[str, str, str, str]] = [
    ("00-0033873", "Patrick Mahomes", "QB", "KC"),
    ("00-0033077", "Dak Prescott", "QB", "DAL"),
    ("00-0036212", "Tua Tagovailoa", "QB", "MIA"),
    ("00-0034857", "Josh Allen", "QB", "BUF"),
    ("00-0033106", "Jared Goff", "QB", "DET"),
    ("00-0037834", "Brock Purdy", "QB", "SF"),
    ("00-0036389", "Jalen Hurts", "QB", "PHI"),
    ("00-0033280", "Christian McCaffrey", "RB", "SF"),
    ("00-0032764", "Derrick Henry", "RB", "TEN"),
    ("00-0036928", "Travis Etienne", "RB", "JAX"),
    ("00-0033040", "Tyreek Hill", "WR", "MIA"),
    ("00-0036322", "CeeDee Lamb", "WR", "DAL"),
    ("00-0036997", "Amon-Ra St. Brown", "WR", "DET"),
    ("00-0031408", "Mike Evans", "WR", "TB"),
]

SEED_TEAMS: list[tuple[str, str, str, str, str]] = [
    ("KC", "Kansas City Chiefs", "Chiefs", "AFC", "AFC West"),
    ("DAL", "Dallas Cowboys", "Cowboys", "NFC", "NFC East"),
    ("MIA", "Miami Dolphins", "Dolphins", "AFC", "AFC East"),
    ("BUF", "Buffalo Bills", "Bills", "AFC", "AFC East"),
    ("DET", "Detroit Lions", "Lions", "NFC", "NFC North"),
    ("SF", "San Francisco 49ers", "49ers", "NFC", "NFC West"),
    ("PHI", "Philadelphia Eagles", "Eagles", "NFC", "NFC East"),
    ("TEN", "Tennessee Titans", "Titans", "AFC", "AFC South"),
    ("JAX", "Jacksonville Jaguars", "Jaguars", "AFC", "AFC South"),
    ("TB", "Tampa Bay Buccaneers", "Buccaneers", "NFC", "NFC South"),
]

# season, type, player_id, team, gp, pass_yds, pass_td, int, rush_yds, rush_td, rec, rec_yds, rec_td
_PSS = [
    (2023, "REG", "00-0033873", "KC", 16, 4183, 27, 14, 389, 0, 0, 0, 0),
    (2023, "REG", "00-0033077", "DAL", 17, 4516, 36, 9, 242, 2, 0, 0, 0),
    (2023, "REG", "00-0036212", "MIA", 17, 4624, 29, 14, 74, 0, 0, 0, 0),
    (2023, "REG", "00-0034857", "BUF", 17, 4306, 29, 18, 524, 15, 0, 0, 0),
    (2023, "REG", "00-0033106", "DET", 17, 4575, 30, 12, 21, 1, 0, 0, 0),
    (2023, "REG", "00-0037834", "SF", 16, 4280, 31, 11, 144, 2, 0, 0, 0),
    (2023, "REG", "00-0036389", "PHI", 17, 3858, 23, 15, 605, 15, 0, 0, 0),
    (2023, "REG", "00-0033280", "SF", 16, 0, 0, 0, 1459, 14, 67, 564, 7),
    (2023, "REG", "00-0032764", "TEN", 17, 0, 0, 0, 1167, 12, 28, 214, 0),
    (2023, "REG", "00-0036928", "JAX", 17, 0, 0, 0, 1008, 11, 58, 476, 1),
    (2023, "REG", "00-0033040", "MIA", 16, 0, 0, 0, 0, 0, 119, 1799, 13),
    (2023, "REG", "00-0036322", "DAL", 17, 0, 0, 0, 0, 0, 135, 1749, 12),
    (2023, "REG", "00-0036997", "DET", 16, 0, 0, 0, 0, 0, 119, 1515, 10),
    (2023, "REG", "00-0031408", "TB", 17, 0, 0, 0, 0, 0, 79, 1255, 13),
    # a couple of 2022 rows so "career" sums span seasons
    (2022, "REG", "00-0033873", "KC", 17, 5250, 41, 12, 358, 4, 0, 0, 0),
    (2022, "REG", "00-0033040", "MIA", 17, 0, 0, 0, 1, 0, 119, 1710, 7),
    (2022, "REG", "00-0033280", "SF", 17, 0, 0, 0, 1139, 8, 85, 741, 5),
]

# game_id, season, week, home, away, home_score, away_score
_GAMES = [
    ("2023_07_TEN_MIA", 2023, 7, "MIA", "TEN", 14, 27),
    ("2023_10_NYG_DAL", 2023, 10, "DAL", "NYG", 49, 17),
    ("2023_12_SF_SEA", 2023, 12, "SEA", "SF", 13, 31),
]

# player_id, game_id, team, rush_yds, rush_td, rec, rec_yds, rec_td, pass_yds, pass_td
_PGS = [
    ("00-0032764", "2023_07_TEN_MIA", "TEN", 178, 1, 1, 9, 0, 0, 0),
    ("00-0033280", "2023_12_SF_SEA", "SF", 152, 1, 6, 53, 0, 0, 0),
    ("00-0036928", "2023_07_TEN_MIA", "JAX", 88, 0, 4, 31, 0, 0, 0),
    ("00-0036322", "2023_10_NYG_DAL", "DAL", 0, 0, 9, 151, 1, 0, 0),
]

_DDL = [
    "CREATE TABLE IF NOT EXISTS seasons (season INTEGER PRIMARY KEY)",
    """CREATE TABLE IF NOT EXISTS teams (
        team_id TEXT PRIMARY KEY, name TEXT, nickname TEXT,
        conference TEXT, division TEXT)""",
    """CREATE TABLE IF NOT EXISTS players (
        player_id TEXT PRIMARY KEY, full_name TEXT, position TEXT, team_id TEXT)""",
    """CREATE TABLE IF NOT EXISTS games (
        game_id TEXT PRIMARY KEY, season INTEGER, week INTEGER,
        season_type TEXT, home_team TEXT, away_team TEXT,
        home_score INTEGER, away_score INTEGER)""",
    """CREATE TABLE IF NOT EXISTS player_season_stats (
        player_id TEXT, season INTEGER, season_type TEXT, team_id TEXT,
        games_played INTEGER, passing_yards INTEGER, passing_tds INTEGER,
        interceptions INTEGER, rushing_yards INTEGER, rushing_tds INTEGER,
        receptions INTEGER, receiving_yards INTEGER, receiving_tds INTEGER,
        fantasy_points_ppr REAL,
        PRIMARY KEY (player_id, season, season_type))""",
    """CREATE TABLE IF NOT EXISTS player_game_stats (
        player_id TEXT, game_id TEXT, team_id TEXT,
        rushing_yards INTEGER, rushing_tds INTEGER, receptions INTEGER,
        receiving_yards INTEGER, receiving_tds INTEGER,
        passing_yards INTEGER, passing_tds INTEGER,
        PRIMARY KEY (player_id, game_id))""",
]


def is_seeded(engine: Engine) -> bool:
    try:
        with engine.connect() as conn:
            n = conn.execute(text("SELECT COUNT(*) FROM player_season_stats")).scalar()
            return bool(n and n > 0)
    except Exception:
        return False


def seed_demo(engine: Engine) -> None:
    """Idempotently create demo tables and populate sample data."""
    with engine.begin() as conn:
        for ddl in _DDL:
            conn.execute(text(ddl))

        conn.execute(text("DELETE FROM player_season_stats"))
        conn.execute(text("DELETE FROM player_game_stats"))
        conn.execute(text("DELETE FROM players"))
        conn.execute(text("DELETE FROM teams"))
        conn.execute(text("DELETE FROM games"))
        conn.execute(text("DELETE FROM seasons"))

        conn.execute(text("INSERT INTO seasons (season) VALUES (2022), (2023)"))

        conn.execute(
            text(
                "INSERT INTO teams (team_id, name, nickname, conference, division)"
                " VALUES (:id, :n, :nick, :c, :d)"
            ),
            [{"id": t[0], "n": t[1], "nick": t[2], "c": t[3], "d": t[4]} for t in SEED_TEAMS],
        )
        conn.execute(
            text(
                "INSERT INTO players (player_id, full_name, position, team_id)"
                " VALUES (:id, :n, :p, :t)"
            ),
            [{"id": p[0], "n": p[1], "p": p[2], "t": p[3]} for p in SEED_PLAYERS],
        )
        conn.execute(
            text(
                "INSERT INTO games (game_id, season, week, season_type, home_team,"
                " away_team, home_score, away_score) VALUES"
                " (:g, :s, :w, 'REG', :h, :a, :hs, :as_)"
            ),
            [
                {"g": g[0], "s": g[1], "w": g[2], "h": g[3], "a": g[4], "hs": g[5], "as_": g[6]}
                for g in _GAMES
            ],
        )
        conn.execute(
            text(
                "INSERT INTO player_season_stats (season, season_type, player_id,"
                " team_id, games_played, passing_yards, passing_tds, interceptions,"
                " rushing_yards, rushing_tds, receptions, receiving_yards,"
                " receiving_tds) VALUES (:se, :st, :pid, :tm, :gp, :py, :ptd, :int,"
                " :ry, :rtd, :rec, :rey, :retd)"
            ),
            [
                {
                    "se": r[0], "st": r[1], "pid": r[2], "tm": r[3], "gp": r[4],
                    "py": r[5], "ptd": r[6], "int": r[7], "ry": r[8], "rtd": r[9],
                    "rec": r[10], "rey": r[11], "retd": r[12],
                }
                for r in _PSS
            ],
        )
        conn.execute(
            text(
                "INSERT INTO player_game_stats (player_id, game_id, team_id,"
                " rushing_yards, rushing_tds, receptions, receiving_yards,"
                " receiving_tds, passing_yards, passing_tds) VALUES"
                " (:pid, :g, :tm, :ry, :rtd, :rec, :rey, :retd, :py, :ptd)"
            ),
            [
                {
                    "pid": r[0], "g": r[1], "tm": r[2], "ry": r[3], "rtd": r[4],
                    "rec": r[5], "rey": r[6], "retd": r[7], "py": r[8], "ptd": r[9],
                }
                for r in _PGS
            ],
        )
