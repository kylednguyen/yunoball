"""SQLAlchemy engine/session plumbing.

One schema definition, shared by the FastAPI backend and the ingestion CLI.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

load_dotenv()


class Base(DeclarativeBase):
    pass


def _normalize(url: str, *, direct: bool) -> str:
    url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    if direct:
        # Strip pooler-only query params (e.g. pgbouncer=true) for migrations/ingest.
        url = url.split("?", 1)[0]
    return url


def get_engine(*, readonly: bool = False, direct: bool = False) -> Engine:
    """Build an engine.

    - ``direct``  : use the non-pooled connection (migrations, bulk ingest).
    - ``readonly``: use the least-privilege role that executes generated SQL.
    """
    if readonly:
        raw = os.environ.get("READONLY_DATABASE_URL") or os.environ.get("DATABASE_URL")
    elif direct:
        raw = os.environ.get("DIRECT_DATABASE_URL") or os.environ.get("DATABASE_URL")
    else:
        raw = os.environ.get("DATABASE_URL") or os.environ.get("DIRECT_DATABASE_URL")

    if not raw:
        raise RuntimeError("No database URL set (DATABASE_URL / DIRECT_DATABASE_URL).")

    return create_engine(_normalize(raw, direct=direct), pool_pre_ping=True)


def get_sessionmaker(**engine_kwargs) -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(**engine_kwargs), expire_on_commit=False)


@contextmanager
def session_scope(**engine_kwargs) -> Iterator[Session]:
    sm = get_sessionmaker(**engine_kwargs)
    session = sm()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
