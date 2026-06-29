"""Redis-backed answer cache + helpers.

Redis fronts the Postgres `answer_cache` table for hot/repeat queries so they
skip the LLM + SQL round-trip entirely.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import TYPE_CHECKING, Any

from .config import settings

if TYPE_CHECKING:
    import redis.asyncio as redis

_client: "redis.Redis | None" = None


def get_client() -> "redis.Redis":
    # Imported lazily so demo mode runs without the redis package configured.
    global _client
    if _client is None:
        import redis.asyncio as redis

        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def normalize_question(q: str) -> str:
    """Cheap normalization for exact-match cache keys (semantic match is in PG)."""
    return re.sub(r"\s+", " ", q.strip().lower())


def _key(question: str) -> str:
    digest = hashlib.sha256(normalize_question(question).encode()).hexdigest()[:32]
    return f"yb:answer:{digest}"


async def get_cached(question: str) -> dict[str, Any] | None:
    # Demo mode runs without Redis; failures degrade gracefully to a cache miss.
    if settings.demo_mode:
        return None
    try:
        raw = await get_client().get(_key(question))
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


async def set_cached(question: str, payload: dict[str, Any]) -> None:
    if settings.demo_mode:
        return
    try:
        await get_client().set(
            _key(question),
            # default=str so date/Decimal values from Postgres rows serialize
            # instead of raising and silently disabling the cache.
            json.dumps(payload, default=str),
            ex=settings.answer_cache_ttl_seconds,
        )
    except Exception:  # noqa: BLE001
        pass
