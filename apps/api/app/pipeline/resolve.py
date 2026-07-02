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
# Team indexes: names/nicknames/cities matched case-insensitively; abbreviations
# matched case-sensitively (so "NO"/"LA" don't match the words "no"/"la").
_team_name_cache: dict[str, dict[str, tuple[str, str]]] = {}
_team_abbrev_cache: dict[str, dict[str, str]] = {}

# Well-known nicknames nflverse team names don't spell out.
_TEAM_EXTRA_ALIASES = {
    "niners": "SF", "niner": "SF", "gmen": "NYG", "bucs": "TB",
    "cards": "ARI", "jags": "JAX", "pats": "NE",
}


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


def _load_team_indexes() -> tuple[dict[str, tuple[str, str]], dict[str, str]]:
    """(name_index, abbrev_index). name_index maps lowercased name/nickname/city
    → (team_id, display_name); abbrev_index maps the UPPERCASE team id → name."""
    key = settings.effective_readonly_url
    if key in _team_name_cache:
        return _team_name_cache[key], _team_abbrev_cache[key]
    with get_readonly_engine().connect() as conn:
        rows = conn.execute(text("SELECT team_id, name, nickname FROM teams"))
        teams = [(str(a), str(b), (str(c) if c is not None else "")) for a, b, c in rows]
    names: dict[str, tuple[str, str]] = {}
    abbrevs: dict[str, str] = {}
    id_to_name = {tid: name for tid, name, _ in teams}
    for tid, name, nick in teams:
        abbrevs[tid.upper()] = name
        names.setdefault(name.lower(), (tid, name))
        if nick:
            names.setdefault(nick.lower(), (tid, name))
            if name.lower().endswith(nick.lower()):
                city = name[: -len(nick)].strip()
                if len(city) >= 3:
                    names.setdefault(city.lower(), (tid, name))
    for alias, tid in _TEAM_EXTRA_ALIASES.items():
        if tid in id_to_name:
            names.setdefault(alias, (tid, id_to_name[tid]))
    _team_name_cache[key] = names
    _team_abbrev_cache[key] = abbrevs
    return names, abbrevs


def _best_team(question: str, names: dict[str, tuple[str, str]], abbrevs: dict[str, str]) -> ResolvedEntity | None:
    q = question.lower()
    best_alias: str | None = None  # longest matching name/nickname/city
    for alias in names:
        if re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", q):
            if best_alias is None or len(alias) > len(best_alias):
                best_alias = alias
    if best_alias is not None:
        tid, name = names[best_alias]
        return ResolvedEntity(
            mention=best_alias, entity_type="team", canonical_id=tid,
            display_name=name, confidence=1.0,
        )
    # Fall back to a case-sensitive abbreviation token (BUF, KC) in the original text.
    for tid, name in abbrevs.items():
        if re.search(rf"(?<![A-Za-z0-9]){re.escape(tid)}(?![A-Za-z0-9])", question):
            return ResolvedEntity(
                mention=tid, entity_type="team", canonical_id=tid,
                display_name=name, confidence=1.0,
            )
    return None


def clear_cache() -> None:
    _index_cache.clear()
    _team_name_cache.clear()
    _team_abbrev_cache.clear()


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


def _resolve_sync(question: str) -> list[ResolvedEntity]:
    out: list[ResolvedEntity] = []
    player = _best(question, _load_index())
    if player is not None:
        out.append(player)
    names, abbrevs = _load_team_indexes()
    team = _best_team(question, names, abbrevs)
    if team is not None:
        out.append(team)
    return out


async def resolve_entities(question: str) -> list[ResolvedEntity]:
    return await anyio.to_thread.run_sync(_resolve_sync, question)
