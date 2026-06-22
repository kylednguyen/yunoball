"""Stage 2 — Context retrieval for NL->SQL grounding.

Returns (a) the relevant slice of the schema and (b) the top-k verified
question->SQL examples by embedding similarity from `query_examples`. Keeping
the prompt focused on the right tables/columns is the single biggest lever on
SQL accuracy.

TODO(phase-2): embed the question and pgvector-search query_examples; select
the schema subset from resolved entity types + keyword routing.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RetrievedContext:
    schema_doc: str
    examples: list[dict[str, str]] = field(default_factory=list)


SCHEMA_OVERVIEW = """
Tables (read-only):
- players(player_id, full_name, position, ...)
- teams(team_id, name, conference, division)
- games(game_id, season, week, season_type, home_team, away_team, home_score, away_score, game_date)
- player_game_stats(player_id, game_id, team_id, passing_yards, passing_tds, rushing_yards, receiving_yards, ...)
- player_season_stats(player_id, season, season_type, passing_yards, rushing_yards, receiving_yards, ...)
- team_game_stats(team_id, game_id, points_for, points_against, result, ...)
- plays(play_id, game_id, posteam, defteam, qtr, down, yards_to_go, play_type, epa, success, ...)
Join player_game_stats -> games on game_id; player_season_stats is pre-aggregated per player/season.
""".strip()


async def retrieve_context(_question: str) -> RetrievedContext:
    return RetrievedContext(schema_doc=SCHEMA_OVERVIEW, examples=[])
