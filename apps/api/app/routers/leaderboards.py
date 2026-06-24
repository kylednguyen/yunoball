"""GET /api/leaderboards — precomputed season leaderboards.

These are fixed, trusted queries (not LLM-generated) over a column allowlist, so
they run on the app engine directly. Powers the /leaderboards page and the
example chips.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from ..rag.store import read_engine

router = APIRouter(prefix="/api/leaderboards", tags=["leaderboards"])

# key -> (label, unit). Column name == key (allowlisted, safe to interpolate).
PLAYER_CATEGORIES: list[tuple[str, str, str]] = [
    ("passing_yards", "Passing Yards", "yds"),
    ("passing_tds", "Passing TDs", "TD"),
    ("rushing_yards", "Rushing Yards", "yds"),
    ("rushing_tds", "Rushing TDs", "TD"),
    ("receiving_yards", "Receiving Yards", "yds"),
    ("receptions", "Receptions", "rec"),
    ("receiving_tds", "Receiving TDs", "TD"),
    ("fantasy_points_ppr", "Fantasy Points (PPR)", "pts"),
]
_ALLOWED = {k for k, _, _ in PLAYER_CATEGORIES}


class LeaderRow(BaseModel):
    rank: int
    name: str
    team: str | None
    value: float


class Leaderboard(BaseModel):
    key: str
    label: str
    unit: str
    rows: list[LeaderRow]


class LeaderboardsResponse(BaseModel):
    season: int
    seasons: list[int]
    boards: list[Leaderboard]


def _available_seasons(conn) -> list[int]:
    return [r[0] for r in conn.execute(text("SELECT season FROM seasons ORDER BY season DESC"))]


def _player_board(conn, column: str, label: str, unit: str, season: int, limit: int) -> Leaderboard:
    rows = conn.execute(
        text(
            f"""
            SELECT p.full_name AS name, s.team_id AS team, s.{column} AS value
            FROM player_season_stats s JOIN players p USING (player_id)
            WHERE s.season = :season AND s.season_type = 'REG'
              AND s.{column} IS NOT NULL
            ORDER BY s.{column} DESC, p.full_name
            LIMIT :limit
            """
        ),
        {"season": season, "limit": limit},
    ).all()
    return Leaderboard(
        key=column,
        label=label,
        unit=unit,
        rows=[
            LeaderRow(rank=i + 1, name=r.name, team=r.team, value=float(r.value))
            for i, r in enumerate(rows)
        ],
    )


@router.get("", response_model=LeaderboardsResponse)
async def leaderboards(
    season: int | None = Query(default=None),
    category: str | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
) -> LeaderboardsResponse:
    with read_engine().connect() as conn:
        seasons = _available_seasons(conn)
        if not seasons:
            raise HTTPException(status_code=503, detail="No seasons loaded.")
        target = season or seasons[0]
        if season is not None and season not in seasons:
            raise HTTPException(status_code=404, detail=f"Season {season} not loaded.")

        selected = PLAYER_CATEGORIES
        if category:
            if category not in _ALLOWED:
                raise HTTPException(status_code=400, detail=f"Unknown category: {category}")
            selected = [c for c in PLAYER_CATEGORIES if c[0] == category]

        boards = [
            _player_board(conn, col, label, unit, target, limit)
            for col, label, unit in selected
        ]

    return LeaderboardsResponse(season=target, seasons=seasons, boards=boards)
