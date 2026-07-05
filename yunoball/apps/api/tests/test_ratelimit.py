"""Rate limiter: fixed-window counting with fail-open semantics.

Run with:  cd apps/api && DEMO=1 pytest
Uses asyncio.run() to drive the async limiter, so no pytest-asyncio needed.
"""

import asyncio
import os

os.environ.setdefault("DEMO", "1")

import pytest  # noqa: E402

from app import cache, ratelimit  # noqa: E402
from app.config import settings  # noqa: E402


class _FakeRedis:
    """Minimal async stand-in for redis.asyncio, with incr/expire."""

    def __init__(self):
        self.counts: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key: str, seconds: int) -> None:  # noqa: D401
        pass


@pytest.fixture
def fake_backend(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(cache, "_backend", fake)
    return fake


def test_allows_under_limit(fake_backend, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 3)
    for _ in range(3):
        assert asyncio.run(ratelimit.retry_after("1.2.3.4")) is None


def test_blocks_over_limit(fake_backend, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 2)
    assert asyncio.run(ratelimit.retry_after("9.9.9.9")) is None
    assert asyncio.run(ratelimit.retry_after("9.9.9.9")) is None
    wait = asyncio.run(ratelimit.retry_after("9.9.9.9"))
    assert wait is not None and 0 < wait <= 60


def test_disabled_when_zero(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 0)
    assert asyncio.run(ratelimit.retry_after("5.5.5.5")) is None


def test_fails_open_on_memory_backend(monkeypatch):
    # In-process demo cache has no incr → limiter must allow the request.
    monkeypatch.setattr(settings, "rate_limit_per_minute", 1)
    monkeypatch.setattr(cache, "_backend", cache._MemoryCache())
    assert asyncio.run(ratelimit.retry_after("7.7.7.7")) is None
    assert asyncio.run(ratelimit.retry_after("7.7.7.7")) is None
