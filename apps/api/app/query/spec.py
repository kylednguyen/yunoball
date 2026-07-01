"""The QuerySpec — a typed intermediate representation between natural language
and SQL.

The LLM (or the rule-based parser) produces one of these small structured
objects instead of raw SQL. A deterministic builder turns it into safe,
parameterized SQL, so there is no injection surface and no SQL guard needed on
this path. The spec also doubles as a stable cache key.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, field_validator


class Intent(str, Enum):
    LEADERS = "leaders"          # top-N players by a stat, optionally in a season
    PLAYER_TOTAL = "player_total"  # one player's season or career total
    SINGLE_GAME = "single_game"   # best single-game marks for a stat


# Allowlisted stat -> (column, human label). The column is only ever taken from
# this map, never from free text, so it is safe to interpolate into SQL.
STATS: dict[str, tuple[str, str]] = {
    "passing_yards": ("passing_yards", "passing yards"),
    "passing_tds": ("passing_tds", "passing touchdowns"),
    "interceptions": ("interceptions", "interceptions"),
    "rushing_yards": ("rushing_yards", "rushing yards"),
    "rushing_tds": ("rushing_tds", "rushing touchdowns"),
    "receptions": ("receptions", "receptions"),
    "receiving_yards": ("receiving_yards", "receiving yards"),
    "receiving_tds": ("receiving_tds", "receiving touchdowns"),
}


class QuerySpec(BaseModel):
    intent: Intent
    stat: str
    season: int | None = None
    season_type: str = "REG"
    player: str | None = None          # display name (for narration / LIKE fallback)
    player_id: str | None = None       # canonical id from the resolver (preferred)
    scope: str = "season"              # "season" | "career" (PLAYER_TOTAL)
    limit: int = Field(default=10, ge=1, le=100)

    @field_validator("stat")
    @classmethod
    def _known_stat(cls, v: str) -> str:
        if v not in STATS:
            raise ValueError(f"unknown stat: {v}")
        return v

    def column(self) -> str:
        return STATS[self.stat][0]

    def label(self) -> str:
        return STATS[self.stat][1]

    def cache_key(self) -> str:
        # Must include every field build_sql() depends on — notably player_id,
        # since two players can share a display name.
        return "|".join(
            str(x) for x in (
                self.intent.value, self.stat, self.season, self.season_type,
                (self.player or "").lower(), self.player_id, self.scope, self.limit,
            )
        )
