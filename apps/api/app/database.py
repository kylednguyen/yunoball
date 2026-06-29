"""Engine factory for the API runtime.

Works for both demo (SQLite) and production (Postgres). Generated SQL runs
through the read-only engine; in demo mode both point at the same SQLite file.

This is deliberately separate from ``yunoball_db.base``: that module backs
ingestion/migrations (direct, non-pooled connections) and pulls in extra deps,
whereas the API runtime must stay dependency-light (the zero-install demo) and
talks to the *pooled* connection. Keep URL handling here in sync with base.py.
"""

from __future__ import annotations

from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from .config import settings

_engine: Engine | None = None
_ro_engine: Engine | None = None


def _normalize(url: str) -> str:
    """Use the psycopg v3 driver for Postgres and drop the PgBouncer-only
    ``pgbouncer`` query param (libpq/psycopg rejects it). SQLite passes through.
    """
    if not url.startswith("postgresql://"):
        return url
    url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    parts = urlsplit(url)
    if parts.query:
        kept = [(k, v) for k, v in parse_qsl(parts.query) if k != "pgbouncer"]
        url = urlunsplit(parts._replace(query=urlencode(kept)))
    return url


def _connect_args(url: str, *, readonly: bool) -> dict:
    if not url.startswith("postgresql"):
        return {}
    args: dict = {
        # PgBouncer transaction pooling (Supabase :6543) does not support
        # server-side prepared statements; disable them to avoid runtime errors.
        "prepare_threshold": None,
    }
    if readonly:
        # Hard cap query time for LLM-generated SQL (defense-in-depth alongside
        # the read-only role).
        args["options"] = f"-c statement_timeout={settings.statement_timeout_ms}"
    return args


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        url = _normalize(settings.effective_database_url)
        _engine = create_engine(url, connect_args=_connect_args(url, readonly=False))
    return _engine


def get_readonly_engine() -> Engine:
    global _ro_engine
    if _ro_engine is None:
        url = _normalize(settings.effective_readonly_url)
        _ro_engine = create_engine(url, connect_args=_connect_args(url, readonly=True))
    return _ro_engine
