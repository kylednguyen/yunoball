"""Deterministic SQL builder + narration for a QuerySpec.

Because the SQL is generated here (not by the model), it is inherently safe:
the value expression comes from a validated stat allowlist (`spec.value_expr`)
and all user-derived values (season, player, limit) are bound parameters. No
SQL guard is required on this path.
"""

from __future__ import annotations

from typing import Any

from .spec import Intent, QuerySpec


def build_sql(spec: QuerySpec) -> tuple[str, dict[str, Any]]:
    params: dict[str, Any] = {}

    if spec.intent is Intent.LEADERS:
        value = spec.value_expr("s")  # allowlisted expression; safe to interpolate
        where = ["s.season_type = :stype"]
        params["stype"] = spec.season_type
        if spec.season is not None:
            where.append("s.season = :season")
            params["season"] = spec.season
        qualifier = spec.leader_min("s")
        if qualifier:
            where.append(qualifier)
        params["limit"] = spec.limit
        sql = (
            f"SELECT p.full_name, s.season, {value} AS value "
            "FROM player_season_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY value DESC LIMIT :limit"
        )
        return sql, params

    if spec.intent is Intent.PLAYER_TOTAL:
        # Prefer the resolved canonical id; fall back to a name LIKE.
        if spec.player_id:
            player_pred = "s.player_id = :player_id"
            params["player_id"] = spec.player_id
        else:
            player_pred = "lower(p.full_name) LIKE :player"
            params["player"] = f"%{(spec.player or '').lower()}%"
        params["stype"] = spec.season_type
        if spec.scope == "career":
            value = spec.value_expr("s", career=True)
            sql = (
                f"SELECT p.full_name, {value} AS total "
                "FROM player_season_stats s "
                "JOIN players p ON p.player_id = s.player_id "
                f"WHERE {player_pred} AND s.season_type = :stype "
                "GROUP BY p.full_name"
            )
            return sql, params
        value = spec.value_expr("s")
        where = [player_pred, "s.season_type = :stype"]
        if spec.season is not None:
            where.append("s.season = :season")
            params["season"] = spec.season
        sql = (
            f"SELECT p.full_name, s.season, {value} AS value "
            "FROM player_season_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY s.season"
        )
        return sql, params

    if spec.intent is Intent.SINGLE_GAME:
        value = spec.value_expr("s")
        params["limit"] = spec.limit
        # Wrap so we can order/filter on the computed value: rate stats can be
        # NULL when a component is zero, and Postgres sorts NULLs first on DESC —
        # exclude them rather than let a NULL top the board.
        sql = (
            "SELECT * FROM ("
            f"SELECT p.full_name, g.game_id, {value} AS value "
            "FROM player_game_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            "JOIN games g ON g.game_id = s.game_id"
            ") t WHERE value IS NOT NULL AND value > 0 "
            "ORDER BY value DESC LIMIT :limit"
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
