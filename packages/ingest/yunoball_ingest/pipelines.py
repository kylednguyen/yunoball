"""nflverse -> warehouse load pipelines.

Each pipeline pulls a dataset via nfl_data_py, reshapes it to match the Drizzle
schema, and upserts it into Postgres. Pipelines are idempotent: re-running a
season replaces its rows.

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
    _replace(engine, "teams", df)
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
    df = pd.DataFrame(
        {
            "player_id": wk["player_id"],
            "game_id": _build_game_id(wk),
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
            "fantasy_points_ppr": wk.get("fantasy_points_ppr"),
        }
    )
    df = df[df["player_id"].notna() & df["game_id"].notna()]
    _upsert(engine, "player_game_stats", df, conflict=["player_id", "game_id"])
    return len(df)


# --------------------------------------------------------------------------- #


def _build_game_id(wk: pd.DataFrame) -> pd.Series:
    """nflverse weekly data lacks game_id directly; reconstruct from parts."""
    return (
        wk["season"].astype(str)
        + "_"
        + wk["week"].astype(str).str.zfill(2)
        + "_"
        + wk["opponent_team"].astype(str)
        + "_"
        + wk["recent_team"].astype(str)
    )


def _replace(engine: Engine, table: str, df: pd.DataFrame) -> None:
    df.to_sql(table, engine, if_exists="append", index=False, method="multi")


def _upsert(
    engine: Engine, table: str, df: pd.DataFrame, conflict: list[str]
) -> None:
    """Naive upsert via staging table; swapped for COPY + ON CONFLICT later."""
    from sqlalchemy import text

    df = df.where(pd.notna(df), None)
    cols = list(df.columns)
    placeholders = ", ".join(f":{c}" for c in cols)
    updates = ", ".join(f"{c}=EXCLUDED.{c}" for c in cols if c not in conflict)
    stmt = text(
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT ({', '.join(conflict)}) DO UPDATE SET {updates}"
        if updates
        else f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT ({', '.join(conflict)}) DO NOTHING"
    )
    records = df.to_dict(orient="records")
    with engine.begin() as conn:
        for rec in tqdm(records, desc=table, unit="row"):
            conn.execute(stmt, rec)
