#!/usr/bin/env bash
# One-command dev environment: full app with hot reload, no Docker, no keys.
#
#   ./scripts/dev.sh
#     → API   http://localhost:4000  (FastAPI, SQLite demo warehouse, --reload)
#     → Web   http://localhost:3000  (Next.js dev server, hot reload)
#
# Both processes stream into this terminal; Ctrl-C stops them together.
# Set DATABASE_URL before running to develop against real Postgres instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[dev] installing API deps…"
pip install -q fastapi "uvicorn[standard]" sqlalchemy pydantic-settings

echo "[dev] installing web deps…"
pnpm install --silent

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "[dev] API  → http://localhost:4000"
( cd apps/api && DEMO="${DEMO:-1}" python -m uvicorn app.main:app --port 4000 --reload ) &

echo "[dev] Web  → http://localhost:3000"
( cd apps/web && NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:4000}" pnpm dev ) &

wait
