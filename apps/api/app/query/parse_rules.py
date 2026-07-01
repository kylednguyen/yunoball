"""Rule-based NL -> QuerySpec parser (the zero-LLM fast path).

Handles the common query shapes deterministically. Returns None when nothing
matches, so the pipeline can fall back to the LLM parser (prod) or the raw
NL->SQL path (long tail).
"""

from __future__ import annotations

import re

from ..seed import SEED_PLAYERS
from .spec import Intent, QuerySpec

# keyword groups -> stat key (order matters: most specific first)
_STAT_RULES: list[tuple[tuple[str, ...], str]] = [
    (("passing touchdown", "passing td", "touchdown pass", "threw the most", "most td pass"), "passing_tds"),
    (("passing yard", "passing yds", "throw", "threw for", "pass yard"), "passing_yards"),
    (("interception",), "interceptions"),
    (("rushing touchdown", "rushing td", "rush td"), "rushing_tds"),
    (("rushing yard", "rushing yds", "rush yard", "rushed for", "rush"), "rushing_yards"),
    (("receiving touchdown", "receiving td", "rec td"), "receiving_tds"),
    (("reception", "catches", "caught"), "receptions"),
    (("receiving yard", "receiving yds", "rec yard", "receiv"), "receiving_yards"),
    (("touchdown", "td"), "passing_tds"),
]

# surname / full name -> canonical full name, from the seed set
_PLAYER_TOKENS = {p[1].split()[-1].lower(): p[1] for p in SEED_PLAYERS}
_PLAYER_TOKENS.update({p[1].lower(): p[1] for p in SEED_PLAYERS})


def _stat(q: str) -> str | None:
    for keys, stat in _STAT_RULES:
        if any(k in q for k in keys):
            return stat
    return None


def _player(q: str) -> str | None:
    for token, full in _PLAYER_TOKENS.items():
        if token in q:
            return full
    return None


def _season(q: str) -> int | None:
    m = re.search(r"\b(19|20)\d{2}\b", q)
    return int(m.group(0)) if m else None


def parse_rules(question: str) -> QuerySpec | None:
    q = question.lower()
    stat = _stat(q)
    if stat is None:
        return None

    player = _player(q)
    season = _season(q)
    is_career = "career" in q or "all time" in q or "all-time" in q
    is_single_game = "game" in q and (
        "single" in q or "in a game" in q or "one game" in q
    )

    if is_single_game:
        return QuerySpec(intent=Intent.SINGLE_GAME, stat=stat, limit=5)
    if player:
        return QuerySpec(
            intent=Intent.PLAYER_TOTAL,
            stat=stat,
            player=player,
            season=season,
            scope="career" if is_career else "season",
        )
    return QuerySpec(intent=Intent.LEADERS, stat=stat, season=season, limit=10)
