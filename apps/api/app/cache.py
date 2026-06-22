"""Redis-backed answer cache + helpers.

Redis fronts the Postgres `answer_cache` table for hot/repeat queries so they
skip the LLM + SQL round-trip entirely.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

import redis.asyncio as redis

from .config import settings

_client: redis.Redis | None = None


def get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def normalize_question(q: str) -> str:
    """Cheap normalization for exact-match cache keys (semantic match is in PG)."""
    return re.sub(r"\s+", " ", q.strip().lower())


def _key(question: str) -> str:
    digest = hashlib.sha256(normalize_question(question).encode()).hexdigest()[:32]
    return f"yb:answer:{digest}"


async def get_cached(question: str) -> dict[str, Any] | None:
    raw = await get_client().get(_key(question))
    return json.loads(raw) if raw else None


async def set_cached(question: str, payload: dict[str, Any]) -> None:
    await get_client().set(
        _key(question), json.dumps(payload), ex=settings.answer_cache_ttl_seconds
    )
