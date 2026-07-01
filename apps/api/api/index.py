"""Vercel Python serverless entrypoint.

Vercel's @vercel/python runtime serves the exported ASGI ``app`` object.
Note: serverless has no persistent disk, so the SQLite demo will not work here —
set DATABASE_URL (Supabase) so the app runs in Postgres mode.
"""

from app.main import app  # noqa: F401  (ASGI app served by the runtime)
