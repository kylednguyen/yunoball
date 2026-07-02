"""Answer cache — front-loaded two-tier, plus a durable shareable store.

  L1: normalized question text -> response   (skips the whole pipeline)
  L2: QuerySpec key           -> response   (dedupes different phrasings)

Backend is Redis in production; an in-process LRU is used when Redis isn't
configured (e.g. the SQLite demo), so caching is always exercised and testable.

Durability: answers are also best-effort persisted to the Postgres
`answer_cache` table keyed by a stable `share_id`, so they survive a Redis flush
and are shareable at /a/<share_id>. Skipped in the SQLite demo.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from collections import OrderedDict
from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from .config import settings

if TYPE_CHECKING:
    import redis.asyncio as redis


# --------------------------- backends --------------------------- #


class _MemoryCache:
    """Tiny async-compatible LRU with TTL, so cached answers expire like Redis
    (otherwise a long-lived process serves stale data after re-ingestion)."""

    def __init__(self, maxsize: int = 1024):
        self._store: OrderedDict[str, tuple[str, float | None]] = OrderedDict()
        self._maxsize = maxsize

    async def get(self, key: str) -> str | None:
        item = self._store.get(key)
        if item is None:
            return None
        value, expiry = item
        if expiry is not None and expiry <= time.time():
            del self._store[key]
            return None
        self._store.move_to_end(key)
        return value

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        expiry = time.time() + ex if ex else None
        self._store[key] = (value, expiry)
        self._store.move_to_end(key)
        while len(self._store) > self._maxsize:
            self._store.popitem(last=False)


_backend: "_MemoryCache | redis.Redis | None" = None


def _get_backend():
    global _backend
    if _backend is None:
        if not settings.use_sqlite:
            try:
                import redis.asyncio as redis

                _backend = redis.from_url(settings.redis_url, decode_responses=True)
            except Exception:  # noqa: BLE001
                _backend = _MemoryCache()
        else:
            _backend = _MemoryCache()
    return _backend


def get_client():
    """The active cache backend — async Redis in prod, in-process LRU otherwise.

    Exposed for the rate limiter, which needs the raw client for atomic incr.
    """
    return _get_backend()


# --------------------------- keys --------------------------- #


def normalize_question(q: str) -> str:
    # Lowercase and drop punctuation so "...touchdowns?" and "...touchdowns"
    # share a cache entry.
    q = re.sub(r"[^\w\s]", " ", q.lower())
    return re.sub(r"\s+", " ", q).strip()


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:32]


def share_id(question: str) -> str:
    """Stable, shareable handle for a question (digest of its normalized form)."""
    return _hash(normalize_question(question))


def text_key(question: str) -> str:
    return f"yb:q:{_hash(normalize_question(question))}"


def spec_key(spec_cache_key: str) -> str:
    return f"yb:spec:{_hash(spec_cache_key)}"


# --------------------------- ops --------------------------- #


async def get(key: str) -> dict[str, Any] | None:
    try:
        raw = await _get_backend().get(key)
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


async def set(key: str, payload: dict[str, Any]) -> None:
    try:
        await _get_backend().set(
            key, json.dumps(payload, default=str), ex=settings.answer_cache_ttl_seconds
        )
    except Exception:  # noqa: BLE001
        pass


# --------------------- durable shareable store (Postgres) ------------------- #

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
    """Durably record an answer for sharing + analytics (best-effort)."""
    if settings.use_sqlite:
        return  # no durable store in the demo
    try:
        from .rag.store import read_engine

        question = payload["question"]
        with read_engine().begin() as conn:
            conn.execute(
                _PERSIST_SQL,
                {
                    "share_id": payload.get("share_id") or share_id(question),
                    "question": question,
                    "normalized_question": normalize_question(question),
                    "sql": payload.get("sql"),
                    "answer_json": json.dumps(payload, default=str),
                },
            )
    except Exception:  # noqa: BLE001
        pass


def get_answer_by_share_id(sid: str) -> dict[str, Any] | None:
    if settings.use_sqlite:
        return None
    try:
        from .rag.store import read_engine

        with read_engine().connect() as conn:
            row = conn.execute(
                text("SELECT answer_json FROM answer_cache WHERE share_id = :s"),
                {"s": sid},
            ).first()
        return json.loads(row[0]) if row else None
    except Exception:  # noqa: BLE001
        return None
