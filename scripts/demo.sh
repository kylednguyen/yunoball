#!/usr/bin/env bash
# One-command demo: no Docker, no Supabase, no API keys.
# Seeds sample NFL data into SQLite and serves the API + test UI on :4000.
set -euo pipefail

cd "$(dirname "$0")/../apps/api"

echo "[demo] installing minimal deps…"
pip install -q fastapi "uvicorn[standard]" sqlalchemy pydantic-settings

echo "[demo] starting YunoBall (demo mode) → http://localhost:4000"
DEMO=1 exec python -m uvicorn app.main:app --port 4000
