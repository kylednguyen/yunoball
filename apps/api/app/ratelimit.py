"""Redis-backed rate limiting for the search endpoint.

Fixed-window counter per client IP (one Redis key per minute, reusing the
answer-cache client). Fails open: if Redis is unreachable we log a warning and
allow the request, so a cache outage never takes the API down with it.
"""

from __future__ import annotations

import logging
import time

from . import cache
from .config import settings

log = logging.getLogger("yunoball.ratelimit")

WINDOW_SECONDS = 60


async def retry_after(client_ip: str) -> int | None:
    """Count this request against `client_ip`'s current window.

    Returns None to allow the request, or the number of seconds until the
    window resets when the client exceeded `settings.rate_limit_per_minute`
    (0 disables limiting entirely).
    """
    limit = settings.rate_limit_per_minute
    if limit <= 0:
        return None
    now = int(time.time())
    key = f"yb:ratelimit:{client_ip}:{now // WINDOW_SECONDS}"
    try:
        client = cache.get_client()
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, WINDOW_SECONDS)
    except Exception:  # noqa: BLE001
        log.warning("rate limit check failed (Redis unreachable); allowing request")
        return None
    if count > limit:
        return WINDOW_SECONDS - now % WINDOW_SECONDS
    return None
