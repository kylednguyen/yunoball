"""Shared DB plumbing for the RAG stores (resolve / retrieve / seed)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine

from yunoball_db.base import get_engine

_read_engine: Engine | None = None


def read_engine() -> Engine:
    """Pooled engine for read paths (resolution + few-shot retrieval)."""
    global _read_engine
    if _read_engine is None:
        _read_engine = get_engine()
    return _read_engine


def vector_literal(vec: list[float]) -> str:
    """pgvector text input form: '[0.1,0.2,...]' (cast with ::vector in SQL)."""
    return "[" + ",".join(f"{x:.7g}" for x in vec) + "]"


def has_embeddings(table: str) -> bool:
    with read_engine().connect() as conn:
        return bool(
            conn.execute(
                text(f"SELECT 1 FROM {table} WHERE embedding IS NOT NULL LIMIT 1")
            ).first()
        )
