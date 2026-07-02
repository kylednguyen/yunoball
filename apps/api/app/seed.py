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

# season, type, player_id, team, gp, comp, att, pass_yds, pass_td, int, sacks,
#   rush_yds, rush_td, tgt, rec, rec_yds, rec_td
_PSS = [
    (2023, "REG", "00-0033873", "KC", 16, 401, 597, 4183, 27, 14, 27, 389, 0, 0, 0, 0, 0),
    (2023, "REG", "00-0033077", "DAL", 17, 410, 590, 4516, 36, 9, 39, 242, 2, 0, 0, 0, 0),
    (2023, "REG", "00-0036212", "MIA", 17, 388, 560, 4624, 29, 14, 29, 74, 0, 0, 0, 0, 0),
    (2023, "REG", "00-0034857", "BUF", 17, 385, 579, 4306, 29, 18, 24, 524, 15, 0, 0, 0, 0),
    (2023, "REG", "00-0033106", "DET", 17, 407, 605, 4575, 30, 12, 30, 21, 1, 0, 0, 0, 0),
    (2023, "REG", "00-0037834", "SF", 16, 308, 444, 4280, 31, 11, 28, 144, 2, 0, 0, 0, 0),
    (2023, "REG", "00-0036389", "PHI", 17, 352, 538, 3858, 23, 15, 38, 605, 15, 0, 0, 0, 0),
    (2023, "REG", "00-0033280", "SF", 16, 0, 0, 0, 0, 0, 0, 1459, 14, 83, 67, 564, 7),
    (2023, "REG", "00-0032764", "TEN", 17, 0, 0, 0, 0, 0, 0, 1167, 12, 32, 28, 214, 0),
    (2023, "REG", "00-0036928", "JAX", 17, 0, 0, 0, 0, 0, 0, 1008, 11, 74, 58, 476, 1),
    (2023, "REG", "00-0033040", "MIA", 16, 0, 0, 0, 0, 0, 0, 0, 0, 171, 119, 1799, 13),
    (2023, "REG", "00-0036322", "DAL", 17, 0, 0, 0, 0, 0, 0, 0, 0, 181, 135, 1749, 12),
    (2023, "REG", "00-0036997", "DET", 16, 0, 0, 0, 0, 0, 0, 0, 0, 164, 119, 1515, 10),
    (2023, "REG", "00-0031408", "TB", 17, 0, 0, 0, 0, 0, 0, 0, 0, 136, 79, 1255, 13),
    # a couple of 2022 rows so "career" sums span seasons
    (2022, "REG", "00-0033873", "KC", 17, 435, 648, 5250, 41, 12, 26, 358, 4, 0, 0, 0, 0),
    (2022, "REG", "00-0033040", "MIA", 17, 0, 0, 0, 0, 0, 0, 1, 0, 170, 119, 1710, 7),
    (2022, "REG", "00-0033280", "SF", 17, 0, 0, 0, 0, 0, 0, 1139, 8, 108, 85, 741, 5),
]

# game_id, season, week, home, away, home_score, away_score
_GAMES = [
    ("2023_07_TEN_MIA", 2023, 7, "MIA", "TEN", 14, 27),
    ("2023_10_NYG_DAL", 2023, 10, "DAL", "NYG", 49, 17),
    ("2023_12_SF_SEA", 2023, 12, "SEA", "SF", 13, 31),
    ("2023_10_KC_DEN", 2023, 10, "DEN", "KC", 8, 19),
]

# player_id, game_id, team, comp, att, int, sacks, rush_yds, rush_td, tgt,
#   rec, rec_yds, rec_td, pass_yds, pass_td
_PGS = [
    ("00-0032764", "2023_07_TEN_MIA", "TEN", 0, 0, 0, 0, 178, 1, 1, 1, 9, 0, 0, 0),
    ("00-0033280", "2023_12_SF_SEA", "SF", 0, 0, 0, 0, 152, 1, 7, 6, 53, 0, 0, 0),
    ("00-0036928", "2023_07_TEN_MIA", "JAX", 0, 0, 0, 0, 88, 0, 5, 4, 31, 0, 0, 0),
    ("00-0036322", "2023_10_NYG_DAL", "DAL", 0, 0, 0, 0, 0, 0, 11, 9, 151, 1, 0, 0),
    # a QB box score so single-game passing / rate stats have data in the demo
    ("00-0033873", "2023_10_KC_DEN", "KC", 24, 33, 1, 2, 25, 0, 0, 0, 0, 0, 306, 2),
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
        games_played INTEGER, completions INTEGER, attempts INTEGER,
        passing_yards INTEGER, passing_tds INTEGER, interceptions INTEGER,
        sacks REAL, rushing_yards INTEGER, rushing_tds INTEGER,
        targets INTEGER, receptions INTEGER, receiving_yards INTEGER,
        receiving_tds INTEGER,
        PRIMARY KEY (player_id, season, season_type))""",
    """CREATE TABLE IF NOT EXISTS player_game_stats (
        player_id TEXT, game_id TEXT, team_id TEXT,
        completions INTEGER, attempts INTEGER, interceptions INTEGER, sacks REAL,
        rushing_yards INTEGER, rushing_tds INTEGER, targets INTEGER,
        receptions INTEGER, receiving_yards INTEGER, receiving_tds INTEGER,
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
                " team_id, games_played, completions, attempts, passing_yards,"
                " passing_tds, interceptions, sacks, rushing_yards, rushing_tds,"
                " targets, receptions, receiving_yards, receiving_tds)"
                " VALUES (:se, :st, :pid, :tm, :gp, :comp, :att, :py, :ptd, :int,"
                " :sck, :ry, :rtd, :tgt, :rec, :rey, :retd)"
            ),
            [
                {
                    "se": r[0], "st": r[1], "pid": r[2], "tm": r[3], "gp": r[4],
                    "comp": r[5], "att": r[6], "py": r[7], "ptd": r[8], "int": r[9],
                    "sck": r[10], "ry": r[11], "rtd": r[12], "tgt": r[13],
                    "rec": r[14], "rey": r[15], "retd": r[16],
                }
                for r in _PSS
            ],
        )
        conn.execute(
            text(
                "INSERT INTO player_game_stats (player_id, game_id, team_id,"
                " completions, attempts, interceptions, sacks, rushing_yards,"
                " rushing_tds, targets, receptions, receiving_yards,"
                " receiving_tds, passing_yards, passing_tds) VALUES"
                " (:pid, :g, :tm, :comp, :att, :int, :sck, :ry, :rtd, :tgt, :rec,"
                " :rey, :retd, :py, :ptd)"
            ),
            [
                {
                    "pid": r[0], "g": r[1], "tm": r[2], "comp": r[3], "att": r[4],
                    "int": r[5], "sck": r[6], "ry": r[7], "rtd": r[8], "tgt": r[9],
                    "rec": r[10], "rey": r[11], "retd": r[12], "py": r[13], "ptd": r[14],
                }
                for r in _PGS
            ],
        )
