"""GET /api/standings — season standings per team.

A fixed, trusted aggregate over team_game_stats (not LLM-generated), same as
leaderboards. Powers the /standings page and the landing-page snapshot.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from ..database import get_readonly_engine as read_engine

router = APIRouter(prefix="/api/standings", tags=["standings"])

_SQL = text(
    """
    SELECT tm.team_id AS team_id, tm.name AS team,
           tm.conference AS conference, tm.division AS division,
           SUM(CASE WHEN s.result = 'W' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN s.result = 'L' THEN 1 ELSE 0 END) AS losses,
           SUM(CASE WHEN s.result = 'T' THEN 1 ELSE 0 END) AS ties,
           SUM(s.points_for) AS points_for,
           SUM(s.points_against) AS points_against
    FROM team_game_stats s
    JOIN teams tm ON tm.team_id = s.team_id
    JOIN games g ON g.game_id = s.game_id
    WHERE g.season = :season AND g.season_type = 'REG'
    GROUP BY tm.team_id, tm.name, tm.conference, tm.division
    ORDER BY wins DESC, (SUM(s.points_for) - SUM(s.points_against)) DESC, tm.name
    """
)


class StandingRow(BaseModel):
    rank: int
    team_id: str
    team: str
    conference: str | None
    division: str | None
    wins: int
    losses: int
    ties: int
    points_for: int
    points_against: int
    diff: int
    pct: float  # win percentage, ties count half


class StandingsResponse(BaseModel):
    season: int
    seasons: list[int]
    rows: list[StandingRow]


def _available_seasons(conn) -> list[int]:
    return [r[0] for r in conn.execute(text("SELECT season FROM seasons ORDER BY season DESC"))]


@router.get("", response_model=StandingsResponse)
async def standings(season: int | None = Query(default=None)) -> StandingsResponse:
    with read_engine().connect() as conn:
        seasons = _available_seasons(conn)
        if not seasons:
            raise HTTPException(status_code=503, detail="No seasons loaded.")
        target = season or seasons[0]
        if season is not None and season not in seasons:
            raise HTTPException(status_code=404, detail=f"Season {season} not loaded.")

        rows = conn.execute(_SQL, {"season": target}).all()

    out: list[StandingRow] = []
    for i, r in enumerate(rows):
        m = r._mapping
        w, l, t = int(m["wins"] or 0), int(m["losses"] or 0), int(m["ties"] or 0)
        games = w + l + t
        out.append(
            StandingRow(
                rank=i + 1,
                team_id=m["team_id"],
                team=m["team"],
                conference=m["conference"],
                division=m["division"],
                wins=w,
                losses=l,
                ties=t,
                points_for=int(m["points_for"] or 0),
                points_against=int(m["points_against"] or 0),
                diff=int(m["points_for"] or 0) - int(m["points_against"] or 0),
                pct=round((w + 0.5 * t) / games, 3) if games else 0.0,
            )
        )
    return StandingsResponse(season=target, seasons=seasons, rows=out)
