"""Golden question -> reference-SQL set.

The reference SQL is hand-authored ground truth, verified to execute against the
2022-2024 warehouse. The harness runs each reference query to get the *expected*
result, runs the pipeline to get the *predicted* result, and scores execution
accuracy (do the result sets match?). These pairs double as the verified
few-shot library seeded into `query_examples` (Phase 2).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class GoldenCase:
    id: str
    question: str
    reference_sql: str
    tags: list[str] = field(default_factory=list)


GOLDEN: list[GoldenCase] = [
    GoldenCase(
        id="pass_tds_leader_2023",
        question="Who threw the most passing touchdowns in the 2023 regular season?",
        reference_sql="""
            SELECT p.full_name, s.passing_tds
            FROM player_season_stats s JOIN players p USING (player_id)
            WHERE s.season = 2023 AND s.season_type = 'REG'
            ORDER BY s.passing_tds DESC, p.full_name
            LIMIT 1
        """,
        tags=["season", "passing", "leader"],
    ),
    GoldenCase(
        id="rush_yards_leader_2022",
        question="Who led the NFL in rushing yards in the 2022 regular season?",
        reference_sql="""
            SELECT p.full_name, s.rushing_yards
            FROM player_season_stats s JOIN players p USING (player_id)
            WHERE s.season = 2022 AND s.season_type = 'REG'
            ORDER BY s.rushing_yards DESC, p.full_name
            LIMIT 1
        """,
        tags=["season", "rushing", "leader"],
    ),
    GoldenCase(
        id="mahomes_pass_yards_2023",
        question="How many passing yards did Patrick Mahomes throw for in 2023?",
        reference_sql="""
            SELECT s.passing_yards
            FROM player_season_stats s JOIN players p USING (player_id)
            WHERE p.full_name = 'Patrick Mahomes'
              AND s.season = 2023 AND s.season_type = 'REG'
        """,
        tags=["season", "passing", "player"],
    ),
    GoldenCase(
        id="receiving_yards_top5_2023",
        question="Top 5 players by receiving yards in the 2023 regular season",
        reference_sql="""
            SELECT p.full_name, s.receiving_yards
            FROM player_season_stats s JOIN players p USING (player_id)
            WHERE s.season = 2023 AND s.season_type = 'REG'
            ORDER BY s.receiving_yards DESC, p.full_name
            LIMIT 5
        """,
        tags=["season", "receiving", "leaderboard"],
    ),
    GoldenCase(
        id="chiefs_wins_2023",
        question="How many regular-season games did the Kansas City Chiefs win in 2023?",
        reference_sql="""
            SELECT COUNT(*) AS wins
            FROM team_game_stats t JOIN games g USING (game_id)
            WHERE t.team_id = 'KC' AND g.season = 2023
              AND g.season_type = 'REG' AND t.result = 'W'
        """,
        tags=["team", "wins", "season"],
    ),
    GoldenCase(
        id="most_points_team_2023",
        question="Which team scored the most total points in the 2023 regular season?",
        reference_sql="""
            SELECT t.team_id, SUM(t.points_for) AS points
            FROM team_game_stats t JOIN games g USING (game_id)
            WHERE g.season = 2023 AND g.season_type = 'REG'
            GROUP BY t.team_id
            ORDER BY points DESC, t.team_id
            LIMIT 1
        """,
        tags=["team", "scoring", "season"],
    ),
    GoldenCase(
        id="highest_scoring_game_2023",
        question="What was the highest-scoring game of the 2023 regular season?",
        reference_sql="""
            SELECT game_id, (home_score + away_score) AS total_points
            FROM games
            WHERE season = 2023 AND season_type = 'REG'
            ORDER BY total_points DESC, game_id
            LIMIT 1
        """,
        tags=["game", "scoring"],
    ),
    GoldenCase(
        id="most_pass_tds_single_game_2023",
        question="What is the most passing touchdowns by a player in a single game in the 2023 regular season?",
        reference_sql="""
            SELECT p.full_name, pgs.passing_tds
            FROM player_game_stats pgs
            JOIN players p USING (player_id)
            JOIN games g USING (game_id)
            WHERE g.season = 2023 AND g.season_type = 'REG'
            ORDER BY pgs.passing_tds DESC, p.full_name
            LIMIT 1
        """,
        tags=["game", "passing", "leader"],
    ),
    GoldenCase(
        id="mahomes_pass_yards_2022_2024",
        question="How many total passing yards did Patrick Mahomes have across the 2022, 2023, and 2024 regular seasons?",
        reference_sql="""
            SELECT SUM(s.passing_yards) AS total_passing_yards
            FROM player_season_stats s JOIN players p USING (player_id)
            WHERE p.full_name = 'Patrick Mahomes' AND s.season_type = 'REG'
        """,
        tags=["multi-season", "passing", "player"],
    ),
    GoldenCase(
        id="rushing_tds_leader_2023",
        question="Who scored the most rushing touchdowns in the 2023 regular season?",
        reference_sql="""
            SELECT p.full_name, s.rushing_tds
            FROM player_season_stats s JOIN players p USING (player_id)
            WHERE s.season = 2023 AND s.season_type = 'REG'
            ORDER BY s.rushing_tds DESC, p.full_name
            LIMIT 1
        """,
        tags=["season", "rushing", "leader"],
    ),
    GoldenCase(
        id="most_receptions_2022",
        question="Who had the most receptions in the 2022 regular season?",
        reference_sql="""
            SELECT p.full_name, s.receptions
            FROM player_season_stats s JOIN players p USING (player_id)
            WHERE s.season = 2022 AND s.season_type = 'REG'
            ORDER BY s.receptions DESC, p.full_name
            LIMIT 1
        """,
        tags=["season", "receiving", "leader"],
    ),
    GoldenCase(
        id="games_count_2023",
        question="How many regular-season games were played in 2023?",
        reference_sql="""
            SELECT COUNT(*) AS games
            FROM games
            WHERE season = 2023 AND season_type = 'REG'
        """,
        tags=["games", "count"],
    ),
    # --- situational / advanced (play-by-play) --- #
    GoldenCase(
        id="most_offensive_plays_team_2023",
        question="Which team ran the most offensive plays in the 2023 regular season?",
        reference_sql="""
            SELECT p.posteam AS team, COUNT(*) AS plays
            FROM plays p JOIN games g USING (game_id)
            WHERE g.season = 2023 AND g.season_type = 'REG'
              AND p.play_type IN ('run', 'pass') AND p.posteam IS NOT NULL
            GROUP BY p.posteam
            ORDER BY plays DESC, team
            LIMIT 1
        """,
        tags=["plays", "team", "situational"],
    ),
    GoldenCase(
        id="highest_passing_epa_qb_2023",
        question="Which quarterback had the highest total passing EPA in the 2023 regular season?",
        reference_sql="""
            SELECT pl.full_name, SUM(p.epa) AS total_epa
            FROM plays p
            JOIN games g USING (game_id)
            JOIN players pl ON pl.player_id = p.passer_player_id
            WHERE g.season = 2023 AND g.season_type = 'REG'
              AND p.play_type = 'pass' AND p.epa IS NOT NULL
            GROUP BY pl.full_name
            ORDER BY total_epa DESC
            LIMIT 1
        """,
        tags=["plays", "epa", "passing", "advanced"],
    ),
    GoldenCase(
        id="most_explosive_runs_2022",
        question="Who had the most rushing attempts of 10 or more yards in the 2022 regular season?",
        reference_sql="""
            SELECT pl.full_name, COUNT(*) AS explosive_runs
            FROM plays p
            JOIN games g USING (game_id)
            JOIN players pl ON pl.player_id = p.rusher_player_id
            WHERE g.season = 2022 AND g.season_type = 'REG'
              AND p.play_type = 'run' AND p.yards_gained >= 10
            GROUP BY pl.full_name
            ORDER BY explosive_runs DESC, pl.full_name
            LIMIT 1
        """,
        tags=["plays", "rushing", "situational"],
    ),
]
