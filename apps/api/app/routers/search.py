"""POST /api/search — answer an NFL question."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from .. import cache, ratelimit
from ..pipeline import run_query_pipeline
from ..schemas import SearchRequest, SearchResponse

log = logging.getLogger("yunoball.search")
router = APIRouter(prefix="/api/search", tags=["search"])


def _client_ip(request: Request) -> str:
    """Client IP for rate limiting; first hop of X-Forwarded-For behind a proxy."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("", response_model=SearchResponse)
async def search(req: SearchRequest, request: Request) -> SearchResponse:
    wait = await ratelimit.retry_after(_client_ip(request))
    if wait is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please slow down.",
            headers={"Retry-After": str(wait)},
        )
    try:
        return await run_query_pipeline(req)
    except Exception:  # noqa: BLE001
        log.exception("pipeline error")
        raise HTTPException(status_code=500, detail="Failed to answer query.")


@router.get("/answer/{share_id}", response_model=SearchResponse)
async def get_shared_answer(share_id: str) -> SearchResponse:
    payload = cache.get_answer_by_share_id(share_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Answer not found.")
    return SearchResponse(**{**payload, "cached": True})
