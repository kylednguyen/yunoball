"""GET /api/players/{player_id} — a player's profile page in one call.

Identity, career totals, season-by-season splits and the game log (where
per-game rows exist), all from the warehouse rollups. Trusted SQL only.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from ..database import get_readonly_engine as read_engine

router = APIRouter(prefix="/api/players", tags=["players"])


class SeasonLine(BaseModel):
    season: int
    team: str | None
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


class CareerTotals(BaseModel):
    seasons: int
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


class GameLogRow(BaseModel):
    game_id: str
    season: int
    week: int
    date: str | None
    opponent: str
    home: bool
    team_score: int | None
    opp_score: int | None
    result: str  # "W" | "L" | "T" | "—"
    passing_yards: int
    passing_tds: int
    rushing_yards: int
    rushing_tds: int
    receptions: int
    receiving_yards: int
    receiving_tds: int


class PlayerProfile(BaseModel):
    player_id: str
    name: str
    position: str | None
    team: str | None
    team_name: str | None
    career: CareerTotals
    seasons: list[SeasonLine]
    game_log: list[GameLogRow]


@router.get("/{player_id}", response_model=PlayerProfile)
async def player_profile(player_id: str) -> PlayerProfile:
    with read_engine().connect() as conn:
        p = conn.execute(
            text(
                """
                SELECT p.player_id, p.full_name, p.position, p.team_id, t.name AS team_name
                FROM players p LEFT JOIN teams t ON t.team_id = p.team_id
                WHERE p.player_id = :pid
                """
            ),
            {"pid": player_id},
        ).first()
        if p is None:
            raise HTTPException(status_code=404, detail="Player not found.")

        season_rows = conn.execute(
            text(
                """
                SELECT season, team_id,
                       COALESCE(games_played, 0) AS gp,
                       COALESCE(passing_yards, 0) AS pass_yds,
                       COALESCE(passing_tds, 0) AS pass_tds,
                       COALESCE(interceptions, 0) AS ints,
                       COALESCE(rushing_yards, 0) AS rush_yds,
                       COALESCE(rushing_tds, 0) AS rush_tds,
                       COALESCE(receptions, 0) AS rec,
                       COALESCE(receiving_yards, 0) AS rec_yds,
                       COALESCE(receiving_tds, 0) AS rec_tds,
                       COALESCE(fantasy_points_ppr, 0) AS fp
                FROM player_season_stats
                WHERE player_id = :pid AND season_type = 'REG'
                ORDER BY season DESC
                """
            ),
            {"pid": player_id},
        ).all()

        log_rows = conn.execute(
            text(
                """
                SELECT s.game_id, g.season, g.week, g.game_date,
                       s.team_id, g.home_team, g.away_team, g.home_score, g.away_score,
                       COALESCE(s.passing_yards, 0) AS pass_yds,
                       COALESCE(s.passing_tds, 0) AS pass_tds,
                       COALESCE(s.rushing_yards, 0) AS rush_yds,
                       COALESCE(s.rushing_tds, 0) AS rush_tds,
                       COALESCE(s.receptions, 0) AS rec,
                       COALESCE(s.receiving_yards, 0) AS rec_yds,
                       COALESCE(s.receiving_tds, 0) AS rec_tds
                FROM player_game_stats s JOIN games g ON g.game_id = s.game_id
                WHERE s.player_id = :pid
                ORDER BY g.season DESC, g.week DESC
                """
            ),
            {"pid": player_id},
        ).all()

    seasons = [
        SeasonLine(
            season=r.season,
            team=r.team_id,
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
        for r in season_rows
    ]

    career = CareerTotals(
        seasons=len(seasons),
        games_played=sum(s.games_played for s in seasons),
        passing_yards=sum(s.passing_yards for s in seasons),
        passing_tds=sum(s.passing_tds for s in seasons),
        interceptions=sum(s.interceptions for s in seasons),
        rushing_yards=sum(s.rushing_yards for s in seasons),
        rushing_tds=sum(s.rushing_tds for s in seasons),
        receptions=sum(s.receptions for s in seasons),
        receiving_yards=sum(s.receiving_yards for s in seasons),
        receiving_tds=sum(s.receiving_tds for s in seasons),
        fantasy_points_ppr=round(sum(s.fantasy_points_ppr for s in seasons), 1),
    )

    game_log = []
    for r in log_rows:
        is_home = r.team_id == r.home_team
        team_score = r.home_score if is_home else r.away_score
        opp_score = r.away_score if is_home else r.home_score
        if team_score is None or opp_score is None:
            result = "—"
        elif team_score > opp_score:
            result = "W"
        elif team_score < opp_score:
            result = "L"
        else:
            result = "T"
        game_log.append(
            GameLogRow(
                game_id=r.game_id,
                season=r.season,
                week=r.week,
                date=str(r.game_date) if r.game_date is not None else None,
                opponent=r.away_team if is_home else r.home_team,
                home=is_home,
                team_score=team_score,
                opp_score=opp_score,
                result=result,
                passing_yards=r.pass_yds,
                passing_tds=r.pass_tds,
                rushing_yards=r.rush_yds,
                rushing_tds=r.rush_tds,
                receptions=r.rec,
                receiving_yards=r.rec_yds,
                receiving_tds=r.rec_tds,
            )
        )

    return PlayerProfile(
        player_id=p.player_id,
        name=p.full_name,
        position=p.position,
        team=p.team_id,
        team_name=p.team_name,
        career=career,
        seasons=seasons,
        game_log=game_log,
    )
