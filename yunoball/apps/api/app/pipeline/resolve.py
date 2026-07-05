"""Stage 1 — Fuzzy entity resolution.

Map free-text mentions ("Mahomes", "Pat Mahomes", a typo'd name) to a canonical
player id + display name, so downstream SQL filters on a stable key instead of a
brittle string match.

Strategy here is portable (works on SQLite demo and Postgres): pull candidate
names once, cache them, and fuzzy-match n-gram spans of the question with
difflib. In production this is the place to swap in pg_trgm similarity +
pgvector for scale; the interface stays the same.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher, get_close_matches

import anyio
from sqlalchemy import text

from ..database import get_readonly_engine
from ..config import settings
from ..schemas import ResolvedEntity

# Words that should never anchor a player match (stats, question words, etc.).
_STOP = {
    "most", "the", "in", "a", "an", "single", "game", "career", "who", "what",
    "of", "and", "vs", "with", "for", "season", "year", "all", "time", "best",
    "top", "led", "leader", "leaders", "threw", "throw", "passing", "rushing",
    "receiving", "yards", "yard", "touchdowns", "touchdown", "tds", "td",
    "interceptions", "receptions", "catches", "points", "how", "many",
}
_MIN_SPAN = 4
_THRESHOLD = 0.84

# Index cache keyed by connection URL so tests with fresh DBs don't collide.
# Maps a lowercased match target (full name and last name) -> (player_id, name).
_index_cache: dict[str, dict[str, tuple[str, str]]] = {}


def _load_index() -> dict[str, tuple[str, str]]:
    key = settings.effective_readonly_url
    cached = _index_cache.get(key)
    if cached is not None:
        return cached
    with get_readonly_engine().connect() as conn:
        rows = conn.execute(text("SELECT player_id, full_name FROM players"))
        players = [(str(r[0]), str(r[1])) for r in rows]
    index: dict[str, tuple[str, str]] = {}
    for pid, name in players:
        index[name.lower()] = (pid, name)                     # full name
        index.setdefault(name.lower().split()[-1], (pid, name))  # last name
    _index_cache[key] = index
    return index


def clear_cache() -> None:
    _index_cache.clear()


def _spans(question: str) -> list[str]:
    words = re.findall(r"[A-Za-z.'-]+", question)
    spans: list[str] = []
    for n in (2, 1, 3):  # prefer "first last", then last name, then longer
        for i in range(len(words) - n + 1):
            group = words[i : i + n]
            if all(w.lower() in _STOP for w in group):
                continue
            span = " ".join(group).lower()
            if len(span) >= _MIN_SPAN:
                spans.append(span)
    return spans


def _best(question: str, index: dict[str, tuple[str, str]]) -> ResolvedEntity | None:
    spans = _spans(question)
    if not spans:
        return None
    keys = list(index.keys())
    best: tuple[float, str, str] | None = None  # (score, target, span)
    for span in spans:
        # get_close_matches uses quick_ratio short-circuits, so it prunes most
        # candidates cheaply instead of a full O(n) ratio() over every name.
        for target in get_close_matches(span, keys, n=1, cutoff=_THRESHOLD):
            score = SequenceMatcher(None, span, target).ratio()
            if best is None or score > best[0]:
                best = (score, target, span)
    if best is None:
        return None
    score, target, span = best
    pid, name = index[target]
    return ResolvedEntity(
        mention=span, entity_type="player", canonical_id=pid,
        display_name=name, confidence=round(score, 3),
    )


async def resolve_entities(question: str) -> list[ResolvedEntity]:
    index = await anyio.to_thread.run_sync(_load_index)
    match = _best(question, index)
    return [match] if match else []
