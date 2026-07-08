"""GET /api/standings — league standings computed from game results.

W-L-T, points for/against and streak are derived on the fly from the games
table (never stored), so standings always agree with the scores page.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from ..database import get_readonly_engine as read_engine

router = APIRouter(prefix="/api/standings", tags=["standings"])

CONFERENCE_ORDER = ["AFC", "NFC"]


class StandingRow(BaseModel):
    team_id: str
    name: str
    nickname: str | None
    wins: int
    losses: int
    ties: int
    pct: float
    points_for: int
    points_against: int
    point_diff: int
    streak: str  # e.g. "W3" / "L2"


class DivisionStandings(BaseModel):
    division: str
    teams: list[StandingRow]


class ConferenceStandings(BaseModel):
    conference: str
    divisions: list[DivisionStandings]


class StandingsResponse(BaseModel):
    season: int
    seasons: list[int]
    conferences: list[ConferenceStandings]


def _available_seasons(conn) -> list[int]:
    return [
        r[0]
        for r in conn.execute(
            text("SELECT DISTINCT season FROM games ORDER BY season DESC")
        )
    ]


@router.get("", response_model=StandingsResponse)
async def standings(season: int | None = Query(default=None)) -> StandingsResponse:
    with read_engine().connect() as conn:
        seasons = _available_seasons(conn)
        if not seasons:
            raise HTTPException(status_code=503, detail="No games loaded.")
        target = season or seasons[0]
        if target not in seasons:
            raise HTTPException(status_code=404, detail=f"Season {target} not loaded.")

        teams = conn.execute(
            text("SELECT team_id, name, nickname, conference, division FROM teams")
        ).all()

        games = conn.execute(
            text(
                """
                SELECT week, home_team, away_team, home_score, away_score
                FROM games
                WHERE season = :s AND season_type = 'REG'
                  AND home_score IS NOT NULL AND away_score IS NOT NULL
                ORDER BY week
                """
            ),
            {"s": target},
        ).all()

    record: dict[str, dict] = {
        t.team_id: {"w": 0, "l": 0, "t": 0, "pf": 0, "pa": 0, "results": []} for t in teams
    }

    for g in games:
        for team, ours, theirs in (
            (g.home_team, g.home_score, g.away_score),
            (g.away_team, g.away_score, g.home_score),
        ):
            rec = record.get(team)
            if rec is None:
                continue
            rec["pf"] += ours
            rec["pa"] += theirs
            if ours > theirs:
                rec["w"] += 1
                rec["results"].append("W")
            elif ours < theirs:
                rec["l"] += 1
                rec["results"].append("L")
            else:
                rec["t"] += 1
                rec["results"].append("T")

    def _streak(results: list[str]) -> str:
        if not results:
            return "—"
        last = results[-1]
        n = 0
        for r in reversed(results):
            if r != last:
                break
            n += 1
        return f"{last}{n}"

    def _row(t) -> StandingRow:
        rec = record[t.team_id]
        played = rec["w"] + rec["l"] + rec["t"]
        pct = (rec["w"] + rec["t"] * 0.5) / played if played else 0.0
        return StandingRow(
            team_id=t.team_id,
            name=t.name,
            nickname=t.nickname,
            wins=rec["w"],
            losses=rec["l"],
            ties=rec["t"],
            pct=round(pct, 3),
            points_for=rec["pf"],
            points_against=rec["pa"],
            point_diff=rec["pf"] - rec["pa"],
            streak=_streak(rec["results"]),
        )

    by_division: dict[str, list] = {}
    for t in teams:
        by_division.setdefault(t.division or "Unassigned", []).append(t)

    conferences: list[ConferenceStandings] = []
    for conf in CONFERENCE_ORDER:
        divisions = [
            DivisionStandings(
                division=div,
                teams=sorted(
                    (_row(t) for t in members),
                    key=lambda r: (-r.pct, -r.point_diff, r.name),
                ),
            )
            for div, members in sorted(by_division.items())
            if div.startswith(conf)
        ]
        if divisions:
            conferences.append(ConferenceStandings(conference=conf, divisions=divisions))

    return StandingsResponse(season=target, seasons=seasons, conferences=conferences)
