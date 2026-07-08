"""Demo seed: a realistic slice of 2022-2023 NFL data into SQLite.

Enough to make the whole platform feel real with zero external services:
  - all 32 teams with conference/division
  - a full 17-week slate of 2023 results whose outcomes reproduce the real
    2023 regular-season W-L records (scores are synthetic but plausible)
  - ~75 fantasy-relevant players (QB/RB/WR/TE) with approximate real 2023
    season stats and computed PPR fantasy points

Numbers are approximate real-world regular-season figures, for demonstration
only. Everything here is deterministic (hash-derived, no randomness) so the
demo database is identical on every machine.
"""

from __future__ import annotations

import hashlib
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Engine

SEED_TEAMS: list[tuple[str, str, str, str, str]] = [
    # AFC East
    ("BUF", "Buffalo Bills", "Bills", "AFC", "AFC East"),
    ("MIA", "Miami Dolphins", "Dolphins", "AFC", "AFC East"),
    ("NYJ", "New York Jets", "Jets", "AFC", "AFC East"),
    ("NE", "New England Patriots", "Patriots", "AFC", "AFC East"),
    # AFC North
    ("BAL", "Baltimore Ravens", "Ravens", "AFC", "AFC North"),
    ("CLE", "Cleveland Browns", "Browns", "AFC", "AFC North"),
    ("PIT", "Pittsburgh Steelers", "Steelers", "AFC", "AFC North"),
    ("CIN", "Cincinnati Bengals", "Bengals", "AFC", "AFC North"),
    # AFC South
    ("HOU", "Houston Texans", "Texans", "AFC", "AFC South"),
    ("JAX", "Jacksonville Jaguars", "Jaguars", "AFC", "AFC South"),
    ("IND", "Indianapolis Colts", "Colts", "AFC", "AFC South"),
    ("TEN", "Tennessee Titans", "Titans", "AFC", "AFC South"),
    # AFC West
    ("KC", "Kansas City Chiefs", "Chiefs", "AFC", "AFC West"),
    ("LV", "Las Vegas Raiders", "Raiders", "AFC", "AFC West"),
    ("DEN", "Denver Broncos", "Broncos", "AFC", "AFC West"),
    ("LAC", "Los Angeles Chargers", "Chargers", "AFC", "AFC West"),
    # NFC East
    ("DAL", "Dallas Cowboys", "Cowboys", "NFC", "NFC East"),
    ("PHI", "Philadelphia Eagles", "Eagles", "NFC", "NFC East"),
    ("NYG", "New York Giants", "Giants", "NFC", "NFC East"),
    ("WAS", "Washington Commanders", "Commanders", "NFC", "NFC East"),
    # NFC North
    ("DET", "Detroit Lions", "Lions", "NFC", "NFC North"),
    ("GB", "Green Bay Packers", "Packers", "NFC", "NFC North"),
    ("MIN", "Minnesota Vikings", "Vikings", "NFC", "NFC North"),
    ("CHI", "Chicago Bears", "Bears", "NFC", "NFC North"),
    # NFC South
    ("TB", "Tampa Bay Buccaneers", "Buccaneers", "NFC", "NFC South"),
    ("NO", "New Orleans Saints", "Saints", "NFC", "NFC South"),
    ("ATL", "Atlanta Falcons", "Falcons", "NFC", "NFC South"),
    ("CAR", "Carolina Panthers", "Panthers", "NFC", "NFC South"),
    # NFC West
    ("SF", "San Francisco 49ers", "49ers", "NFC", "NFC West"),
    ("LAR", "Los Angeles Rams", "Rams", "NFC", "NFC West"),
    ("SEA", "Seattle Seahawks", "Seahawks", "NFC", "NFC West"),
    ("ARI", "Arizona Cardinals", "Cardinals", "NFC", "NFC West"),
]

# Real 2023 regular-season win totals (losses = 17 - wins; 2023 had no ties).
# The schedule generator below assigns game outcomes to reproduce these exactly.
TEAM_WINS_2023: dict[str, int] = {
    "BUF": 11, "MIA": 11, "NYJ": 7, "NE": 4,
    "BAL": 13, "CLE": 11, "PIT": 10, "CIN": 9,
    "HOU": 10, "JAX": 9, "IND": 9, "TEN": 6,
    "KC": 11, "LV": 8, "DEN": 8, "LAC": 5,
    "DAL": 12, "PHI": 11, "NYG": 6, "WAS": 4,
    "DET": 12, "GB": 9, "MIN": 7, "CHI": 7,
    "TB": 9, "NO": 9, "ATL": 7, "CAR": 2,
    "SF": 12, "LAR": 10, "SEA": 9, "ARI": 4,
}

# Real games pinned into the generated slate (single-game leaders reference
# these ids): game_id, week, home, away, home_score, away_score.
PINNED_GAMES: list[tuple[str, int, str, str, int, int]] = [
    ("2023_07_TEN_MIA", 7, "MIA", "TEN", 14, 27),
    ("2023_10_NYG_DAL", 10, "DAL", "NYG", 49, 17),
    ("2023_12_SF_SEA", 12, "SEA", "SF", 13, 31),
]

# (player_id, full_name, position, team_id)
SEED_PLAYERS: list[tuple[str, str, str, str]] = [
    # QB
    ("00-0033873", "Patrick Mahomes", "QB", "KC"),
    ("00-0033077", "Dak Prescott", "QB", "DAL"),
    ("00-0036212", "Tua Tagovailoa", "QB", "MIA"),
    ("00-0034857", "Josh Allen", "QB", "BUF"),
    ("00-0033106", "Jared Goff", "QB", "DET"),
    ("00-0037834", "Brock Purdy", "QB", "SF"),
    ("00-0036389", "Jalen Hurts", "QB", "PHI"),
    ("00-0034796", "Lamar Jackson", "QB", "BAL"),
    ("00-0036264", "Jordan Love", "QB", "GB"),
    ("00-0039163", "C.J. Stroud", "QB", "HOU"),
    ("00-0036355", "Justin Herbert", "QB", "LAC"),
    ("00-0036442", "Joe Burrow", "QB", "CIN"),
    ("00-0036971", "Trevor Lawrence", "QB", "JAX"),
    ("00-0034855", "Baker Mayfield", "QB", "TB"),
    ("00-0026498", "Matthew Stafford", "QB", "LAR"),
    ("00-0029263", "Russell Wilson", "QB", "DEN"),
    ("00-0030565", "Geno Smith", "QB", "SEA"),
    ("00-0029604", "Kirk Cousins", "QB", "MIN"),
    # RB
    ("00-0033280", "Christian McCaffrey", "RB", "SF"),
    ("00-0032764", "Derrick Henry", "RB", "TEN"),
    ("00-0036928", "Travis Etienne", "RB", "JAX"),
    ("00-0035685", "Kyren Williams", "RB", "LAR"),
    ("00-0031687", "Raheem Mostert", "RB", "MIA"),
    ("00-0037746", "Breece Hall", "RB", "NYJ"),
    ("00-0037540", "Rachaad White", "RB", "TB"),
    ("00-0039165", "Jahmyr Gibbs", "RB", "DET"),
    ("00-0037248", "James Cook", "RB", "BUF"),
    ("00-0034844", "Saquon Barkley", "RB", "NYG"),
    ("00-0033897", "Joe Mixon", "RB", "CIN"),
    ("00-0037197", "Isiah Pacheco", "RB", "KC"),
    ("00-0033906", "Alvin Kamara", "RB", "NO"),
    ("00-0039164", "Bijan Robinson", "RB", "ATL"),
    ("00-0036223", "D'Andre Swift", "RB", "PHI"),
    ("00-0035228", "Tony Pollard", "RB", "DAL"),
    ("00-0037525", "Kenneth Walker III", "RB", "SEA"),
    ("00-0035700", "Josh Jacobs", "RB", "LV"),
    ("00-0035243", "David Montgomery", "RB", "DET"),
    # WR
    ("00-0033040", "Tyreek Hill", "WR", "MIA"),
    ("00-0036322", "CeeDee Lamb", "WR", "DAL"),
    ("00-0036997", "Amon-Ra St. Brown", "WR", "DET"),
    ("00-0031408", "Mike Evans", "WR", "TB"),
    ("00-0036622", "Justin Jefferson", "WR", "MIN"),
    ("00-0035676", "A.J. Brown", "WR", "PHI"),
    ("00-0039166", "Puka Nacua", "WR", "LAR"),
    ("00-0036900", "Ja'Marr Chase", "WR", "CIN"),
    ("00-0031381", "Davante Adams", "WR", "LV"),
    ("00-0035717", "Brandon Aiyuk", "WR", "SF"),
    ("00-0031588", "Stefon Diggs", "WR", "BUF"),
    ("00-0034775", "DJ Moore", "WR", "CHI"),
    ("00-0030279", "Keenan Allen", "WR", "LAC"),
    ("00-0036973", "Nico Collins", "WR", "HOU"),
    ("00-0037741", "Garrett Wilson", "WR", "NYJ"),
    ("00-0037544", "Chris Olave", "WR", "NO"),
    ("00-0036252", "Michael Pittman Jr.", "WR", "IND"),
    ("00-0034764", "Calvin Ridley", "WR", "JAX"),
    ("00-0036963", "Jaylen Waddle", "WR", "MIA"),
    ("00-0035640", "DK Metcalf", "WR", "SEA"),
    ("00-0033288", "Deebo Samuel", "WR", "SF"),
    ("00-0035659", "Terry McLaurin", "WR", "WAS"),
    ("00-0039167", "Zay Flowers", "WR", "BAL"),
    ("00-0039168", "Rashee Rice", "WR", "KC"),
    ("00-0036912", "DeVonta Smith", "WR", "PHI"),
    # TE
    ("00-0030506", "Travis Kelce", "TE", "KC"),
    ("00-0039169", "Sam LaPorta", "TE", "DET"),
    ("00-0035229", "T.J. Hockenson", "TE", "MIN"),
    ("00-0033885", "George Kittle", "TE", "SF"),
    ("00-0033881", "Evan Engram", "TE", "JAX"),
    ("00-0033858", "David Njoku", "TE", "CLE"),
    ("00-0034753", "Mark Andrews", "TE", "BAL"),
    ("00-0037744", "Trey McBride", "TE", "ARI"),
    ("00-0037742", "Jake Ferguson", "TE", "DAL"),
    ("00-0039170", "Dalton Kincaid", "TE", "BUF"),
    ("00-0036253", "Cole Kmet", "TE", "CHI"),
    ("00-0036925", "Kyle Pitts", "TE", "ATL"),
]

# season, type, player_id, team, gp, pass_yds, pass_td, int, rush_yds, rush_td, rec, rec_yds, rec_td
_PSS = [
    # ---- 2023 QBs ----
    (2023, "REG", "00-0033873", "KC", 16, 4183, 27, 14, 389, 0, 0, 0, 0),
    (2023, "REG", "00-0033077", "DAL", 17, 4516, 36, 9, 242, 2, 0, 0, 0),
    (2023, "REG", "00-0036212", "MIA", 17, 4624, 29, 14, 74, 0, 0, 0, 0),
    (2023, "REG", "00-0034857", "BUF", 17, 4306, 29, 18, 524, 15, 0, 0, 0),
    (2023, "REG", "00-0033106", "DET", 17, 4575, 30, 12, 21, 1, 0, 0, 0),
    (2023, "REG", "00-0037834", "SF", 16, 4280, 31, 11, 144, 2, 0, 0, 0),
    (2023, "REG", "00-0036389", "PHI", 17, 3858, 23, 15, 605, 15, 0, 0, 0),
    (2023, "REG", "00-0034796", "BAL", 16, 3678, 24, 7, 821, 5, 0, 0, 0),
    (2023, "REG", "00-0036264", "GB", 17, 4159, 32, 11, 247, 4, 0, 0, 0),
    (2023, "REG", "00-0039163", "HOU", 15, 4108, 23, 5, 167, 3, 0, 0, 0),
    (2023, "REG", "00-0036355", "LAC", 13, 3134, 20, 7, 228, 3, 0, 0, 0),
    (2023, "REG", "00-0036442", "CIN", 10, 2309, 15, 6, 88, 2, 0, 0, 0),
    (2023, "REG", "00-0036971", "JAX", 16, 4016, 21, 14, 339, 4, 0, 0, 0),
    (2023, "REG", "00-0034855", "TB", 17, 4044, 28, 10, 163, 1, 0, 0, 0),
    (2023, "REG", "00-0026498", "LAR", 15, 3965, 24, 11, 22, 0, 0, 0, 0),
    (2023, "REG", "00-0029263", "DEN", 15, 3070, 26, 8, 341, 3, 0, 0, 0),
    (2023, "REG", "00-0030565", "SEA", 15, 3624, 20, 9, 155, 1, 0, 0, 0),
    (2023, "REG", "00-0029604", "MIN", 8, 2331, 18, 5, 21, 0, 0, 0, 0),
    # ---- 2023 RBs ----
    (2023, "REG", "00-0033280", "SF", 16, 0, 0, 0, 1459, 14, 67, 564, 7),
    (2023, "REG", "00-0032764", "TEN", 17, 0, 0, 0, 1167, 12, 28, 214, 0),
    (2023, "REG", "00-0036928", "JAX", 17, 0, 0, 0, 1008, 11, 58, 476, 1),
    (2023, "REG", "00-0035685", "LAR", 12, 0, 0, 0, 1144, 12, 32, 206, 3),
    (2023, "REG", "00-0031687", "MIA", 15, 0, 0, 0, 1012, 18, 25, 175, 3),
    (2023, "REG", "00-0037746", "NYJ", 17, 0, 0, 0, 994, 5, 76, 591, 4),
    (2023, "REG", "00-0037540", "TB", 17, 0, 0, 0, 990, 6, 64, 549, 3),
    (2023, "REG", "00-0039165", "DET", 15, 0, 0, 0, 945, 10, 52, 316, 1),
    (2023, "REG", "00-0037248", "BUF", 17, 0, 0, 0, 1122, 2, 44, 445, 4),
    (2023, "REG", "00-0034844", "NYG", 14, 0, 0, 0, 962, 6, 41, 280, 4),
    (2023, "REG", "00-0033897", "CIN", 17, 0, 0, 0, 1034, 9, 52, 376, 3),
    (2023, "REG", "00-0037197", "KC", 14, 0, 0, 0, 935, 7, 44, 244, 2),
    (2023, "REG", "00-0033906", "NO", 13, 0, 0, 0, 694, 5, 75, 466, 1),
    (2023, "REG", "00-0039164", "ATL", 17, 0, 0, 0, 976, 4, 58, 487, 4),
    (2023, "REG", "00-0036223", "PHI", 16, 0, 0, 0, 1049, 5, 39, 214, 1),
    (2023, "REG", "00-0035228", "DAL", 17, 0, 0, 0, 1005, 6, 55, 311, 0),
    (2023, "REG", "00-0037525", "SEA", 15, 0, 0, 0, 905, 8, 29, 259, 1),
    (2023, "REG", "00-0035700", "LV", 13, 0, 0, 0, 805, 6, 37, 296, 0),
    (2023, "REG", "00-0035243", "DET", 14, 0, 0, 0, 1015, 13, 16, 117, 0),
    # ---- 2023 WRs ----
    (2023, "REG", "00-0033040", "MIA", 16, 0, 0, 0, 0, 0, 119, 1799, 13),
    (2023, "REG", "00-0036322", "DAL", 17, 0, 0, 0, 0, 0, 135, 1749, 12),
    (2023, "REG", "00-0036997", "DET", 16, 0, 0, 0, 0, 0, 119, 1515, 10),
    (2023, "REG", "00-0031408", "TB", 17, 0, 0, 0, 0, 0, 79, 1255, 13),
    (2023, "REG", "00-0036622", "MIN", 10, 0, 0, 0, 0, 0, 68, 1074, 5),
    (2023, "REG", "00-0035676", "PHI", 17, 0, 0, 0, 0, 0, 106, 1456, 7),
    (2023, "REG", "00-0039166", "LAR", 17, 0, 0, 0, 0, 0, 105, 1486, 6),
    (2023, "REG", "00-0036900", "CIN", 16, 0, 0, 0, 0, 0, 100, 1216, 7),
    (2023, "REG", "00-0031381", "LV", 17, 0, 0, 0, 0, 0, 103, 1144, 8),
    (2023, "REG", "00-0035717", "SF", 16, 0, 0, 0, 0, 0, 75, 1342, 7),
    (2023, "REG", "00-0031588", "BUF", 17, 0, 0, 0, 0, 0, 107, 1183, 8),
    (2023, "REG", "00-0034775", "CHI", 17, 0, 0, 0, 0, 0, 96, 1364, 8),
    (2023, "REG", "00-0030279", "LAC", 13, 0, 0, 0, 0, 0, 108, 1243, 7),
    (2023, "REG", "00-0036973", "HOU", 15, 0, 0, 0, 0, 0, 80, 1297, 8),
    (2023, "REG", "00-0037741", "NYJ", 17, 0, 0, 0, 0, 0, 95, 1042, 3),
    (2023, "REG", "00-0037544", "NO", 16, 0, 0, 0, 0, 0, 87, 1123, 5),
    (2023, "REG", "00-0036252", "IND", 16, 0, 0, 0, 0, 0, 109, 1152, 4),
    (2023, "REG", "00-0034764", "JAX", 17, 0, 0, 0, 0, 0, 76, 1016, 8),
    (2023, "REG", "00-0036963", "MIA", 14, 0, 0, 0, 0, 0, 72, 1014, 4),
    (2023, "REG", "00-0035640", "SEA", 16, 0, 0, 0, 0, 0, 66, 1114, 8),
    (2023, "REG", "00-0033288", "SF", 15, 0, 0, 0, 225, 5, 60, 892, 7),
    (2023, "REG", "00-0035659", "WAS", 17, 0, 0, 0, 0, 0, 79, 1002, 4),
    (2023, "REG", "00-0039167", "BAL", 16, 0, 0, 0, 0, 0, 77, 858, 5),
    (2023, "REG", "00-0039168", "KC", 16, 0, 0, 0, 0, 0, 79, 938, 7),
    (2023, "REG", "00-0036912", "PHI", 16, 0, 0, 0, 0, 0, 81, 1066, 7),
    # ---- 2023 TEs ----
    (2023, "REG", "00-0030506", "KC", 15, 0, 0, 0, 0, 0, 93, 984, 5),
    (2023, "REG", "00-0039169", "DET", 17, 0, 0, 0, 0, 0, 86, 889, 10),
    (2023, "REG", "00-0035229", "MIN", 15, 0, 0, 0, 0, 0, 95, 960, 5),
    (2023, "REG", "00-0033885", "SF", 16, 0, 0, 0, 0, 0, 65, 1020, 6),
    (2023, "REG", "00-0033881", "JAX", 17, 0, 0, 0, 0, 0, 114, 963, 4),
    (2023, "REG", "00-0033858", "CLE", 16, 0, 0, 0, 0, 0, 81, 882, 6),
    (2023, "REG", "00-0034753", "BAL", 10, 0, 0, 0, 0, 0, 45, 544, 6),
    (2023, "REG", "00-0037744", "ARI", 17, 0, 0, 0, 0, 0, 81, 825, 3),
    (2023, "REG", "00-0037742", "DAL", 17, 0, 0, 0, 0, 0, 71, 761, 5),
    (2023, "REG", "00-0039170", "BUF", 16, 0, 0, 0, 0, 0, 73, 673, 2),
    (2023, "REG", "00-0036253", "CHI", 17, 0, 0, 0, 0, 0, 73, 719, 6),
    (2023, "REG", "00-0036925", "ATL", 17, 0, 0, 0, 0, 0, 53, 667, 3),
    # ---- 2022 rows so "career" sums span seasons ----
    (2022, "REG", "00-0033873", "KC", 17, 5250, 41, 12, 358, 4, 0, 0, 0),
    (2022, "REG", "00-0033040", "MIA", 17, 0, 0, 0, 1, 0, 119, 1710, 7),
    (2022, "REG", "00-0033280", "SF", 17, 0, 0, 0, 1139, 8, 85, 741, 5),
    (2022, "REG", "00-0034857", "BUF", 16, 4283, 35, 14, 762, 7, 0, 0, 0),
    (2022, "REG", "00-0030506", "KC", 17, 0, 0, 0, 0, 0, 110, 1338, 12),
    (2022, "REG", "00-0036622", "MIN", 17, 0, 0, 0, 0, 0, 128, 1809, 8),
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
        season_type TEXT, game_date TEXT, home_team TEXT, away_team TEXT,
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


def _ppr(py: int, ptd: int, ints: int, ry: int, rtd: int, rec: int, recy: int, retd: int) -> float:
    """Standard PPR scoring from season box-score totals."""
    return round(
        py * 0.04 + ptd * 4 - ints * 2 + ry * 0.1 + rtd * 6 + rec + recy * 0.1 + retd * 6,
        1,
    )


def _digest(key: str) -> int:
    return int(hashlib.md5(key.encode()).hexdigest(), 16)


def _game_date(week: int, index: int) -> str:
    """Week 1 Sunday was 2023-09-10; slot the first game Thursday, last Monday."""
    sunday = date(2023, 9, 10) + timedelta(weeks=week - 1)
    if index == 0:
        return (sunday - timedelta(days=3)).isoformat()  # Thursday
    if index == 15:
        return (sunday + timedelta(days=1)).isoformat()  # Monday
    return sunday.isoformat()


def build_2023_schedule() -> list[dict]:
    """A deterministic 17-week, 272-game slate reproducing real 2023 records.

    Pairings come from the circle round-robin method (each team plays every
    week); pinned real games are swapped into their weeks; outcomes are then
    assigned greedily against each team's remaining win budget, which lands
    every team exactly on its real 2023 W-L record (asserted below).
    """
    teams = [t[0] for t in SEED_TEAMS]
    fixed, others = teams[0], teams[1:]

    weeks: list[list[tuple[str, str]]] = []
    rotation = others[:]
    for _ in range(17):
        order = [fixed] + rotation
        weeks.append([(order[i], order[len(order) - 1 - i]) for i in range(len(teams) // 2)])
        rotation = [rotation[-1]] + rotation[:-1]

    # Swap pinned matchups into their weeks: make `home` and `away` partners.
    pinned_by_week: dict[int, list[tuple[str, int, str, str, int, int]]] = {}
    for g in PINNED_GAMES:
        pinned_by_week.setdefault(g[1], []).append(g)
    for week_no, pins in pinned_by_week.items():
        pairs = weeks[week_no - 1]
        for _, _, home, away, _, _ in pins:
            partner: dict[str, int] = {}
            for i, (a, b) in enumerate(pairs):
                if home in (a, b):
                    partner["h"] = i
                if away in (a, b):
                    partner["a"] = i
            hi, ai = partner["h"], partner["a"]
            if hi == ai:
                continue
            ha, hb = pairs[hi]
            aa, ab = pairs[ai]
            h_other = hb if ha == home else ha
            a_other = ab if aa == away else aa
            pairs[hi] = (home, away)
            pairs[ai] = (h_other, a_other)

    pinned_lookup = {
        frozenset((g[2], g[3])): g for g in PINNED_GAMES
    }

    wins_needed = dict(TEAM_WINS_2023)
    games_left = {t: 17 for t in teams}
    games: list[dict] = []

    for week_no, pairs in enumerate(weeks, start=1):
        for idx, (a, b) in enumerate(pairs):
            pin = pinned_lookup.get(frozenset((a, b)))
            if pin is not None and pin[1] == week_no:
                gid, _, home, away, hs, as_ = pin
                winner = home if hs > as_ else away
                pinned = True
            else:
                h = _digest(f"2023:{week_no}:{a}:{b}")
                home, away = (a, b) if h % 2 == 0 else (b, a)
                gid = f"2023_{week_no:02d}_{away}_{home}"
                hs = as_ = None
                pinned = False

                la, ra = wins_needed[a], games_left[a]
                lb, rb = wins_needed[b], games_left[b]
                if la >= ra:
                    winner = a
                elif lb >= rb:
                    winner = b
                elif la <= 0:
                    winner = b
                elif lb <= 0:
                    winner = a
                else:
                    winner = a if la * rb >= lb * ra else b

            wins_needed[winner] -= 1
            games_left[a] -= 1
            games_left[b] -= 1
            games.append(
                {
                    "game_id": gid,
                    "week": week_no,
                    "date": _game_date(week_no, idx),
                    "home": home,
                    "away": away,
                    "winner": winner,
                    "pinned": pinned,
                    "home_score": hs,
                    "away_score": as_,
                }
            )

    _repair_records(games, wins_needed)

    schedule: list[dict] = []
    for g in games:
        hs, as_ = g["home_score"], g["away_score"]
        if hs is None:
            h = _digest(g["game_id"])
            w_score = 20 + h % 15
            l_score = 3 + (h >> 8) % (w_score - 6)
            hs = w_score if g["winner"] == g["home"] else l_score
            as_ = w_score if g["winner"] == g["away"] else l_score
        schedule.append(
            {
                "game_id": g["game_id"],
                "season": 2023,
                "week": g["week"],
                "date": g["date"],
                "home": g["home"],
                "away": g["away"],
                "home_score": hs,
                "away_score": as_,
            }
        )
    return schedule


def _repair_records(games: list[dict], residual: dict[str, int]) -> None:
    """Flip non-pinned outcomes until every team hits its target exactly.

    ``residual[t]`` is wins still owed to t (negative = t won too many). For
    each team owed a win, walk a chain of losses — t lost to x1, x1 lost to
    x2, … — ending at a team with surplus wins, and flip every game on the
    chain: the head gains a win, the tail sheds one, everyone between nets
    zero. Such a chain always exists while residuals are unbalanced, because
    total surplus equals total deficit and every team plays every week.
    """
    while True:
        deficits = sorted(t for t, r in residual.items() if r > 0)
        if not deficits:
            break
        start = deficits[0]

        # BFS over "lost to" edges from `start` to any surplus team.
        came_from: dict[str, dict] = {}
        frontier = [start]
        seen = {start}
        goal = None
        while frontier and goal is None:
            nxt: list[str] = []
            for t in frontier:
                for g in games:
                    if g["pinned"] or t not in (g["home"], g["away"]):
                        continue
                    if g["winner"] == t:
                        continue
                    opp = g["winner"]
                    if opp in seen:
                        continue
                    seen.add(opp)
                    came_from[opp] = g
                    if residual[opp] < 0:
                        goal = opp
                        break
                    nxt.append(opp)
                if goal is not None:
                    break
            frontier = nxt
        assert goal is not None, f"no repair chain from {start}: {residual}"

        node = goal
        while node != start:
            g = came_from[node]
            loser = g["home"] if g["winner"] == g["away"] else g["away"]
            g["winner"] = loser  # flip: previous loser now wins
            node = loser
        residual[start] -= 1
        residual[goal] += 1


def is_seeded(engine: Engine) -> bool:
    try:
        with engine.connect() as conn:
            n = conn.execute(text("SELECT COUNT(*) FROM player_season_stats")).scalar()
            games = conn.execute(text("SELECT COUNT(*) FROM games")).scalar()
            # A full slate (272 games) marks the current seed generation;
            # older demo databases reseed automatically on upgrade.
            return bool(n and n > 0 and games and games >= 272)
    except Exception:
        return False


def seed_demo(engine: Engine) -> None:
    """Idempotently create demo tables and populate sample data."""
    schedule = build_2023_schedule()

    with engine.begin() as conn:
        # game_date was added after the first demo release; rebuild the games
        # table if an old database is missing it.
        try:
            cols = [r[1] for r in conn.execute(text("PRAGMA table_info(games)"))]
            if cols and "game_date" not in cols:
                conn.execute(text("DROP TABLE games"))
        except Exception:
            pass

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
                "INSERT INTO games (game_id, season, week, season_type, game_date,"
                " home_team, away_team, home_score, away_score) VALUES"
                " (:g, :s, :w, 'REG', :d, :h, :a, :hs, :as_)"
            ),
            [
                {
                    "g": g["game_id"], "s": g["season"], "w": g["week"], "d": g["date"],
                    "h": g["home"], "a": g["away"], "hs": g["home_score"], "as_": g["away_score"],
                }
                for g in schedule
            ],
        )
        conn.execute(
            text(
                "INSERT INTO player_season_stats (season, season_type, player_id,"
                " team_id, games_played, passing_yards, passing_tds, interceptions,"
                " rushing_yards, rushing_tds, receptions, receiving_yards,"
                " receiving_tds, fantasy_points_ppr) VALUES (:se, :st, :pid, :tm,"
                " :gp, :py, :ptd, :int, :ry, :rtd, :rec, :rey, :retd, :fp)"
            ),
            [
                {
                    "se": r[0], "st": r[1], "pid": r[2], "tm": r[3], "gp": r[4],
                    "py": r[5], "ptd": r[6], "int": r[7], "ry": r[8], "rtd": r[9],
                    "rec": r[10], "rey": r[11], "retd": r[12],
                    "fp": _ppr(r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12]),
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
