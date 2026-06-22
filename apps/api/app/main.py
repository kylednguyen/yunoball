"""YunoBall FastAPI app entrypoint.

    # Demo (no keys, no Docker): seeds SQLite on startup, serves a test UI at /
    uvicorn app.main:app --port 4000

    # Production: set OPENAI_API_KEY + DATABASE_URL (Postgres) + REDIS_URL
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import settings
from .routers import search

log = logging.getLogger("yunoball")
STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.demo_mode:
        from .database import get_engine
        from .seed import is_seeded, seed_demo

        engine = get_engine()
        if not is_seeded(engine):
            log.warning("DEMO MODE: seeding sample NFL data into %s", settings.demo_db_path)
            seed_demo(engine)
        log.warning("DEMO MODE active (SQLite + rule-based NL->SQL, no API keys).")
    yield


app = FastAPI(title="YunoBall API", version="0.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ok": True, "service": "yunoball-api", "demo_mode": settings.demo_mode}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
