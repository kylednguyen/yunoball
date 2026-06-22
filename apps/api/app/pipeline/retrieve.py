"""Stage 2 — Context retrieval for NL->SQL grounding.

Returns (a) the relevant slice of the schema and (b) the top-k verified
question->SQL examples. Keeping the prompt focused on the right tables/columns
is the single biggest lever on SQL accuracy.

Phase 2 will retrieve examples dynamically via pgvector and pick the schema
subset from resolved entities. For now we ground the model with a complete
schema doc + a strong static few-shot set, which already makes arbitrary
questions work well against the real warehouse.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RetrievedContext:
    schema_doc: str
    examples: list[dict[str, str]] = field(default_factory=list)


SCHEMA_OVERVIEW = """
Postgres warehouse (read-only). Regular season is season_type = 'REG'
(others: 'POST', 'PRE'). Prefer rollup tables for totals.

players(player_id PK, full_name, first_name, last_name, position, college, rookie_season)
teams(team_id PK, name, nickname, conference, division)
seasons(season PK)
games(game_id PK, season, week, season_type, game_date, home_team, away_team,
       home_score, away_score, stadium, roof, surface)
player_game_stats(player_id, game_id, team_id, completions, attempts,
       passing_yards, passing_tds, interceptions, sacks, carries, rushing_yards,
       rushing_tds, targets, receptions, receiving_yards, receiving_tds,
       fumbles, fumbles_lost, fantasy_points_ppr)   -- PK (player_id, game_id)
player_season_stats(player_id, season, season_type, team_id, games_played,
       passing_yards, passing_tds, interceptions, rushing_yards, rushing_tds,
       receptions, receiving_yards, receiving_tds, fantasy_points_ppr)
team_game_stats(team_id, game_id, is_home, points_for, points_against,
       total_yards, passing_yards, rushing_yards, turnovers,
       time_of_possession_sec, result)              -- result in (W, L, T)
plays(play_id PK, game_id, posteam, defteam, qtr, down, yards_to_go,
       yardline_100, play_type, yards_gained, epa, wp, success,
       passer_player_id, rusher_player_id, receiver_player_id, description)

Joins: *_game_stats.game_id -> games.game_id; stats.player_id -> players.player_id.
player_season_stats is pre-aggregated per player/season/season_type.
""".strip()

# Strong few-shot examples covering the common query shapes. Filtering on
# player names here is illustrative; in production the resolver supplies ids.
FEW_SHOT: list[dict[str, str]] = [
    {
        "question": "Who threw for the most yards in 2023?",
        "sql": (
            "SELECT p.full_name, s.passing_yards FROM player_season_stats s "
            "JOIN players p ON p.player_id = s.player_id "
            "WHERE s.season = 2023 AND s.season_type = 'REG' "
            "ORDER BY s.passing_yards DESC LIMIT 10"
        ),
    },
    {
        "question": "Patrick Mahomes career passing touchdowns",
        "sql": (
            "SELECT p.full_name, SUM(s.passing_tds) AS career_passing_tds "
            "FROM player_season_stats s JOIN players p ON p.player_id = s.player_id "
            "WHERE p.full_name = 'Patrick Mahomes' AND s.season_type = 'REG' "
            "GROUP BY p.full_name"
        ),
    },
    {
        "question": "Most rushing yards in a single game in 2023",
        "sql": (
            "SELECT p.full_name, g.game_id, pgs.rushing_yards "
            "FROM player_game_stats pgs "
            "JOIN players p ON p.player_id = pgs.player_id "
            "JOIN games g ON g.game_id = pgs.game_id "
            "WHERE g.season = 2023 ORDER BY pgs.rushing_yards DESC LIMIT 10"
        ),
    },
    {
        "question": "Which team scored the most points at home in 2023?",
        "sql": (
            "SELECT t.name, SUM(tgs.points_for) AS home_points "
            "FROM team_game_stats tgs "
            "JOIN games g ON g.game_id = tgs.game_id "
            "JOIN teams t ON t.team_id = tgs.team_id "
            "WHERE tgs.is_home = TRUE AND g.season = 2023 AND g.season_type = 'REG' "
            "GROUP BY t.name ORDER BY home_points DESC LIMIT 10"
        ),
    },
    {
        "question": "What is the Chiefs' third down conversion rate in 2023?",
        "sql": (
            "SELECT AVG(CASE WHEN pl.success THEN 1.0 ELSE 0.0 END) AS conversion_rate "
            "FROM plays pl JOIN games g ON g.game_id = pl.game_id "
            "WHERE pl.posteam = 'KC' AND pl.down = 3 AND g.season = 2023 "
            "AND pl.play_type IN ('run', 'pass')"
        ),
    },
]


async def retrieve_context(_question: str) -> RetrievedContext:
    return RetrievedContext(schema_doc=SCHEMA_OVERVIEW, examples=FEW_SHOT)
