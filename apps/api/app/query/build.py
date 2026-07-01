"""Deterministic SQL builder + narration for a QuerySpec.

Because the SQL is generated here (not by the model), it is inherently safe:
the stat column comes from a validated allowlist and all user-derived values
(season, player, limit) are bound parameters. No SQL guard is required on this
path.
"""

from __future__ import annotations

from typing import Any

from .spec import Intent, QuerySpec


def build_sql(spec: QuerySpec) -> tuple[str, dict[str, Any]]:
    col = spec.column()  # allowlisted; safe to interpolate
    params: dict[str, Any] = {}

    if spec.intent is Intent.LEADERS:
        where = ["s.season_type = :stype"]
        params["stype"] = spec.season_type
        if spec.season is not None:
            where.append("s.season = :season")
            params["season"] = spec.season
        params["limit"] = spec.limit
        sql = (
            f"SELECT p.full_name, s.season, s.{col} AS value "
            "FROM player_season_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            f"WHERE {' AND '.join(where)} "
            f"ORDER BY s.{col} DESC LIMIT :limit"
        )
        return sql, params

    if spec.intent is Intent.PLAYER_TOTAL:
        params["player"] = f"%{(spec.player or '').lower()}%"
        if spec.scope == "career":
            sql = (
                f"SELECT p.full_name, SUM(s.{col}) AS total "
                "FROM player_season_stats s "
                "JOIN players p ON p.player_id = s.player_id "
                "WHERE lower(p.full_name) LIKE :player "
                "AND s.season_type = :stype "
                "GROUP BY p.full_name"
            )
            params["stype"] = spec.season_type
            return sql, params
        where = ["lower(p.full_name) LIKE :player", "s.season_type = :stype"]
        params["stype"] = spec.season_type
        if spec.season is not None:
            where.append("s.season = :season")
            params["season"] = spec.season
        sql = (
            f"SELECT p.full_name, s.season, s.{col} AS value "
            "FROM player_season_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY s.season"
        )
        return sql, params

    if spec.intent is Intent.SINGLE_GAME:
        params["limit"] = spec.limit
        sql = (
            f"SELECT p.full_name, g.game_id, s.{col} AS value "
            "FROM player_game_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            "JOIN games g ON g.game_id = s.game_id "
            f"WHERE s.{col} > 0 "
            f"ORDER BY s.{col} DESC LIMIT :limit"
        )
        return sql, params

    raise ValueError(f"unhandled intent: {spec.intent}")


def narrate(spec: QuerySpec, rows: list[dict[str, Any]]) -> str:
    """Templated headline — no LLM call. Falls back gracefully on empty."""
    if not rows:
        return "No matching results found."
    top = rows[0]
    label = spec.label()
    name = top.get("full_name", "")

    if spec.intent is Intent.PLAYER_TOTAL and spec.scope == "career":
        return f"{name} has {top.get('total')} career {label}."
    if spec.intent is Intent.SINGLE_GAME:
        return (
            f"{name} has the top single-game mark with {top.get('value')} "
            f"{label} ({top.get('game_id')})."
        )
    season = top.get("season")
    where = f" in {season}" if season else ""
    return f"{name} leads with {top.get('value')} {label}{where}."
