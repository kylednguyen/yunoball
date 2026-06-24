"""Intent classification + safe SQL templates.

A safer alternative to free-form NL->SQL: the LLM classifies a question into a
known intent + slots (JSON), and the backend emits a parameterized query from a
vetted template over an allowlisted set of stat columns and resolved entity ids.
When the question doesn't fit a template, the pipeline falls back to free-form
generation. Values are validated/escaped here and the result still passes through
`guard_sql` for defense-in-depth.
"""

from __future__ import annotations

from sqlalchemy import text

from .. import llm
from ..config import settings
from ..rag.store import read_engine
from ..schemas import ResolvedEntity

INTENTS = {
    "player_season_total", "player_game_stat", "league_leader", "team_season_total",
    "player_comparison", "single_game_leader", "threshold_games", "average_stat",
    "defensive_leader",
}

# stat phrase -> column (player_game_stats / player_season_stats share names)
STAT_COLUMNS = {
    "passing_yards": "passing_yards", "passing_tds": "passing_tds",
    "interceptions": "interceptions", "completions": "completions", "attempts": "attempts",
    "rushing_yards": "rushing_yards", "rushing_tds": "rushing_tds", "carries": "carries",
    "receiving_yards": "receiving_yards", "receiving_tds": "receiving_tds",
    "receptions": "receptions", "targets": "targets",
    "fantasy_points": "fantasy_points_ppr", "fantasy_points_ppr": "fantasy_points_ppr",
    "tackles": "tackles", "def_sacks": "def_sacks", "def_interceptions": "def_interceptions",
    "sacks": "def_sacks",  # "sacks" as a leaderboard stat = defensive sacks
}
# In a defensive context, bare "sacks"/"interceptions" mean the defensive columns.
DEF_STAT_COLUMNS = {**STAT_COLUMNS, "sacks": "def_sacks", "interceptions": "def_interceptions"}

# team-level columns we actually store in team_game_stats
TEAM_STAT_COLUMNS = {
    "passing_yards": "passing_yards", "rushing_yards": "rushing_yards",
    "points": "points_for", "points_for": "points_for", "turnovers": "turnovers",
}

SYSTEM = """You classify an NFL stats question into a JSON object. Output ONLY the JSON object.

Fields:
- intent: one of player_season_total, player_game_stat, league_leader, team_season_total, player_comparison, single_game_leader, threshold_games, average_stat, defensive_leader
- stat_type: one of passing_yards, passing_tds, interceptions, completions, attempts, rushing_yards, rushing_tds, carries, receiving_yards, receiving_tds, receptions, targets, fantasy_points, tackles, sacks
- season: a 4-digit year, or null
- week: an integer, or null
- team: a team abbreviation (e.g. KC, NE), or null
- limit: integer for top-N requests, or null
- threshold: number for "X+ yards" questions, or null

Rules:
- "most / led / top / leaders / who had the most" over a season -> league_leader (defensive_leader for sacks or tackles).
- "in week N" -> player_game_stat.
- "300+ passing yards", "100+ receiving yards" -> threshold_games (set threshold).
- "per game" or "average" -> average_stat.
- "compare A and B" -> player_comparison.
- "most ... in a single game" / "best game" -> single_game_leader.
- "how many X did PLAYER have [in YEAR]" -> player_season_total.
- team passing/rushing yards or team points -> team_season_total.

Example: {"intent":"player_season_total","stat_type":"passing_yards","season":2023,"week":null,"team":null,"limit":null,"threshold":null}"""


async def classify_intent(question: str) -> dict | None:
    data = await llm.complete_json(
        model=settings.sql_model, system=SYSTEM, user=question, max_tokens=200
    )
    if not data or data.get("intent") not in INTENTS:
        return None
    return data


# --------------------------------------------------------------------------- #
# SQL building (values validated/escaped here; templates are fixed)
# --------------------------------------------------------------------------- #


def _q(value) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


_LATEST: int | None = None


def latest_season() -> int:
    global _LATEST
    if _LATEST is None:
        try:
            with read_engine().connect() as conn:
                _LATEST = conn.execute(text("SELECT MAX(season) FROM seasons")).scalar() or 2024
        except Exception:
            _LATEST = 2024
    return _LATEST


def _players(entities: list[ResolvedEntity]) -> list[ResolvedEntity]:
    return [e for e in entities if e.entity_type == "player"]


def _player_pred(entities: list[ResolvedEntity], plan: dict) -> str | None:
    ps = _players(entities)
    if ps:
        return "p.player_id IN (" + ",".join(_q(e.canonical_id) for e in ps) + ")"
    name = plan.get("player_name") or plan.get("player")
    if name:
        return f"p.full_name ILIKE {_q(name)}"
    return None


def build_sql(plan: dict, entities: list[ResolvedEntity]) -> str | None:
    """Return safe SQL for a classified plan, or None to fall back to free-form."""
    intent = plan.get("intent")
    if intent not in INTENTS:
        return None
    raw = (plan.get("stat_type") or "").lower().strip()
    stat_map = DEF_STAT_COLUMNS if intent == "defensive_leader" else STAT_COLUMNS
    col = stat_map.get(raw)
    season = _int(plan.get("season"))
    week = _int(plan.get("week"))
    limit = min(_int(plan.get("limit")) or 10, 100)
    threshold = _int(plan.get("threshold"))

    if intent == "player_season_total":
        pred = _player_pred(entities, plan)
        if not col or not pred:
            return None
        if season:
            return (
                f"SELECT p.full_name, s.{col} FROM player_season_stats s "
                f"JOIN players p USING (player_id) WHERE {pred} AND s.season={season} "
                f"AND s.season_type='REG'"
            )
        return (
            f"SELECT p.full_name, SUM(s.{col}) AS {col} FROM player_season_stats s "
            f"JOIN players p USING (player_id) WHERE {pred} AND s.season_type='REG' "
            f"GROUP BY p.full_name ORDER BY {col} DESC"
        )

    if intent == "player_game_stat":
        pred = _player_pred(entities, plan)
        if not pred:
            return None
        select = f"pgs.{col}" if col else "pgs.passing_yards, pgs.rushing_yards, pgs.receiving_yards"
        where = [pred]
        if season:
            where.append(f"g.season={season}")
        if week:
            where.append(f"g.week={week}")
        return (
            f"SELECT p.full_name, g.season, g.week, {select} FROM player_game_stats pgs "
            f"JOIN players p USING (player_id) JOIN games g USING (game_id) "
            f"WHERE {' AND '.join(where)} ORDER BY g.season, g.week"
        )

    if intent in ("league_leader", "defensive_leader"):
        if not col:
            return None
        s = season or latest_season()
        return (
            f"SELECT p.full_name, s.team_id, s.{col} FROM player_season_stats s "
            f"JOIN players p USING (player_id) WHERE s.season={s} AND s.season_type='REG' "
            f"AND s.{col} IS NOT NULL ORDER BY s.{col} DESC, p.full_name LIMIT {limit}"
        )

    if intent == "team_season_total":
        tcol = TEAM_STAT_COLUMNS.get(raw)
        if not tcol:
            return None
        teams = [e for e in entities if e.entity_type == "team"]
        team = teams[0].canonical_id if teams else plan.get("team")
        s = season or latest_season()
        if team:
            return (
                f"SELECT t.team_id, SUM(t.{tcol}) AS {tcol} FROM team_game_stats t "
                f"JOIN games g USING (game_id) WHERE t.team_id={_q(team)} AND g.season={s} "
                f"AND g.season_type='REG' GROUP BY t.team_id"
            )
        return (
            f"SELECT t.team_id, SUM(t.{tcol}) AS {tcol} FROM team_game_stats t "
            f"JOIN games g USING (game_id) WHERE g.season={s} AND g.season_type='REG' "
            f"GROUP BY t.team_id ORDER BY {tcol} DESC LIMIT {limit}"
        )

    if intent == "player_comparison":
        ps = _players(entities)
        if not col or len(ps) < 2:
            return None
        ids = ",".join(_q(e.canonical_id) for e in ps)
        season_pred = f"AND s.season={season} " if season else ""
        return (
            f"SELECT p.full_name, SUM(s.{col}) AS {col} FROM player_season_stats s "
            f"JOIN players p USING (player_id) WHERE p.player_id IN ({ids}) {season_pred}"
            f"AND s.season_type='REG' GROUP BY p.full_name ORDER BY {col} DESC"
        )

    if intent == "single_game_leader":
        if not col:
            return None
        where = ["TRUE"]
        if season:
            where.append(f"g.season={season}")
        n = min(limit, 25) if plan.get("limit") else 1
        return (
            f"SELECT p.full_name, g.season, g.week, pgs.{col} FROM player_game_stats pgs "
            f"JOIN players p USING (player_id) JOIN games g USING (game_id) "
            f"WHERE {' AND '.join(where)} AND pgs.{col} IS NOT NULL "
            f"ORDER BY pgs.{col} DESC, p.full_name LIMIT {n}"
        )

    if intent == "threshold_games":
        pred = _player_pred(entities, plan)
        if not col or threshold is None:
            return None
        where = [f"pgs.{col} >= {threshold}"]
        if pred:
            where.append(pred)
        if season:
            where.append(f"g.season={season}")
        return (
            f"SELECT p.full_name, g.season, g.week, pgs.{col} FROM player_game_stats pgs "
            f"JOIN players p USING (player_id) JOIN games g USING (game_id) "
            f"WHERE {' AND '.join(where)} ORDER BY pgs.{col} DESC LIMIT 100"
        )

    if intent == "average_stat":
        if not col:
            return None
        pred = _player_pred(entities, plan)
        if pred:
            where = [pred]
            if season:
                where.append(f"g.season={season}")
            return (
                f"SELECT p.full_name, ROUND(AVG(pgs.{col})::numeric, 1) AS avg_{col} "
                f"FROM player_game_stats pgs JOIN players p USING (player_id) "
                f"JOIN games g USING (game_id) WHERE {' AND '.join(where)} GROUP BY p.full_name"
            )
        s = season or latest_season()
        return (
            f"SELECT p.full_name, ROUND(AVG(pgs.{col})::numeric, 1) AS avg_{col} "
            f"FROM player_game_stats pgs JOIN players p USING (player_id) "
            f"JOIN games g USING (game_id) WHERE g.season={s} GROUP BY p.full_name "
            f"HAVING COUNT(*) >= 8 ORDER BY avg_{col} DESC LIMIT {limit}"
        )

    return None
