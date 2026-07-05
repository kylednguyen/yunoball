"""Provision the least-privilege role that executes LLM-generated SQL.

Defense-in-depth alongside the sqlglot guard: even if a bad query slips past
parsing, this role physically cannot write and is capped by a statement_timeout.
Idempotent — run once after `alembic upgrade head`:

    yunoball-provision-readonly

Admin/owner connection comes from DIRECT_DATABASE_URL (or DATABASE_URL); the
read-only role name + password are parsed from READONLY_DATABASE_URL, falling
back to the local-dev defaults (yunoball_ro / yunoball_ro).
"""

from __future__ import annotations

import os
from urllib.parse import unquote, urlparse

from sqlalchemy import text

from .base import get_engine

STATEMENT_TIMEOUT = os.environ.get("READONLY_STATEMENT_TIMEOUT", "5000ms")
IDLE_TX_TIMEOUT = os.environ.get("READONLY_IDLE_TX_TIMEOUT", "10000ms")


def _readonly_credentials() -> tuple[str, str]:
    url = os.environ.get("READONLY_DATABASE_URL")
    if url:
        parsed = urlparse(url)
        if parsed.username:
            return parsed.username, unquote(parsed.password or "")
    return "yunoball_ro", "yunoball_ro"


def _ident(name: str) -> str:
    """Quote a SQL identifier (role names can't be bound parameters in DDL)."""
    return '"' + name.replace('"', '""') + '"'


def _literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> None:
    role, password = _readonly_credentials()
    engine = get_engine(direct=True)
    dbname = engine.url.database or "postgres"
    ident = _ident(role)

    with engine.begin() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}
        ).scalar()
        verb = "ALTER" if exists else "CREATE"
        conn.execute(text(f"{verb} ROLE {ident} LOGIN PASSWORD {_literal(password)}"))

        # No write ability, capped runtime, read-only transactions by default.
        conn.execute(text(f"ALTER ROLE {ident} SET statement_timeout = {_literal(STATEMENT_TIMEOUT)}"))
        conn.execute(text(f"ALTER ROLE {ident} SET default_transaction_read_only = on"))
        conn.execute(
            text(f"ALTER ROLE {ident} SET idle_in_transaction_session_timeout = {_literal(IDLE_TX_TIMEOUT)}")
        )

        conn.execute(text(f"GRANT CONNECT ON DATABASE {_ident(dbname)} TO {ident}"))
        conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {ident}"))
        # Read on everything that exists now and anything future migrations add.
        conn.execute(text(f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {ident}"))
        conn.execute(
            text(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO {ident}")
        )
        # Belt-and-suspenders: ensure no write grants linger.
        conn.execute(
            text(f"REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM {ident}")
        )

    print(f"[provision] read-only role ready: {role} (statement_timeout={STATEMENT_TIMEOUT})")


if __name__ == "__main__":
    main()
