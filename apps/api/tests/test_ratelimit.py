"""Tests for the Redis-backed rate limiter (fake Redis; no infra needed)."""

from __future__ import annotations

import asyncio

import pytest

from app import ratelimit
from app.config import settings


class FakeRedis:
    def __init__(self):
        self.counts: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    async def incr(self, key):
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key, seconds):
        self.ttls[key] = seconds


class BrokenRedis:
    async def incr(self, key):
        raise ConnectionError("redis down")


@pytest.fixture
def fake_redis(monkeypatch):
    client = FakeRedis()
    monkeypatch.setattr(ratelimit.cache, "get_client", lambda: client)
    monkeypatch.setattr(settings, "rate_limit_per_minute", 3)
    return client


def test_allows_under_the_limit(fake_redis):
    for _ in range(3):
        assert asyncio.run(ratelimit.retry_after("1.2.3.4")) is None


def test_blocks_over_the_limit_with_seconds_to_wait(fake_redis):
    for _ in range(3):
        asyncio.run(ratelimit.retry_after("1.2.3.4"))
    wait = asyncio.run(ratelimit.retry_after("1.2.3.4"))
    assert wait is not None
    assert 1 <= wait <= ratelimit.WINDOW_SECONDS


def test_limits_are_per_client(fake_redis):
    for _ in range(4):
        asyncio.run(ratelimit.retry_after("1.2.3.4"))
    assert asyncio.run(ratelimit.retry_after("5.6.7.8")) is None


def test_window_key_expires(fake_redis):
    asyncio.run(ratelimit.retry_after("1.2.3.4"))
    assert list(fake_redis.ttls.values()) == [ratelimit.WINDOW_SECONDS]


def test_zero_disables_limiting_without_touching_redis(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 0)
    monkeypatch.setattr(
        ratelimit.cache, "get_client", lambda: pytest.fail("redis should not be used")
    )
    assert asyncio.run(ratelimit.retry_after("1.2.3.4")) is None


def test_fails_open_when_redis_is_down(monkeypatch):
    monkeypatch.setattr(ratelimit.cache, "get_client", lambda: BrokenRedis())
    monkeypatch.setattr(settings, "rate_limit_per_minute", 1)
    assert asyncio.run(ratelimit.retry_after("1.2.3.4")) is None
    assert asyncio.run(ratelimit.retry_after("1.2.3.4")) is None  # still open


def test_endpoint_returns_429_with_retry_after_header(fake_redis, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(settings, "rate_limit_per_minute", 1)
    with TestClient(app) as tc:
        # Exhaust the budget for TestClient's IP, then hit the endpoint.
        asyncio.run(ratelimit.retry_after("testclient"))
        resp = tc.post("/api/search", json={"question": "Who led rushing in 2023?"})
    assert resp.status_code == 429
    assert "retry-after" in resp.headers
    assert 1 <= int(resp.headers["retry-after"]) <= ratelimit.WINDOW_SECONDS
