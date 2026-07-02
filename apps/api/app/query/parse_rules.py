"""Rule-based NL -> QuerySpec parser (the zero-LLM fast path).

Handles the common query shapes deterministically. Returns None when nothing
matches, so the pipeline can fall back to the LLM parser (prod) or the raw
NL->SQL path (long tail).
"""

from __future__ import annotations

import re

from ..seed import SEED_PLAYERS, SEED_TEAMS
from .spec import Intent, QuerySpec

# keyword groups -> stat key. Order matters: most specific first. Unambiguous
# stats (interceptions) are checked before generic touchdown/yard cues so that
# e.g. "threw the most interceptions" is not captured by a passing-TD rule.
_STAT_RULES: list[tuple[tuple[str, ...], str]] = [
    (("passer rating", "qb rating", "quarterback rating"), "passer_rating"),
    (("completion percentage", "completion %", "completion pct", "comp pct"), "completion_percentage"),
    (("interception", "picked off", "pick six", "int thrown"), "interceptions"),
    (("sack", "sacked"), "sacks"),
    (("passing touchdown", "passing td", "touchdown pass", "td pass"), "passing_tds"),
    (("rushing touchdown", "rushing td", "rush td"), "rushing_tds"),
    (("receiving touchdown", "receiving td", "rec td"), "receiving_tds"),
    (("passing yard", "passing yds", "threw for", "pass yard"), "passing_yards"),
    (("rushing yard", "rushing yds", "rush yard", "rushed for", "rush"), "rushing_yards"),
    (("receiving yard", "receiving yds", "rec yard", "receiv"), "receiving_yards"),
    (("target",), "targets"),
    (("reception", "catches", "caught"), "receptions"),
    # Generic fallbacks — only reached if nothing specific matched above.
    (("touchdown", "td", "threw"), "passing_tds"),
]

# Team-stat cues. "strong" cues are unambiguously team-level (record, per-game,
# wins/losses); "weak" cues (points, yards) only win when no player stat matched,
# so "most passing yards" stays a player leaderboard.
_TEAM_STAT_RULES: list[tuple[tuple[str, ...], str]] = [
    (("record", "win-loss", "win loss"), "record"),
    (("points per game", "ppg", "scoring offense", "highest scoring"), "points_per_game"),
    (("yards per game", "ypg"), "yards_per_game"),
    (("most wins", "wins",), "wins"),
    (("most losses", "losses"), "losses"),
    (("points", "scored", "scoring"), "points"),
    (("yards", "total offense"), "yards"),
]
_TEAM_STRONG = {"record", "points_per_game", "yards_per_game", "wins", "losses"}

# surname / full name -> canonical full name, from the seed set
_PLAYER_TOKENS = {p[1].split()[-1].lower(): p[1] for p in SEED_PLAYERS}
_PLAYER_TOKENS.update({p[1].lower(): p[1] for p in SEED_PLAYERS})

# team aliases -> (display name, team_id), from the seed set
_TEAM_NAME_TOKENS: dict[str, tuple[str, str]] = {}
_TEAM_ABBREVS: dict[str, str] = {}  # team_id -> name
for _tid, _name, _nick, _conf, _div in SEED_TEAMS:
    _TEAM_ABBREVS[_tid] = _name
    _TEAM_NAME_TOKENS[_name.lower()] = (_name, _tid)
    _TEAM_NAME_TOKENS[_nick.lower()] = (_name, _tid)
    if _name.lower().endswith(_nick.lower()):
        _city = _name[: -len(_nick)].strip()
        if len(_city) >= 3:
            _TEAM_NAME_TOKENS[_city.lower()] = (_name, _tid)


def _stat(q: str) -> str | None:
    for keys, stat in _STAT_RULES:
        if any(k in q for k in keys):
            return stat
    return None


def _team_stat(q: str) -> str | None:
    for keys, stat in _TEAM_STAT_RULES:
        if any(k in q for k in keys):
            return stat
    return None


def _player(q: str) -> str | None:
    for token, full in _PLAYER_TOKENS.items():
        if token in q:
            return full
    return None


def _team_token(q: str, original: str) -> tuple[str, str] | None:
    """(display_name, team_id) from the seed tokens, for standalone parsing."""
    best: str | None = None
    for alias in _TEAM_NAME_TOKENS:
        if re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", q):
            if best is None or len(alias) > len(best):
                best = alias
    if best is not None:
        return _TEAM_NAME_TOKENS[best]
    for tid, name in _TEAM_ABBREVS.items():
        if re.search(rf"(?<![A-Za-z0-9]){re.escape(tid)}(?![A-Za-z0-9])", original):
            return name, tid
    return None


def _season(q: str) -> int | None:
    m = re.search(r"\b(19|20)\d{2}\b", q)
    return int(m.group(0)) if m else None


def parse_rules(question: str, entities: list | None = None) -> QuerySpec | None:
    q = question.lower()
    season = _season(q)
    entities = entities or []

    stat = _stat(q)
    tstat = _team_stat(q)

    # Prefer a resolved entity (works for any player/team in the DB); fall back
    # to the built-in seed tokens so the parser is usable standalone / in tests.
    player = player_id = None
    p_ent = next((e for e in entities if e.entity_type == "player"), None)
    if p_ent is not None:
        player, player_id = p_ent.display_name, p_ent.canonical_id
    elif stat is not None:
        player = _player(q)

    team = team_id = None
    t_ent = next((e for e in entities if e.entity_type == "team"), None)
    if t_ent is not None:
        team, team_id = t_ent.display_name, t_ent.canonical_id
    else:
        tok = _team_token(q, question)
        if tok is not None:
            team, team_id = tok

    # Team route: a strong team cue, or a weak one (points/yards) with no player
    # stat to claim it. A concrete player + player stat always wins.
    if tstat is not None and not (player and stat):
        if tstat in _TEAM_STRONG or stat is None:
            return QuerySpec(
                intent=Intent.TEAM_STAT, stat=tstat,
                team=team, team_id=team_id, season=season, limit=10,
            )

    if stat is None:
        return None

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
            player_id=player_id,
            season=season,
            scope="career" if is_career else "season",
        )
    return QuerySpec(intent=Intent.LEADERS, stat=stat, season=season, limit=10)
