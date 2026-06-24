"""nflverse -> warehouse load pipelines.

Each pipeline pulls a dataset via nfl_data_py, reshapes it to match the
SQLAlchemy schema in `yunoball_db`, and upserts it into Postgres. Pipelines are
idempotent: re-running a season replaces its rows (ON CONFLICT DO UPDATE).

Load order matters (FKs): teams -> seasons -> players -> games ->
player_game_stats -> team_game_stats -> player_season_stats -> plays.
"""

from __future__ import annotations

import numpy as np
import nfl_data_py as nfl
import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine
from tqdm import tqdm


def _drop_preseason(df: pd.DataFrame) -> pd.DataFrame:
    # nflverse codes preseason as PRE; the warehouse only tracks REG + postseason
    # (which is what weekly/seasonal player data covers).
    return df[df["season_type"].ne("PRE")] if "season_type" in df else df


# --------------------------------------------------------------------------- #
# Dimensions
# --------------------------------------------------------------------------- #


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
    df = df[df["team_id"].notna()]
    _upsert(engine, "teams", df, conflict=["team_id"])
    return len(df)


def load_seasons(engine: Engine, years: list[int]) -> int:
    sched = _schedule(years)
    dates = pd.to_datetime(sched["gameday"], errors="coerce")
    bounds = (
        pd.DataFrame({"season": sched["season"].values, "d": dates.values})
        .dropna()
        .groupby("season")["d"]
        .agg(["min", "max"])
    )
    df = pd.DataFrame({"season": years})
    df["start_date"] = df["season"].map(lambda s: _date(bounds["min"].get(s)) if s in bounds.index else None)
    df["end_date"] = df["season"].map(lambda s: _date(bounds["max"].get(s)) if s in bounds.index else None)
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
            "birth_date": pd.to_datetime(rosters.get("birth_date"), errors="coerce").dt.date,
            "height_inches": rosters["height"].map(_parse_height) if "height" in rosters else None,
            "weight_lbs": pd.to_numeric(rosters.get("weight"), errors="coerce"),
            "college": rosters.get("college"),
            "rookie_season": pd.to_numeric(rosters.get("rookie_year"), errors="coerce"),
        }
    )
    df = df[df["player_id"].notna()]
    # A player can appear across multiple seasons; keep the most recent row.
    df = df.drop_duplicates(subset=["player_id"], keep="last")
    _upsert(engine, "players", df, conflict=["player_id"])
    return len(df)


def load_games(engine: Engine, years: list[int]) -> int:
    sched = _schedule(years)
    df = pd.DataFrame(
        {
            "game_id": sched["game_id"],
            "season": sched["season"],
            "week": sched["week"],
            "season_type": sched["game_type"],
            "game_date": pd.to_datetime(sched["gameday"], errors="coerce").dt.date,
            "home_team": sched["home_team"],
            "away_team": sched["away_team"],
            "home_score": sched["home_score"],
            "away_score": sched["away_score"],
            "stadium": sched.get("stadium"),
            "roof": sched.get("roof"),
            "surface": sched.get("surface"),
        }
    )
    df = df[df["game_id"].notna() & df["home_team"].notna() & df["away_team"].notna()]
    _upsert(engine, "games", df, conflict=["game_id"])
    return len(df)


# --------------------------------------------------------------------------- #
# Facts
# --------------------------------------------------------------------------- #


def load_player_game_stats(engine: Engine, years: list[int]) -> int:
    wk = _drop_preseason(nfl.import_weekly_data(years))
    gmap = _team_week_game_map(_schedule(years))

    game_id = [
        gmap.get((s, w, t), (None,))[0]
        for s, w, t in zip(wk["season"], wk["week"], wk["recent_team"])
    ]
    df = pd.DataFrame(
        {
            "player_id": wk["player_id"].values,
            "game_id": game_id,
            "team_id": wk["recent_team"].values,
            "completions": wk.get("completions"),
            "attempts": wk.get("attempts"),
            "passing_yards": wk.get("passing_yards"),
            "passing_tds": wk.get("passing_tds"),
            "interceptions": wk.get("interceptions"),
            "sacks": wk.get("sacks"),
            "carries": wk.get("carries"),
            "rushing_yards": wk.get("rushing_yards"),
            "rushing_tds": wk.get("rushing_tds"),
            "targets": wk.get("targets"),
            "receptions": wk.get("receptions"),
            "receiving_yards": wk.get("receiving_yards"),
            "receiving_tds": wk.get("receiving_tds"),
            "fumbles": _sum_cols(wk, "rushing_fumbles", "receiving_fumbles", "sack_fumbles"),
            "fumbles_lost": _sum_cols(
                wk, "rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost"
            ),
            "fantasy_points_ppr": wk.get("fantasy_points_ppr"),
        }
    )
    df = df[df["player_id"].notna() & df["game_id"].notna()]
    df = df.drop_duplicates(subset=["player_id", "game_id"], keep="last")

    # FK safety: a handful of weekly players may not be in seasonal rosters
    # (mid-week call-ups). Backfill them with the names weekly provides.
    backfill = (
        pd.DataFrame(
            {
                "player_id": wk["player_id"],
                "full_name": wk.get("player_display_name", wk.get("player_name")),
                "position": wk.get("position"),
            }
        )
        .dropna(subset=["player_id", "full_name"])
        .drop_duplicates(subset=["player_id"])
    )
    _upsert(engine, "players", backfill, conflict=["player_id"], do_update=False)

    _upsert(engine, "player_game_stats", df, conflict=["player_id", "game_id"])
    return len(df)


def load_team_game_stats(engine: Engine, years: list[int]) -> int:
    """Per-team box score. Points/result come from the schedule (exact); passing/
    rushing yards and turnovers are summed from the player box (accurate team
    totals). total_yards / time_of_possession derive from PBP in Phase 4.
    """
    sql = text(
        """
        WITH agg AS (
            SELECT game_id, team_id,
                   SUM(passing_yards)::int AS passing_yards,
                   SUM(rushing_yards)::int AS rushing_yards,
                   (COALESCE(SUM(interceptions),0) + COALESCE(SUM(fumbles_lost),0))::int AS turnovers
            FROM player_game_stats GROUP BY game_id, team_id
        ),
        sides AS (
            SELECT home_team AS team_id, game_id, TRUE AS is_home,
                   home_score AS points_for, away_score AS points_against
            FROM games WHERE season = ANY(:years)
            UNION ALL
            SELECT away_team AS team_id, game_id, FALSE AS is_home,
                   away_score AS points_for, home_score AS points_against
            FROM games WHERE season = ANY(:years)
        )
        INSERT INTO team_game_stats
            (team_id, game_id, is_home, points_for, points_against, result,
             passing_yards, rushing_yards, turnovers)
        SELECT s.team_id, s.game_id, s.is_home, s.points_for, s.points_against,
               CASE WHEN s.points_for IS NULL OR s.points_against IS NULL THEN NULL
                    WHEN s.points_for > s.points_against THEN 'W'
                    WHEN s.points_for < s.points_against THEN 'L'
                    ELSE 'T' END,
               a.passing_yards, a.rushing_yards, a.turnovers
        FROM sides s
        LEFT JOIN agg a ON a.game_id = s.game_id AND a.team_id = s.team_id
        ON CONFLICT (team_id, game_id) DO UPDATE SET
            is_home = EXCLUDED.is_home,
            points_for = EXCLUDED.points_for,
            points_against = EXCLUDED.points_against,
            result = EXCLUDED.result,
            passing_yards = EXCLUDED.passing_yards,
            rushing_yards = EXCLUDED.rushing_yards,
            turnovers = EXCLUDED.turnovers
        """
    )
    with engine.begin() as conn:
        conn.execute(sql, {"years": years})
        count = conn.execute(
            text(
                "SELECT COUNT(*) FROM team_game_stats t JOIN games g USING (game_id) "
                "WHERE g.season = ANY(:years)"
            ),
            {"years": years},
        ).scalar()
    return int(count or 0)


# --------------------------------------------------------------------------- #
# Rollups
# --------------------------------------------------------------------------- #


def load_player_season_stats(engine: Engine, years: list[int]) -> int:
    seas = nfl.import_seasonal_data(years)  # regular season totals
    # Primary team per (player, season) from rosters (the rollup has none).
    rosters = nfl.import_seasonal_rosters(years)[["player_id", "season", "team"]].dropna()
    team_map = (
        rosters.groupby(["player_id", "season"])["team"]
        .agg(lambda s: s.mode().iat[0] if not s.mode().empty else s.iloc[0])
        .reset_index()
    )
    seas = seas.merge(team_map, on=["player_id", "season"], how="left")

    df = pd.DataFrame(
        {
            "player_id": seas["player_id"],
            "season": seas["season"],
            "season_type": seas.get("season_type", "REG"),
            "team_id": seas.get("team"),
            "games_played": seas.get("games"),
            "passing_yards": seas.get("passing_yards"),
            "passing_tds": seas.get("passing_tds"),
            "interceptions": seas.get("interceptions"),
            "rushing_yards": seas.get("rushing_yards"),
            "rushing_tds": seas.get("rushing_tds"),
            "receptions": seas.get("receptions"),
            "receiving_yards": seas.get("receiving_yards"),
            "receiving_tds": seas.get("receiving_tds"),
            "fantasy_points_ppr": seas.get("fantasy_points_ppr"),
        }
    )
    df["season_type"] = df["season_type"].fillna("REG")
    df = df[df["player_id"].notna()].drop_duplicates(
        subset=["player_id", "season", "season_type"], keep="last"
    )
    _upsert(engine, "player_season_stats", df, conflict=["player_id", "season", "season_type"])
    return len(df)


def load_plays(engine: Engine, years: list[int]) -> int:
    """Play-by-play — the engine for situational/advanced queries (Phase 4).

    Pulls only the lean column subset the `plays` table needs (the full nflverse
    PBP is ~370 columns); upserts in chunks. This is the heavy dataset.
    """
    cols = [
        "play_id", "game_id", "posteam", "defteam", "qtr", "down", "ydstogo",
        "yardline_100", "play_type", "yards_gained", "epa", "wp", "success",
        "passer_player_id", "rusher_player_id", "receiver_player_id", "desc",
    ]
    pbp = nfl.import_pbp_data(years, columns=cols, downcast=True)
    valid_teams = _existing_ids(engine, "teams", "team_id")
    valid_games = _existing_ids(engine, "games", "game_id")

    success = pbp.get("success")
    df = pd.DataFrame(
        {
            # play_id is only unique within a game in nflverse; key by game+play.
            "play_id": pbp["game_id"].astype(str) + "_" + pbp["play_id"].astype("Int64").astype(str),
            "game_id": pbp["game_id"],
            "posteam": pbp["posteam"].where(pbp["posteam"].isin(valid_teams)),
            "defteam": pbp["defteam"].where(pbp["defteam"].isin(valid_teams)),
            "qtr": pbp.get("qtr"),
            "down": pbp.get("down"),
            "yards_to_go": pbp.get("ydstogo"),
            "yardline_100": pbp.get("yardline_100"),
            "play_type": pbp.get("play_type"),
            "yards_gained": pbp.get("yards_gained"),
            "epa": pbp.get("epa"),
            "wp": pbp.get("wp"),
            "success": success.map({1: True, 0: False}) if success is not None else None,
            "passer_player_id": pbp.get("passer_player_id"),
            "rusher_player_id": pbp.get("rusher_player_id"),
            "receiver_player_id": pbp.get("receiver_player_id"),
            "description": pbp.get("desc"),
        }
    )
    df = df[pbp["play_id"].notna().values & pbp["game_id"].isin(valid_games).values]
    df = df.drop_duplicates(subset=["play_id"], keep="last")
    _upsert(engine, "plays", df, conflict=["play_id"], chunk=2000)
    return len(df)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _schedule(years: list[int]) -> pd.DataFrame:
    sched = nfl.import_schedules(years)
    return sched[sched["game_type"].ne("PRE")].copy()


def _team_week_game_map(sched: pd.DataFrame) -> dict[tuple, tuple]:
    """(season, week, team) -> (game_id, is_home). Each team plays once per week."""
    out: dict[tuple, tuple] = {}
    for r in sched.itertuples(index=False):
        out[(r.season, r.week, r.home_team)] = (r.game_id, True)
        out[(r.season, r.week, r.away_team)] = (r.game_id, False)
    return out


def _sum_cols(df: pd.DataFrame, *cols: str) -> pd.Series:
    present = [df[c] for c in cols if c in df]
    if not present:
        return pd.Series([None] * len(df))
    total = present[0].fillna(0)
    for c in present[1:]:
        total = total + c.fillna(0)
    return total


def _parse_height(value) -> int | None:
    """nflverse height is usually inches ("73"); tolerate feet-inches ("6-2")."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    s = str(value).strip()
    if not s:
        return None
    if "-" in s:
        feet, _, inches = s.partition("-")
        try:
            return int(feet) * 12 + int(inches)
        except ValueError:
            return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _date(value):
    if value is None or pd.isna(value):
        return None
    return pd.Timestamp(value).date()


def _existing_ids(engine: Engine, table: str, col: str) -> set:
    with engine.connect() as conn:
        return {r[0] for r in conn.execute(text(f"SELECT {col} FROM {table}"))}


def _py(value):
    """Coerce numpy/pandas scalars to plain Python for the DB driver."""
    if value is None:
        return None
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return None if np.isnan(value) else float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _upsert(
    engine: Engine,
    table: str,
    df: pd.DataFrame,
    conflict: list[str],
    *,
    do_update: bool = True,
    chunk: int = 1000,
) -> None:
    """Idempotent batched upsert (executemany per chunk)."""
    if df.empty:
        return
    cols = list(df.columns)
    placeholders = ", ".join(f":{c}" for c in cols)
    if do_update:
        updates = ", ".join(f"{c}=EXCLUDED.{c}" for c in cols if c not in conflict)
        action = f"DO UPDATE SET {updates}" if updates else "DO NOTHING"
    else:
        action = "DO NOTHING"
    stmt = text(
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT ({', '.join(conflict)}) {action}"
    )
    records = [{k: _py(v) for k, v in rec.items()} for rec in df.to_dict("records")]
    with engine.begin() as conn:
        for i in tqdm(range(0, len(records), chunk), desc=table, unit="chunk"):
            conn.execute(stmt, records[i : i + chunk])
