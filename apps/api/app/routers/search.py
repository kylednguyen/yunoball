"""POST /api/search — answer an NFL question."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from ..pipeline import run_query_pipeline
from ..pipeline.guard_sql import UnsafeSqlError
from ..schemas import SearchRequest, SearchResponse

log = logging.getLogger("yunoball.search")
router = APIRouter(prefix="/api/search", tags=["search"])


@router.post("", response_model=SearchResponse)
async def search(req: SearchRequest) -> SearchResponse:
    try:
        return await run_query_pipeline(req)
    except UnsafeSqlError as err:
        # The generated query failed validation — treat as an unanswerable query.
        log.warning("rejected unsafe SQL: %s", err)
        raise HTTPException(status_code=422, detail="Could not build a safe query.")
    except Exception:  # noqa: BLE001
        log.exception("pipeline error")
        raise HTTPException(status_code=500, detail="Failed to answer query.")
