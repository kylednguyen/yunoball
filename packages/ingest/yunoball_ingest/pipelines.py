"""nflverse -> warehouse load pipelines.

Each pipeline pulls a dataset via nfl_data_py, reshapes it to match the
warehouse schema (packages/db), and upserts it into Postgres. Pipelines are
idempotent: re-running a season replaces its rows.

NOTE: column mappings below are the common case and will be tightened as the
schema is exercised against real data in Phase 1.
"""

from __future__ import annotations

import nfl_data_py as nfl
import pandas as pd
from sqlalchemy.engine import Engine
from tqdm import tqdm


def load_teams(engine: Engine) -> int:
    desc = nfl.import_team_desc()
    df = pd.DataFrame(
        {
            "team_id": desc["team_abbr"],
            "name": desc["team_name"],
            "nickname": desc["team_nick"],
            "conference": desc["team_conf"],
            "division": desc["team_division"],
        }
    ).drop_duplicates(subset=["team_id"])
    _upsert(engine, "teams", df, conflict=["team_id"])
    return len(df)


def load_seasons(engine: Engine, years: list[int]) -> int:
    df = pd.DataFrame({"season": years})
    _upsert(engine, "seasons", df, conflict=["season"])
    return len(df)


def load_players(engine: Engine, years: list[int]) -> int:
    rosters = nfl.import_seasonal_rosters(years)
    df = pd.DataFrame(
        {
            "player_id": rosters["player_id"],
            "full_name": rosters["player_name"],
            "first_name": rosters.get("first_name"),
            "last_name": rosters.get("last_name"),
            "position": rosters.get("position"),
            "birth_date": rosters.get("birth_date"),
            "college": rosters.get("college"),
        }
    ).drop_duplicates(subset=["player_id"])
    df = df[df["player_id"].notna()]
    _upsert(engine, "players", df, conflict=["player_id"])
    return len(df)


def load_games(engine: Engine, years: list[int]) -> int:
    sched = nfl.import_schedules(years)
    df = pd.DataFrame(
        {
            "game_id": sched["game_id"],
            "season": sched["season"],
            "week": sched["week"],
            "season_type": sched["game_type"],
            "game_date": pd.to_datetime(sched["gameday"]).dt.date,
            "home_team": sched["home_team"],
            "away_team": sched["away_team"],
            "home_score": sched["home_score"],
            "away_score": sched["away_score"],
            "stadium": sched.get("stadium"),
            "roof": sched.get("roof"),
            "surface": sched.get("surface"),
        }
    )
    _upsert(engine, "games", df, conflict=["game_id"])
    return len(df)


def load_player_game_stats(engine: Engine, years: list[int]) -> int:
    wk = nfl.import_weekly_data(years)
    # Resolve the canonical nflverse game_id from the schedule by
    # (season, week, team) — a team plays one game per week, so this is
    # unambiguous and avoids guessing home/away ordering.
    game_ids = _game_id_lookup(years)
    keys = zip(
        wk["season"].astype(int),
        wk["week"].astype(int),
        wk["recent_team"].astype(str),
    )
    df = pd.DataFrame(
        {
            "player_id": wk["player_id"],
            "game_id": [game_ids.get(k) for k in keys],
            "team_id": wk["recent_team"],
            "completions": wk.get("completions"),
            "attempts": wk.get("attempts"),
            "passing_yards": wk.get("passing_yards"),
            "passing_tds": wk.get("passing_tds"),
            "interceptions": wk.get("interceptions"),
            "carries": wk.get("carries"),
            "rushing_yards": wk.get("rushing_yards"),
            "rushing_tds": wk.get("rushing_tds"),
            "targets": wk.get("targets"),
            "receptions": wk.get("receptions"),
            "receiving_yards": wk.get("receiving_yards"),
            "receiving_tds": wk.get("receiving_tds"),
        }
    )
    # game_id and team_id are NOT NULL FKs; drop any row missing either.
    df = df[
        df["player_id"].notna() & df["game_id"].notna() & df["team_id"].notna()
    ]
    _upsert(engine, "player_game_stats", df, conflict=["player_id", "game_id"])
    return len(df)


def load_player_season_stats(engine: Engine, years: list[int]) -> int:
    sea = nfl.import_seasonal_data(years)  # season totals per player
    rosters = nfl.import_seasonal_rosters(years)[["player_id", "season", "team"]]
    sea = sea.merge(rosters, on=["player_id", "season"], how="left")
    df = pd.DataFrame(
        {
            "player_id": sea["player_id"],
            "season": sea["season"].astype(int),
            "season_type": "REG",
            "team_id": sea.get("team"),
            "games_played": sea.get("games"),
            "passing_yards": sea.get("passing_yards"),
            "passing_tds": sea.get("passing_tds"),
            "interceptions": sea.get("interceptions"),
            "rushing_yards": sea.get("rushing_yards"),
            "rushing_tds": sea.get("rushing_tds"),
            "receptions": sea.get("receptions"),
            "receiving_yards": sea.get("receiving_yards"),
            "receiving_tds": sea.get("receiving_tds"),
        }
    )
    df = df[df["player_id"].notna()]
    _upsert(
        engine,
        "player_season_stats",
        df,
        conflict=["player_id", "season", "season_type"],
    )
    return len(df)


def load_team_game_stats(engine: Engine, years: list[int]) -> int:
    """One row per team per game (two per game), from the schedule scores.

    Yardage/turnover columns are left to a later PBP-aggregation pass; points,
    result and home/away are authoritative from the schedule.
    """
    sched = nfl.import_schedules(years)
    sched = sched[sched["home_score"].notna() & sched["away_score"].notna()]
    rows = []
    for _, g in sched.iterrows():
        rows.append(_team_row(g, home=True))
        rows.append(_team_row(g, home=False))
    df = pd.DataFrame(rows)
    _upsert(engine, "team_game_stats", df, conflict=["team_id", "game_id"])
    return len(df)


def _team_row(g: "pd.Series", *, home: bool) -> dict:
    pf = g["home_score"] if home else g["away_score"]
    pa = g["away_score"] if home else g["home_score"]
    return {
        "team_id": g["home_team"] if home else g["away_team"],
        "game_id": g["game_id"],
        "is_home": home,
        "points_for": int(pf),
        "points_against": int(pa),
        "result": "W" if pf > pa else "L" if pf < pa else "T",
    }


# --------------------------------------------------------------------------- #


def _game_id_lookup(years: list[int]) -> dict[tuple[int, int, str], str]:
    """Map (season, week, team) -> canonical nflverse game_id, from the schedule.

    Each game contributes two entries (home and away team) so a player's
    recent_team resolves to the right game regardless of side.
    """
    sched = nfl.import_schedules(years)
    lookup: dict[tuple[int, int, str], str] = {}
    for season, week, home, away, game_id in zip(
        sched["season"].astype(int),
        sched["week"].astype(int),
        sched["home_team"].astype(str),
        sched["away_team"].astype(str),
        sched["game_id"].astype(str),
    ):
        lookup[(season, week, home)] = game_id
        lookup[(season, week, away)] = game_id
    return lookup


_CHUNK = 5_000


def _upsert(
    engine: Engine, table: str, df: pd.DataFrame, conflict: list[str]
) -> None:
    """Batched INSERT ... ON CONFLICT upsert (executemany in chunks).

    Works on Postgres and SQLite (both support ON CONFLICT). Dedupes within the
    batch on the conflict key so a single executemany can't hit
    "ON CONFLICT DO UPDATE command cannot affect row a second time".
    """
    from sqlalchemy import text

    df = df.drop_duplicates(subset=conflict, keep="last")
    df = df.where(pd.notna(df), None)
    cols = list(df.columns)
    placeholders = ", ".join(f":{c}" for c in cols)
    updates = ", ".join(f"{c}=EXCLUDED.{c}" for c in cols if c not in conflict)
    action = (
        f"DO UPDATE SET {updates}" if updates else "DO NOTHING"
    )
    stmt = text(
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT ({', '.join(conflict)}) {action}"
    )
    records = df.to_dict(orient="records")
    with engine.begin() as conn:
        for i in tqdm(range(0, len(records), _CHUNK), desc=table, unit="chunk"):
            conn.execute(stmt, records[i : i + _CHUNK])
