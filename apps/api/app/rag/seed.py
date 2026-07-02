"""Seed the entity-alias table.

Every player and team gets searchable aliases (full name, surname; team name,
nickname, city, abbreviation) so the resolver can map messy mentions
("Mahomes", "Niners", "BUF") to a canonical id.

Embeddings are computed when OPENAI_API_KEY is set; otherwise rows are inserted
with NULL embeddings and resolution falls back to pg_trgm fuzzy match.

    yunoball-seed-rag                  # aliases (+embeddings if a key is set)
    yunoball-seed-rag --no-embeddings  # force trgm-only
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import text
from sqlalchemy.engine import Engine

from yunoball_db.base import get_engine

from .. import llm
from ..config import settings
from .store import vector_literal


# ------------------------------ alias building ------------------------------ #


def _team_aliases(conn) -> list[tuple[str, str, str]]:
    rows = conn.execute(text("SELECT team_id, name, nickname FROM teams"))
    out: list[tuple[str, str, str]] = []
    for team_id, name, nickname in rows:
        aliases = {team_id, name, nickname}
        if name and nickname and name.endswith(nickname):
            city = name[: -len(nickname)].strip()
            if city:
                aliases.add(city)
        for alias in aliases:
            if alias and alias.strip():
                out.append(("team", team_id, alias.strip()))
    return out


def _player_aliases(conn) -> list[tuple[str, str, str]]:
    rows = conn.execute(
        text("SELECT player_id, full_name, last_name FROM players WHERE full_name IS NOT NULL")
    )
    out: list[tuple[str, str, str]] = []
    for player_id, full_name, last_name in rows:
        aliases = {full_name.strip()}
        if last_name and len(last_name.strip()) >= 3:
            aliases.add(last_name.strip())
        for alias in aliases:
            if alias:
                out.append(("player", player_id, alias))
    return out


# --------------------------------- seeding ---------------------------------- #


async def _embeddings_or_none(texts: list[str], use_embeddings: bool) -> list[str | None]:
    if not use_embeddings:
        return [None] * len(texts)
    vecs = await llm.embed_many(texts)
    return [vector_literal(v) for v in vecs]


def seed_aliases(engine: Engine, embeddings: list[str | None], rows: list[tuple]) -> int:
    stmt = text(
        "INSERT INTO entity_aliases (entity_type, canonical_id, alias, embedding) "
        "VALUES (:entity_type, :canonical_id, :alias, CAST(:embedding AS vector))"
    )
    records = [
        {"entity_type": et, "canonical_id": cid, "alias": alias, "embedding": emb}
        for (et, cid, alias), emb in zip(rows, embeddings)
    ]
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE entity_aliases RESTART IDENTITY"))
        for i in range(0, len(records), 1000):
            conn.execute(stmt, records[i : i + 1000])
    return len(records)


async def _run(use_embeddings: bool) -> None:
    engine = get_engine(direct=True)
    with engine.connect() as conn:
        alias_rows = _team_aliases(conn) + _player_aliases(conn)

    alias_embeddings = await _embeddings_or_none([a[2] for a in alias_rows], use_embeddings)
    n_alias = seed_aliases(engine, alias_embeddings, alias_rows)

    mode = "with embeddings" if use_embeddings else "trgm-only (no embeddings)"
    print(f"[seed-rag] aliases: {n_alias} — {mode}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed YunoBall entity aliases.")
    ap.add_argument("--no-embeddings", action="store_true",
                    help="Insert NULL embeddings even if a key is set.")
    args = ap.parse_args()

    use_embeddings = bool(settings.openai_api_key) and not args.no_embeddings
    if not use_embeddings and not args.no_embeddings:
        print("[seed-rag] OPENAI_API_KEY not set — seeding without embeddings.")
    asyncio.run(_run(use_embeddings))


if __name__ == "__main__":
    main()
