"""YunoBall FastAPI app entrypoint.

    uvicorn app.main:app --reload --port 4000
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import leaderboards, search

app = FastAPI(title="YunoBall API", version="0.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)
app.include_router(leaderboards.router)


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ok": True, "service": "yunoball-api"}
