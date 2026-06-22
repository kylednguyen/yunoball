"""Stage 4 prep — SQL safety guard.

Defense-in-depth on top of the read-only DB role: parse the LLM's SQL and
reject anything that isn't a single, read-only SELECT over allowlisted tables.
Enforces a LIMIT so a model mistake can't scan the warehouse.
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp

DEFAULT_LIMIT = 100
MAX_LIMIT = 1000

ALLOWED_TABLES = {
    "seasons",
    "teams",
    "players",
    "games",
    "player_game_stats",
    "team_game_stats",
    "plays",
    "player_season_stats",
}


class UnsafeSqlError(ValueError):
    pass


def guard_sql(raw_sql: str) -> str:
    sql = raw_sql.strip().rstrip(";").strip()

    try:
        statements = sqlglot.parse(sql, read="postgres")
    except Exception as err:  # noqa: BLE001
        raise UnsafeSqlError(f"Could not parse SQL: {err}") from err

    statements = [s for s in statements if s is not None]
    if len(statements) != 1:
        raise UnsafeSqlError("Only a single statement is allowed.")

    stmt = statements[0]
    if not isinstance(stmt, exp.Select):
        raise UnsafeSqlError("Only SELECT statements are allowed.")

    # Reject any write/DDL expressions anywhere in the tree.
    forbidden = (
        exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create,
        exp.Alter, exp.Command, exp.TruncateTable,
    )
    if any(stmt.find(node) for node in forbidden):
        raise UnsafeSqlError("Write/DDL statements are not allowed.")

    # Every referenced table must be allowlisted.
    for table in stmt.find_all(exp.Table):
        name = table.name.lower()
        if name and name not in ALLOWED_TABLES:
            raise UnsafeSqlError(f"Table not allowed: {name}")

    return _enforce_limit(stmt)


def _enforce_limit(stmt: exp.Select) -> str:
    limit = stmt.args.get("limit")
    if limit is None:
        stmt = stmt.limit(DEFAULT_LIMIT)
    else:
        try:
            current = int(limit.expression.name)
            if current > MAX_LIMIT:
                stmt = stmt.limit(MAX_LIMIT)
        except (AttributeError, ValueError):
            stmt = stmt.limit(MAX_LIMIT)
    return stmt.sql(dialect="postgres")
