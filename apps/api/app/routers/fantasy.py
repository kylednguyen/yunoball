"""GET /api/fantasy/players — the player pool for the fantasy lineup builder.

Season totals + PPR fantasy points straight from the warehouse rollups.
Lineups themselves live client-side; this endpoint just serves the pool.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from ..database import get_readonly_engine as read_engine

router = APIRouter(prefix="/api/fantasy", tags=["fantasy"])

POSITIONS = {"QB", "RB", "WR", "TE"}


class FantasyPlayer(BaseModel):
    player_id: str
    name: str
    team: str | None
    position: str | None
    games_played: int
    passing_yards: int
    passing_tds: int
    interceptions: int
    rushing_yards: int
    rushing_tds: int
    receptions: int
    receiving_yards: int
    receiving_tds: int
    fantasy_points_ppr: float
    points_per_game: float


class FantasyPlayersResponse(BaseModel):
    season: int
    seasons: list[int]
    players: list[FantasyPlayer]


def _available_seasons(conn) -> list[int]:
    return [
        r[0]
        for r in conn.execute(
            text(
                "SELECT DISTINCT season FROM player_season_stats"
                " WHERE season_type = 'REG' ORDER BY season DESC"
            )
        )
    ]


@router.get("/players", response_model=FantasyPlayersResponse)
async def fantasy_players(
    season: int | None = Query(default=None),
    position: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=60),
    limit: int = Query(default=200, ge=1, le=500),
) -> FantasyPlayersResponse:
    if position is not None:
        position = position.upper()
        if position not in POSITIONS:
            raise HTTPException(status_code=400, detail=f"Unknown position: {position}")

    with read_engine().connect() as conn:
        seasons = _available_seasons(conn)
        if not seasons:
            raise HTTPException(status_code=503, detail="No player stats loaded.")
        target = season or seasons[0]
        if target not in seasons:
            raise HTTPException(status_code=404, detail=f"Season {target} not loaded.")

        clauses = ["s.season = :season", "s.season_type = 'REG'"]
        params: dict = {"season": target, "limit": limit}
        if position:
            clauses.append("p.position = :position")
            params["position"] = position
        if q:
            clauses.append("LOWER(p.full_name) LIKE :q")
            params["q"] = f"%{q.lower()}%"

        rows = conn.execute(
            text(
                f"""
                SELECT p.player_id, p.full_name AS name, s.team_id AS team, p.position,
                       COALESCE(s.games_played, 0) AS gp,
                       COALESCE(s.passing_yards, 0) AS pass_yds,
                       COALESCE(s.passing_tds, 0) AS pass_tds,
                       COALESCE(s.interceptions, 0) AS ints,
                       COALESCE(s.rushing_yards, 0) AS rush_yds,
                       COALESCE(s.rushing_tds, 0) AS rush_tds,
                       COALESCE(s.receptions, 0) AS rec,
                       COALESCE(s.receiving_yards, 0) AS rec_yds,
                       COALESCE(s.receiving_tds, 0) AS rec_tds,
                       COALESCE(s.fantasy_points_ppr, 0) AS fp
                FROM player_season_stats s JOIN players p USING (player_id)
                WHERE {' AND '.join(clauses)}
                ORDER BY fp DESC, p.full_name
                LIMIT :limit
                """
            ),
            params,
        ).all()

    return FantasyPlayersResponse(
        season=target,
        seasons=seasons,
        players=[
            FantasyPlayer(
                player_id=r.player_id,
                name=r.name,
                team=r.team,
                position=r.position,
                games_played=r.gp,
                passing_yards=r.pass_yds,
                passing_tds=r.pass_tds,
                interceptions=r.ints,
                rushing_yards=r.rush_yds,
                rushing_tds=r.rush_tds,
                receptions=r.rec,
                receiving_yards=r.rec_yds,
                receiving_tds=r.rec_tds,
                fantasy_points_ppr=round(float(r.fp), 1),
                points_per_game=round(float(r.fp) / r.gp, 1) if r.gp else 0.0,
            )
            for r in rows
        ],
    )
