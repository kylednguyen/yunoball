"""Rule-based NL->SQL + narration for demo mode (no LLM required).

Covers the common StatMuse-style query shapes against the seeded demo tables:
leaders by a stat (optionally per season), a specific player's season/career
totals, and single-game leaders. This is intentionally simple — the OpenAI
path replaces it in production — but it makes the full pipeline testable offline.
"""

from __future__ import annotations

import re
from typing import Any

from .seed import SEED_PLAYERS

# Map intent keywords -> (column, human label). Order matters: unambiguous
# stats first (see app/query/parse_rules.py, which supersedes this on the main
# path and is kept consistent to avoid drift).
_STAT_RULES: list[tuple[tuple[str, ...], str, str]] = [
    (("interception", "picked off", "pick six", "int thrown"), "interceptions", "interceptions"),
    (("passing touchdown", "passing td", "touchdown pass", "td pass"), "passing_tds", "passing touchdowns"),
    (("rushing touchdown", "rushing td", "rush td"), "rushing_tds", "rushing touchdowns"),
    (("receiving touchdown", "receiving td", "rec td"), "receiving_tds", "receiving touchdowns"),
    (("passing yard", "passing yds", "threw for", "pass yard"), "passing_yards", "passing yards"),
    (("rushing yard", "rushing yds", "rush yard", "rushed for", "rush"), "rushing_yards", "rushing yards"),
    (("receiving yard", "receiving yds", "rec yard", "receiv"), "receiving_yards", "receiving yards"),
    (("reception", "catches", "caught"), "receptions", "receptions"),
    (("touchdown", "td", "threw"), "passing_tds", "touchdowns"),
]

# Surname -> full name, from the seed set, for cheap player detection.
_PLAYER_TOKENS = {p[1].split()[-1].lower(): p[1] for p in SEED_PLAYERS}
_PLAYER_TOKENS.update({p[1].lower(): p[1] for p in SEED_PLAYERS})


def _detect_stat(q: str) -> tuple[str, str]:
    for keys, col, label in _STAT_RULES:
        if any(k in q for k in keys):
            return col, label
    return "passing_yards", "passing yards"


def _detect_player(q: str) -> str | None:
    for token, full in _PLAYER_TOKENS.items():
        if token in q:
            return full
    return None


def _detect_season(q: str) -> int | None:
    m = re.search(r"\b(19|20)\d{2}\b", q)
    return int(m.group(0)) if m else None


def mock_generate_sql(question: str) -> str:
    q = question.lower()
    col, _ = _detect_stat(q)
    player = _detect_player(q)
    season = _detect_season(q)
    is_career = "career" in q or "all time" in q or "all-time" in q
    is_single_game = "game" in q and ("single" in q or "in a game" in q or "one game" in q)

    if is_single_game:
        return (
            f"SELECT p.full_name, g.game_id, s.{col} AS value "
            "FROM player_game_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            "JOIN games g ON g.game_id = s.game_id "
            f"WHERE s.{col} > 0 "
            f"ORDER BY s.{col} DESC LIMIT 5"
        )

    if player and is_career:
        return (
            f"SELECT p.full_name, SUM(s.{col}) AS total_{col} "
            "FROM player_season_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            f"WHERE lower(p.full_name) LIKE '%{player.lower()}%' "
            "GROUP BY p.full_name"
        )

    if player:
        where = [f"lower(p.full_name) LIKE '%{player.lower()}%'"]
        if season:
            where.append(f"s.season = {season}")
        return (
            f"SELECT p.full_name, s.season, s.{col} AS value "
            "FROM player_season_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY s.season"
        )

    # leaders
    where = f"WHERE s.season = {season} " if season else ""
    return (
        f"SELECT p.full_name, s.season, s.{col} AS value "
        "FROM player_season_stats s "
        "JOIN players p ON p.player_id = s.player_id "
        f"{where}"
        f"ORDER BY s.{col} DESC LIMIT 10"
    )


def mock_narrate(question: str, rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "No matching results found in the demo dataset."

    top = rows[0]
    name = top.get("full_name")
    # Pick the most informative numeric field for the headline.
    value_key = next(
        (k for k in ("value", "total", *[k for k in top if k.startswith("total_")]) if k in top),
        None,
    )
    if value_key is None:
        value_key = next((k for k, v in top.items() if isinstance(v, (int, float))), None)

    if name and value_key is not None:
        season = f" in {top['season']}" if "season" in top and top.get("season") else ""
        return f"{name} leads the demo data with {top[value_key]}{season}."
    return f"Top result: {top}"
