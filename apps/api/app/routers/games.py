"""GET /api/games — scores & results by season/week.

Fixed, trusted queries over the games dimension (no LLM involved), same
pattern as the leaderboards router. Powers the /scores page.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from ..database import get_readonly_engine as read_engine
from ..espn import headshot_url

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


# ------------------------- Performers of the week ------------------------- #


class Performer(BaseModel):
    rank: int
    player_id: str
    name: str
    position: str | None
    team: str | None
    opponent: str | None
    headshot_url: str | None
    fantasy_points_ppr: float
    stat_line: str  # human-readable box score, e.g. "28/34, 331 yds, 3 TD"


class PerformersResponse(BaseModel):
    season: int
    seasons: list[int]
    week: int
    weeks: list[int]
    performers: list[Performer]


def _stat_line(r) -> str:
    """Position-agnostic box score built from whatever the player did."""
    parts: list[str] = []
    if r.passing_yards or r.passing_tds:
        seg = f"{r.passing_yards} pass yds"
        if r.passing_tds:
            seg += f", {r.passing_tds} pass TD"
        if r.interceptions:
            seg += f", {r.interceptions} INT"
        parts.append(seg)
    if r.rushing_yards or r.rushing_tds:
        seg = f"{r.rushing_yards} rush yds"
        if r.rushing_tds:
            seg += f", {r.rushing_tds} rush TD"
        parts.append(seg)
    if r.receptions or r.receiving_yards or r.receiving_tds:
        seg = f"{r.receptions} rec, {r.receiving_yards} yds"
        if r.receiving_tds:
            seg += f", {r.receiving_tds} rec TD"
        parts.append(seg)
    return " · ".join(parts) or "no production"


@router.get("/performers", response_model=PerformersResponse)
async def performers(
    season: int | None = Query(default=None),
    week: int | None = Query(default=None, ge=1, le=22),
    limit: int = Query(default=10, ge=1, le=25),
) -> PerformersResponse:
    """Top fantasy (PPR) performances for a week, with the full stat line."""
    with read_engine().connect() as conn:
        seasons = [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT DISTINCT g.season FROM player_game_stats s"
                    " JOIN games g ON g.game_id = s.game_id ORDER BY g.season DESC"
                )
            )
        ]
        if not seasons:
            raise HTTPException(status_code=503, detail="No per-game stats loaded.")
        target_season = season or seasons[0]
        if target_season not in seasons:
            raise HTTPException(status_code=404, detail=f"Season {target_season} not loaded.")

        weeks = [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT DISTINCT g.week FROM player_game_stats s"
                    " JOIN games g ON g.game_id = s.game_id"
                    " WHERE g.season = :s ORDER BY g.week"
                ),
                {"s": target_season},
            )
        ]
        if not weeks:
            raise HTTPException(status_code=404, detail=f"No weeks loaded for {target_season}.")
        target_week = week if week is not None else weeks[-1]
        if target_week not in weeks:
            raise HTTPException(
                status_code=404, detail=f"Week {target_week} not loaded for {target_season}."
            )

        rows = conn.execute(
            text(
                """
                SELECT s.player_id, p.full_name AS name, p.position, s.team_id,
                       CASE WHEN s.team_id = g.home_team THEN g.away_team
                            ELSE g.home_team END AS opponent,
                       COALESCE(s.passing_yards, 0) AS passing_yards,
                       COALESCE(s.passing_tds, 0) AS passing_tds,
                       COALESCE(s.interceptions, 0) AS interceptions,
                       COALESCE(s.rushing_yards, 0) AS rushing_yards,
                       COALESCE(s.rushing_tds, 0) AS rushing_tds,
                       COALESCE(s.receptions, 0) AS receptions,
                       COALESCE(s.receiving_yards, 0) AS receiving_yards,
                       COALESCE(s.receiving_tds, 0) AS receiving_tds,
                       COALESCE(s.fantasy_points_ppr, 0) AS fantasy_points_ppr
                FROM player_game_stats s
                JOIN games g ON g.game_id = s.game_id
                JOIN players p ON p.player_id = s.player_id
                WHERE g.season = :s AND g.week = :w
                ORDER BY s.fantasy_points_ppr DESC, p.full_name
                LIMIT :limit
                """
            ),
            {"s": target_season, "w": target_week, "limit": limit},
        ).all()

    return PerformersResponse(
        season=target_season,
        seasons=seasons,
        week=target_week,
        weeks=weeks,
        performers=[
            Performer(
                rank=i + 1,
                player_id=r.player_id,
                name=r.name,
                position=r.position,
                team=r.team_id,
                opponent=r.opponent,
                headshot_url=headshot_url(r.player_id),
                fantasy_points_ppr=round(float(r.fantasy_points_ppr), 1),
                stat_line=_stat_line(r),
            )
            for i, r in enumerate(rows)
        ],
    )
