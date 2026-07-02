"""YunoBall warehouse schema — a star model over nflverse data.

  Dimensions: seasons, teams, players, games
  Facts:      player_game_stats, team_game_stats
  Rollups:    player_season_stats
  Resolve:    entity_aliases  (pg_trgm fuzzy match, optional pgvector)
  Cache:      answer_cache    (durable, shareable answers)

The warehouse is intentionally box-score grained: no play-by-play, EPA, or
win-probability tables. V1 answers leaderboards, player/team totals, and
single-game records — none of which need sub-game detail.
"""

from __future__ import annotations

from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

EMBED_DIM = 1536  # OpenAI text-embedding-3-small


# ------------------------------- Dimensions ------------------------------- #


class Season(Base):
    __tablename__ = "seasons"
    season: Mapped[int] = mapped_column(Integer, primary_key=True)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)


class Team(Base):
    __tablename__ = "teams"
    team_id: Mapped[str] = mapped_column(String, primary_key=True)  # e.g. "KC"
    name: Mapped[str] = mapped_column(String, nullable=False)
    nickname: Mapped[str | None] = mapped_column(String)
    conference: Mapped[str | None] = mapped_column(String)  # AFC | NFC
    division: Mapped[str | None] = mapped_column(String)


class Player(Base):
    __tablename__ = "players"
    player_id: Mapped[str] = mapped_column(String, primary_key=True)  # gsis_id
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    first_name: Mapped[str | None] = mapped_column(String)
    last_name: Mapped[str | None] = mapped_column(String)
    position: Mapped[str | None] = mapped_column(String)
    birth_date: Mapped[date | None] = mapped_column(Date)
    height_inches: Mapped[int | None] = mapped_column(SmallInteger)
    weight_lbs: Mapped[int | None] = mapped_column(SmallInteger)
    college: Mapped[str | None] = mapped_column(String)
    rookie_season: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (Index("players_full_name_idx", "full_name"),)


class Game(Base):
    __tablename__ = "games"
    game_id: Mapped[str] = mapped_column(String, primary_key=True)
    season: Mapped[int] = mapped_column(ForeignKey("seasons.season"), nullable=False)
    week: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    season_type: Mapped[str] = mapped_column(String, nullable=False, default="REG")
    game_date: Mapped[date | None] = mapped_column(Date)
    home_team: Mapped[str] = mapped_column(ForeignKey("teams.team_id"), nullable=False)
    away_team: Mapped[str] = mapped_column(ForeignKey("teams.team_id"), nullable=False)
    home_score: Mapped[int | None] = mapped_column(SmallInteger)
    away_score: Mapped[int | None] = mapped_column(SmallInteger)
    stadium: Mapped[str | None] = mapped_column(String)
    roof: Mapped[str | None] = mapped_column(String)
    surface: Mapped[str | None] = mapped_column(String)

    __table_args__ = (
        Index("games_season_week_idx", "season", "week"),
        Index("games_home_team_idx", "home_team"),
        Index("games_away_team_idx", "away_team"),
    )


# --------------------------------- Facts ---------------------------------- #


class PlayerGameStats(Base):
    __tablename__ = "player_game_stats"
    player_id: Mapped[str] = mapped_column(
        ForeignKey("players.player_id"), primary_key=True
    )
    game_id: Mapped[str] = mapped_column(
        ForeignKey("games.game_id"), primary_key=True
    )
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.team_id"), nullable=False)

    # passing
    completions: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    attempts: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    passing_yards: Mapped[int | None] = mapped_column(Integer, default=0)
    passing_tds: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    interceptions: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    sacks: Mapped[float | None] = mapped_column(Float, default=0)
    # rushing
    carries: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    rushing_yards: Mapped[int | None] = mapped_column(Integer, default=0)
    rushing_tds: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    # receiving
    targets: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    receptions: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    receiving_yards: Mapped[int | None] = mapped_column(Integer, default=0)
    receiving_tds: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    # shared
    fumbles: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    fumbles_lost: Mapped[int | None] = mapped_column(SmallInteger, default=0)

    __table_args__ = (
        Index("pgs_game_idx", "game_id"),
        Index("pgs_team_idx", "team_id"),
    )


class TeamGameStats(Base):
    __tablename__ = "team_game_stats"
    team_id: Mapped[str] = mapped_column(
        ForeignKey("teams.team_id"), primary_key=True
    )
    game_id: Mapped[str] = mapped_column(
        ForeignKey("games.game_id"), primary_key=True
    )
    is_home: Mapped[bool] = mapped_column(Boolean, nullable=False)
    points_for: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    points_against: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    total_yards: Mapped[int | None] = mapped_column(Integer, default=0)
    passing_yards: Mapped[int | None] = mapped_column(Integer, default=0)
    rushing_yards: Mapped[int | None] = mapped_column(Integer, default=0)
    turnovers: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    time_of_possession_sec: Mapped[int | None] = mapped_column(Integer)
    result: Mapped[str | None] = mapped_column(String)  # W | L | T

    __table_args__ = (Index("tgs_game_idx", "game_id"),)


# --------------------------------- Rollups -------------------------------- #


class PlayerSeasonStats(Base):
    __tablename__ = "player_season_stats"
    player_id: Mapped[str] = mapped_column(
        ForeignKey("players.player_id"), primary_key=True
    )
    season: Mapped[int] = mapped_column(
        ForeignKey("seasons.season"), primary_key=True
    )
    season_type: Mapped[str] = mapped_column(String, primary_key=True, default="REG")
    team_id: Mapped[str | None] = mapped_column(String)
    games_played: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    # passing (completions/attempts back the completion% and passer-rating stats)
    completions: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    attempts: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    passing_yards: Mapped[int | None] = mapped_column(Integer, default=0)
    passing_tds: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    interceptions: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    sacks: Mapped[float | None] = mapped_column(Float, default=0)
    # rushing
    rushing_yards: Mapped[int | None] = mapped_column(Integer, default=0)
    rushing_tds: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    # receiving
    targets: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    receptions: Mapped[int | None] = mapped_column(SmallInteger, default=0)
    receiving_yards: Mapped[int | None] = mapped_column(Integer, default=0)
    receiving_tds: Mapped[int | None] = mapped_column(SmallInteger, default=0)

    __table_args__ = (Index("pss_season_idx", "season"),)


# ----------------------------- RAG (pgvector) ----------------------------- #


class EntityAlias(Base):
    """Maps messy mentions ("Mahomes", "Pat Mahomes") to canonical ids.

    Resolution = pg_trgm fuzzy match + pgvector cosine similarity.
    """

    __tablename__ = "entity_aliases"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)  # player | team
    canonical_id: Mapped[str] = mapped_column(String, nullable=False)
    alias: Mapped[str] = mapped_column(String, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))

    __table_args__ = (
        # GIN trigram index powers fuzzy `alias % :mention` lookups.
        Index(
            "entity_aliases_alias_trgm_idx",
            "alias",
            postgresql_using="gin",
            postgresql_ops={"alias": "gin_trgm_ops"},
        ),
        Index("entity_aliases_canonical_idx", "entity_type", "canonical_id"),
        Index(
            "entity_aliases_embedding_idx",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


class AnswerCache(Base):
    """Postgres-side semantic cache (Redis fronts it for hot keys)."""

    __tablename__ = "answer_cache"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Stable, shareable handle (digest of the normalized question) for /a/<id>.
    share_id: Mapped[str | None] = mapped_column(String, unique=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_question: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    sql: Mapped[str | None] = mapped_column(Text)
    answer_json: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    hits: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index(
            "answer_cache_embedding_idx",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )
