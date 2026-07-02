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
        # Rate stats need a minimum-attempts floor at game grain too, else a
        # 1-for-1 gadget play tops "best single-game passer rating".
        qualifier = spec.game_min("s")
        inner_where = f"WHERE {qualifier} " if qualifier else ""
        # Wrap so we can order/filter on the computed value: rate stats can be
        # NULL when a component is zero, and Postgres sorts NULLs first on DESC —
        # exclude them rather than let a NULL top the board.
        sql = (
            "SELECT * FROM ("
            f"SELECT p.full_name, g.game_id, {value} AS value "
            "FROM player_game_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            "JOIN games g ON g.game_id = s.game_id "
            f"{inner_where}"
            ") t WHERE value IS NOT NULL AND value > 0 "
            "ORDER BY value DESC LIMIT :limit"
        )
        return sql, params

    if spec.intent is Intent.TEAM_STAT:
        # team_game_stats has no season column — season/type come from the games join.
        where = ["g.season_type = :stype"]
        params["stype"] = spec.season_type
        if spec.season is not None:
            where.append("g.season = :season")
            params["season"] = spec.season
        base_from = (
            "FROM team_game_stats s "
            "JOIN teams tm ON tm.team_id = s.team_id "
            "JOIN games g ON g.game_id = s.game_id"
        )
        if spec.stat == "record":
            wins = "SUM(CASE WHEN s.result = 'W' THEN 1 ELSE 0 END)"
            losses = "SUM(CASE WHEN s.result = 'L' THEN 1 ELSE 0 END)"
            ties = "SUM(CASE WHEN s.result = 'T' THEN 1 ELSE 0 END)"
            select = f"SELECT tm.name AS team, {wins} AS wins, {losses} AS losses, {ties} AS ties"
            order = "wins"
        else:
            select = f"SELECT tm.name AS team, {spec.team_expr('s')} AS value"
            order = "value"

        if spec.team_id:  # a specific team → one aggregated row
            where.append("s.team_id = :team_id")
            params["team_id"] = spec.team_id
            sql = f"{select} {base_from} WHERE {' AND '.join(where)} GROUP BY tm.team_id, tm.name"
            return sql, params
        # no team → a leaderboard across teams
        params["limit"] = spec.limit
        having = ""
        min_games = spec.team_min_games()
        if min_games is not None:
            having = "HAVING COUNT(*) >= :min_games "
            params["min_games"] = min_games
        sql = (
            f"{select} {base_from} WHERE {' AND '.join(where)} "
            f"GROUP BY tm.team_id, tm.name {having}ORDER BY {order} DESC LIMIT :limit"
        )
        return sql, params

    raise ValueError(f"unhandled intent: {spec.intent}")


def narrate(spec: QuerySpec, rows: list[dict[str, Any]]) -> str:
    """Templated headline — no LLM call. Falls back gracefully on empty."""
    if not rows:
        return "No matching results found."
    top = rows[0]
    label = spec.label()

    if spec.intent is Intent.TEAM_STAT:
        team = top.get("team", "")
        season = f" in {spec.season}" if spec.season else ""
        if spec.stat == "record":
            w, l, t = top.get("wins"), top.get("losses"), top.get("ties")
            record = f"{w}-{l}" + (f"-{t}" if t else "")
            return f"{team} went {record}{season}."
        value = top.get("value")
        if spec.team_id:
            return f"{team} had {value} {label}{season}."
        return f"{team} leads with {value} {label}{season}."

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
