"""Answer cache + durable answer store.

Two layers:
  * Redis — hot/repeat queries skip the LLM + SQL round-trip entirely.
  * Postgres `answer_cache` — durable record of every answer, keyed by a stable
    `share_id` (digest of the normalized question) so answers are shareable at
    /a/<share_id> and survive a Redis flush.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

import redis.asyncio as redis
from sqlalchemy import text

from .config import settings
from .rag.store import read_engine

_client: redis.Redis | None = None


def get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def normalize_question(q: str) -> str:
    """Cheap normalization for exact-match cache keys (semantic match is in PG)."""
    return re.sub(r"\s+", " ", q.strip().lower())


def share_id(question: str) -> str:
    """Stable, shareable handle for a question (digest of its normalized form)."""
    return hashlib.sha256(normalize_question(question).encode()).hexdigest()[:32]


def _key(question: str) -> str:
    return f"yb:answer:{share_id(question)}"


# --------------------------------- Redis ------------------------------------ #


async def get_cached(question: str) -> dict[str, Any] | None:
    raw = await get_client().get(_key(question))
    return json.loads(raw) if raw else None


async def set_cached(question: str, payload: dict[str, Any]) -> None:
    await get_client().set(
        _key(question), json.dumps(payload), ex=settings.answer_cache_ttl_seconds
    )


# ----------------------------- Postgres (durable) --------------------------- #

_PERSIST_SQL = text(
    """
    INSERT INTO answer_cache (share_id, question, normalized_question, sql, answer_json, hits)
    VALUES (:share_id, :question, :normalized_question, :sql, :answer_json, 1)
    ON CONFLICT (normalized_question) DO UPDATE SET
        share_id = EXCLUDED.share_id,
        sql = EXCLUDED.sql,
        answer_json = EXCLUDED.answer_json,
        hits = answer_cache.hits + 1
    """
)


def persist_answer(payload: dict[str, Any]) -> None:
    """Durably record an answer for sharing + analytics (sync; best-effort)."""
    question = payload["question"]
    with read_engine().begin() as conn:
        conn.execute(
            _PERSIST_SQL,
            {
                "share_id": payload.get("share_id") or share_id(question),
                "question": question,
                "normalized_question": normalize_question(question),
                "sql": payload.get("sql"),
                "answer_json": json.dumps(payload),
            },
        )


def get_answer_by_share_id(sid: str) -> dict[str, Any] | None:
    with read_engine().connect() as conn:
        row = conn.execute(
            text("SELECT answer_json FROM answer_cache WHERE share_id = :s"), {"s": sid}
        ).first()
    return json.loads(row[0]) if row else None
