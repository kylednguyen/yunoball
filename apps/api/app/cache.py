"""Answer cache — front-loaded and two-tier.

  L1: normalized question text -> response   (skips the whole pipeline)
  L2: QuerySpec key           -> response   (dedupes different phrasings)

Backend is Redis in production; an in-process LRU is used when Redis isn't
configured (e.g. the SQLite demo), so caching is always exercised and testable.
A semantic layer (embedding similarity over pgvector) is slotted in for prod —
it needs an embedding model, so it is skipped when running key-less.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from collections import OrderedDict
from typing import TYPE_CHECKING, Any

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
        # Redis only when a real deployment configures it; else in-memory.
        if not settings.use_sqlite:
            try:
                import redis.asyncio as redis

                _backend = redis.from_url(settings.redis_url, decode_responses=True)
            except Exception:  # noqa: BLE001
                _backend = _MemoryCache()
        else:
            _backend = _MemoryCache()
    return _backend


# --------------------------- keys --------------------------- #


def normalize_question(q: str) -> str:
    # Lowercase and drop punctuation so "...touchdowns?" and "...touchdowns"
    # share a cache entry.
    q = re.sub(r"[^\w\s]", " ", q.lower())
    return re.sub(r"\s+", " ", q).strip()


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:32]


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


async def semantic_lookup(question: str) -> dict[str, Any] | None:
    """Embedding-similarity lookup over the pgvector answer_cache.

    Requires an embedding model, so it is skipped when running without a key.
    TODO(prod): embed `question`, search answer_cache by cosine distance, and
    return the payload above a similarity threshold.
    """
    if settings.use_mock_llm:
        return None
    return None
