"""Seed the entity-alias table.

Every player and team gets searchable aliases (full name, surname; team name,
nickname, city, abbreviation) so the resolver can map messy mentions
("Mahomes", "Niners", "BUF") to a canonical id. Resolution is pg_trgm fuzzy
match — no embeddings, no vector search.

    yunoball-seed-rag
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine

from yunoball_db.base import get_engine


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


def seed_aliases(engine: Engine, rows: list[tuple]) -> int:
    stmt = text(
        "INSERT INTO entity_aliases (entity_type, canonical_id, alias) "
        "VALUES (:entity_type, :canonical_id, :alias)"
    )
    records = [
        {"entity_type": et, "canonical_id": cid, "alias": alias}
        for (et, cid, alias) in rows
    ]
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE entity_aliases RESTART IDENTITY"))
        for i in range(0, len(records), 1000):
            conn.execute(stmt, records[i : i + 1000])
    return len(records)


def main() -> None:
    engine = get_engine(direct=True)
    with engine.connect() as conn:
        alias_rows = _team_aliases(conn) + _player_aliases(conn)
    n_alias = seed_aliases(engine, alias_rows)
    print(f"[seed-rag] aliases: {n_alias} (pg_trgm)")


if __name__ == "__main__":
    main()
