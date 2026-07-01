"""Stage 2 — Context retrieval for NL->SQL grounding.

Returns (a) a slice of the schema and (b) the top-k verified question->SQL
examples from `query_examples`. With embeddings present we pgvector-search by
question similarity; otherwise we fall back to keyword/tag overlap. Keeping the
prompt focused on the right tables/columns + relevant examples is the single
biggest lever on SQL accuracy.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import text

from .. import llm
from ..config import settings
# rag.store (which imports yunoball_db) is imported lazily inside the functions
# below, so this module — on the always-imported pipeline path — doesn't require
# yunoball_db at boot. retrieve_context only runs on the real-LLM fallback.

DEFAULT_K = 4


@dataclass
class RetrievedContext:
    schema_doc: str
    examples: list[dict[str, str]] = field(default_factory=list)


SCHEMA_OVERVIEW = """
Tables (read-only):
- players(player_id, full_name, first_name, last_name, position, college)
- teams(team_id, name, nickname, conference, division)
- games(game_id, season, week, season_type ['REG'|'POST'], game_date, home_team, away_team, home_score, away_score)
- player_game_stats(player_id, game_id, team_id, completions, attempts, passing_yards, passing_tds, interceptions, sacks, carries, rushing_yards, rushing_tds, targets, receptions, receiving_yards, receiving_tds, fumbles_lost, fantasy_points_ppr)
- player_season_stats(player_id, season, season_type, team_id, games_played, passing_yards, passing_tds, interceptions, rushing_yards, rushing_tds, receptions, receiving_yards, receiving_tds, fantasy_points_ppr)  -- pre-aggregated per player/season
- team_game_stats(team_id, game_id, is_home, points_for, points_against, result ['W'|'L'|'T'], passing_yards, rushing_yards, turnovers)
- plays(play_id, game_id, posteam, defteam, qtr, down, yards_to_go, yardline_100, play_type, yards_gained, epa, wp, success, passer_player_id, rusher_player_id, receiver_player_id)
Notes:
- Join stats to games on game_id; filter season via games.season or player_season_stats.season.
- Use player_season_stats for season/career totals; player_game_stats for single-game; plays for situational/EPA.
- plays has no season column — join games on game_id to filter by season. play_type is typically 'run' or 'pass'; epa is expected points added; wp is win probability. passer/rusher/receiver_player_id join players.player_id.
- Player names live in players.full_name. season_type 'REG' is the regular season.
""".strip()


_EXAMPLE_SQL = text(
    """
    SELECT question, sql
    FROM query_examples
    WHERE verified AND embedding IS NOT NULL
    ORDER BY embedding <=> CAST(:qv AS vector)
    LIMIT :k
    """
)

_WORD = re.compile(r"[a-z0-9]+")


async def retrieve_context(question: str, k: int = DEFAULT_K) -> RetrievedContext:
    from ..rag.store import has_embeddings

    if settings.openai_api_key and has_embeddings("query_examples"):
        examples = await _vector_examples(question, k)
    else:
        examples = _keyword_examples(question, k)
    return RetrievedContext(schema_doc=SCHEMA_OVERVIEW, examples=examples)


async def _vector_examples(question: str, k: int) -> list[dict[str, str]]:
    from ..rag.store import read_engine, vector_literal

    qv = await llm.embed(question)
    with read_engine().connect() as conn:
        rows = conn.execute(_EXAMPLE_SQL, {"qv": vector_literal(qv), "k": k}).all()
    return [{"question": q, "sql": s} for q, s in rows]


def _keyword_examples(question: str, k: int) -> list[dict[str, str]]:
    from ..rag.store import read_engine

    q_tokens = set(_WORD.findall(question.lower()))
    with read_engine().connect() as conn:
        rows = conn.execute(
            text("SELECT question, sql, tags FROM query_examples WHERE verified")
        ).all()
    scored = []
    for ex_q, ex_sql, tags in rows:
        tokens = set(_WORD.findall(ex_q.lower())) | {t.lower() for t in (tags or [])}
        overlap = len(q_tokens & tokens)
        scored.append((overlap, ex_q, ex_sql))
    scored.sort(key=lambda r: r[0], reverse=True)
    return [{"question": q, "sql": s} for score, q, s in scored[:k] if score > 0]
