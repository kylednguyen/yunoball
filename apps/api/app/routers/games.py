"""GET /api/games — scores & results by season/week.

Fixed, trusted queries over the games dimension (no LLM involved), same
pattern as the leaderboards router. Powers the /scores page.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from ..database import get_readonly_engine as read_engine

router = APIRouter(prefix="/api/games", tags=["games"])


class GameTeam(BaseModel):
    team_id: str
    name: str
    nickname: str | None
    score: int | None


class GameRow(BaseModel):
    game_id: str
    season: int
    week: int
    date: str | None
    home: GameTeam
    away: GameTeam
    final: bool


class GamesResponse(BaseModel):
    season: int
    seasons: list[int]
    week: int
    weeks: list[int]
    games: list[GameRow]


def _available_seasons(conn) -> list[int]:
    return [
        r[0]
        for r in conn.execute(
            text("SELECT DISTINCT season FROM games ORDER BY season DESC")
        )
    ]


@router.get("", response_model=GamesResponse)
async def games(
    season: int | None = Query(default=None),
    week: int | None = Query(default=None, ge=1, le=22),
) -> GamesResponse:
    with read_engine().connect() as conn:
        seasons = _available_seasons(conn)
        if not seasons:
            raise HTTPException(status_code=503, detail="No games loaded.")
        target_season = season or seasons[0]
        if target_season not in seasons:
            raise HTTPException(status_code=404, detail=f"Season {target_season} not loaded.")

        weeks = [
            r[0]
            for r in conn.execute(
                text("SELECT DISTINCT week FROM games WHERE season = :s ORDER BY week"),
                {"s": target_season},
            )
        ]
        target_week = week if week is not None else weeks[-1]
        if target_week not in weeks:
            raise HTTPException(
                status_code=404, detail=f"Week {target_week} not loaded for {target_season}."
            )

        rows = conn.execute(
            text(
                """
                SELECT g.game_id, g.season, g.week, g.game_date,
                       g.home_team, ht.name AS home_name, ht.nickname AS home_nick, g.home_score,
                       g.away_team, aw.name AS away_name, aw.nickname AS away_nick, g.away_score
                FROM games g
                JOIN teams ht ON ht.team_id = g.home_team
                JOIN teams aw ON aw.team_id = g.away_team
                WHERE g.season = :s AND g.week = :w
                ORDER BY g.game_date, g.game_id
                """
            ),
            {"s": target_season, "w": target_week},
        ).all()

    return GamesResponse(
        season=target_season,
        seasons=seasons,
        week=target_week,
        weeks=weeks,
        games=[
            GameRow(
                game_id=r.game_id,
                season=r.season,
                week=r.week,
                date=str(r.game_date) if r.game_date is not None else None,
                home=GameTeam(
                    team_id=r.home_team, name=r.home_name, nickname=r.home_nick, score=r.home_score
                ),
                away=GameTeam(
                    team_id=r.away_team, name=r.away_name, nickname=r.away_nick, score=r.away_score
                ),
                final=r.home_score is not None and r.away_score is not None,
            )
            for r in rows
        ],
    )
