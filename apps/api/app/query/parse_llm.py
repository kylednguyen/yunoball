"""LLM function-call parser: NL -> QuerySpec for the long tail.

The model returns a small structured tool call, never raw SQL. The arguments are
UNTRUSTED — every field is validated against the QuerySpec schema (allowlisted
stat, bounded limit) before use, so a hallucinated column can't reach the DB.

`spec_from_json` is the pure validation step and is unit-tested without a key;
`parse_llm` wraps it with the actual OpenAI call.
"""

from __future__ import annotations

import json
from typing import Any

from .. import llm
from ..config import settings
from .spec import STATS, TEAM_STATS, QuerySpec

# Light synonym normalization so near-miss stat names still validate.
_STAT_SYNONYMS = {
    "passing_touchdowns": "passing_tds",
    "pass_tds": "passing_tds",
    "rushing_touchdowns": "rushing_tds",
    "receiving_touchdowns": "receiving_tds",
    "ints": "interceptions",
    "rec_yards": "receiving_yards",
    "rush_yards": "rushing_yards",
    "pass_yards": "passing_yards",
}

TOOL = {
    "type": "function",
    "function": {
        "name": "answer_nfl_query",
        "description": "Structured representation of an NFL stats question.",
        "parameters": {
            "type": "object",
            "properties": {
                "intent": {"type": "string", "enum": ["leaders", "player_total", "single_game", "team_stat", "comparison"]},
                "stat": {"type": "string", "enum": list(STATS.keys()) + list(TEAM_STATS.keys())},
                "season": {"type": ["integer", "null"]},
                "player": {"type": ["string", "null"], "description": "player name if the question is about one player, or the first player in a comparison"},
                "player2": {"type": ["string", "null"], "description": "the second player in a comparison (intent=comparison)"},
                "team": {"type": ["string", "null"], "description": "team name if the question is about one team (intent=team_stat)"},
                "scope": {"type": "string", "enum": ["season", "career"], "default": "season"},
                "limit": {"type": "integer", "default": 10},
            },
            "required": ["intent", "stat"],
        },
    },
}

SYSTEM = (
    "Convert the NFL question into a structured query by calling answer_nfl_query. "
    "Pick the closest stat from the allowed list. Use intent=player_total for a "
    "single player, single_game for best-single-game questions, comparison for "
    "two players head-to-head ('A vs B'), team_stat for a team's record/points or "
    "a team leaderboard, else leaders. For intent=team_stat the stat must be a "
    "team stat (record, wins, losses, points, points_per_game); comparison uses a "
    "player stat and both player and player2."
)


def spec_from_json(data: dict[str, Any]) -> QuerySpec | None:
    """Validate untrusted model output into a QuerySpec (or None)."""
    if not isinstance(data, dict):
        return None
    clean = {k: v for k, v in data.items() if v is not None}
    if isinstance(clean.get("stat"), str):
        s = clean["stat"].lower().strip()
        clean["stat"] = _STAT_SYNONYMS.get(s, s)
    try:
        return QuerySpec(**clean)
    except Exception:  # noqa: BLE001  (pydantic ValidationError, TypeError, ...)
        return None


async def parse_llm(question: str) -> QuerySpec | None:
    resp = await llm.get_client().chat.completions.create(
        model=settings.sql_model,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": question},
        ],
        tools=[TOOL],
        tool_choice={"type": "function", "function": {"name": "answer_nfl_query"}},
        max_tokens=200,
    )
    calls = resp.choices[0].message.tool_calls
    if not calls:
        return None
    try:
        data = json.loads(calls[0].function.arguments)
    except (json.JSONDecodeError, TypeError):
        return None
    return spec_from_json(data)
