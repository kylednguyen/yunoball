"""Stage 1 — Entity resolution.

Map free-text mentions ("Mahomes", "the Chiefs", "Pat Mahomes") to canonical
player/team ids. Strategy: pg_trgm fuzzy match against `entity_aliases`,
backstopped by pgvector cosine similarity when embeddings are present, so the
NL->SQL prompt can filter on stable ids instead of guessing string matches.
"""

from __future__ import annotations

import re

from sqlalchemy import text

from .. import llm
from ..config import settings
from ..rag.store import has_embeddings, read_engine, vector_literal
from ..schemas import ResolvedEntity

# Minimum trigram similarity for a mention->alias match (0-1).
TRGM_THRESHOLD = 0.45
VECTOR_THRESHOLD = 0.45  # 1 - cosine_distance
MAX_ENTITIES = 6

# Words that never name an entity — skip as 1-gram candidates.
_STOP = {
    "the", "a", "an", "of", "in", "on", "for", "and", "or", "to", "by", "with",
    "who", "what", "which", "how", "many", "much", "most", "least", "more",
    "best", "top", "did", "do", "does", "had", "has", "have", "was", "were",
    "is", "are", "season", "seasons", "game", "games", "regular", "playoff",
    "playoffs", "yards", "yard", "touchdowns", "touchdown", "tds", "points",
    "career", "single", "total", "league", "nfl", "throw", "threw", "score",
    "scored", "led", "lead", "win", "wins", "won", "vs", "versus", "beat",
    "against", "over", "between", "passing", "rushing", "receiving",
    "receptions", "interceptions", "sacks", "fantasy", "completions",
    "compare", "show", "list", "find", "give", "tell", "name", "rank",
    "count", "average", "avg", "per", "during", "when", "where",
}

_WORD = re.compile(r"[A-Za-z0-9'.\-]+")


def _trimmable(token: str) -> bool:
    """Tokens that are never part of an entity name (stopwords, years)."""
    return token.lower() in _STOP or token.isdigit()


def _candidates(question: str) -> list[tuple[str, frozenset[int]]]:
    """1-3 word phrases drawn from contiguous runs of non-stopword tokens.

    Splitting on stopwords/numbers keeps a span from bridging a connector
    ("Hill vs Travis"); returning longest-first lets the greedy matcher prefer
    'Patrick Mahomes' over the bare surname 'Mahomes'.
    """
    words = _WORD.findall(question)
    segments: list[list[tuple[int, str]]] = []
    current: list[tuple[int, str]] = []
    for idx, word in enumerate(words):
        if _trimmable(word):
            if current:
                segments.append(current)
                current = []
        else:
            current.append((idx, word))
    if current:
        segments.append(current)

    spans: list[tuple[int, int, str, frozenset[int]]] = []
    seen: set[str] = set()
    for seg in segments:
        m = len(seg)
        for i in range(m):
            for size in (3, 2, 1):
                if i + size > m:
                    continue
                chunk = seg[i : i + size]
                phrase = " ".join(w for _, w in chunk)
                if len(phrase) < 3:
                    continue
                key = phrase.lower()
                if key in seen:
                    continue
                seen.add(key)
                positions = frozenset(idx for idx, _ in chunk)
                spans.append((size, min(positions), phrase, positions))
    spans.sort(key=lambda s: (-s[0], s[1]))
    return [(phrase, positions) for _, _, phrase, positions in spans]


_TRGM_SQL = text(
    """
    SELECT ea.entity_type,
           ea.canonical_id,
           MAX(similarity(ea.alias, :c)) AS sim,
           COALESCE(t.name, p.full_name) AS display
    FROM entity_aliases ea
    LEFT JOIN teams t ON ea.entity_type = 'team' AND t.team_id = ea.canonical_id
    LEFT JOIN players p ON ea.entity_type = 'player' AND p.player_id = ea.canonical_id
    WHERE ea.alias % :c
    GROUP BY ea.entity_type, ea.canonical_id, display
    ORDER BY sim DESC
    LIMIT 3
    """
)

_VECTOR_SQL = text(
    """
    SELECT ea.entity_type,
           ea.canonical_id,
           1 - (ea.embedding <=> CAST(:qv AS vector)) AS score,
           COALESCE(t.name, p.full_name) AS display
    FROM entity_aliases ea
    LEFT JOIN teams t ON ea.entity_type = 'team' AND t.team_id = ea.canonical_id
    LEFT JOIN players p ON ea.entity_type = 'player' AND p.player_id = ea.canonical_id
    WHERE ea.embedding IS NOT NULL
    ORDER BY ea.embedding <=> CAST(:qv AS vector)
    LIMIT 1
    """
)


async def resolve_entities(question: str) -> list[ResolvedEntity]:
    candidates = _candidates(question)
    if not candidates:
        return []

    # best[canonical_id] = (entity_type, display, confidence, mention)
    best: dict[str, tuple[str, str, float, str]] = {}
    consumed: set[int] = set()
    unmatched: list[tuple[str, frozenset[int]]] = []

    with read_engine().connect() as conn:
        # Longest spans first; a matched span consumes its words so the bare
        # surname/first-name fragments don't re-resolve to other players.
        for phrase, positions in candidates:
            if positions & consumed:
                continue
            top = conn.execute(_TRGM_SQL, {"c": phrase}).first()
            if top and top.sim is not None and top.sim >= TRGM_THRESHOLD:
                consumed |= positions
                _record(best, top.entity_type, top.canonical_id, top.display, float(top.sim), phrase)
            elif phrase[:1].isupper():
                unmatched.append((phrase, positions))

        if settings.embeddings_active and has_embeddings("entity_aliases"):
            fresh = [(p, pos) for p, pos in unmatched if not (pos & consumed)]
            await _vector_backstop(conn, fresh, best, consumed)

    entities = [
        ResolvedEntity(
            mention=mention,
            entity_type=entity_type,  # type: ignore[arg-type]
            canonical_id=canonical_id,
            display_name=display,
            confidence=round(confidence, 3),
        )
        for canonical_id, (entity_type, display, confidence, mention) in best.items()
    ]
    entities.sort(key=lambda e: e.confidence, reverse=True)
    return entities[:MAX_ENTITIES]


def _record(best: dict, entity_type, canonical_id, display, score: float, mention: str) -> None:
    prev = best.get(canonical_id)
    if prev is None or score > prev[2]:
        best[canonical_id] = (entity_type, display or canonical_id, score, mention)


async def _vector_backstop(conn, mentions, best: dict, consumed: set) -> None:
    if not mentions:
        return
    vecs = await llm.embed_many([m for m, _ in mentions])
    for (mention, positions), vec in zip(mentions, vecs):
        if positions & consumed:
            continue
        row = conn.execute(_VECTOR_SQL, {"qv": vector_literal(vec)}).first()
        if not row or row.score is None or row.score < VECTOR_THRESHOLD:
            continue
        consumed |= positions
        _record(best, row.entity_type, row.canonical_id, row.display, float(row.score), mention)
