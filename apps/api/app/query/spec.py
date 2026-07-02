"""The QuerySpec — a typed intermediate representation between natural language
and SQL.

The LLM (or the rule-based parser) produces one of these small structured
objects instead of raw SQL. A deterministic builder turns it into safe,
parameterized SQL, so there is no injection surface and no SQL guard needed on
this path. The spec also doubles as a stable cache key.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable

from pydantic import BaseModel, Field, model_validator


class Intent(str, Enum):
    LEADERS = "leaders"          # top-N players by a stat, optionally in a season
    PLAYER_TOTAL = "player_total"  # one player's season or career total
    SINGLE_GAME = "single_game"   # best single-game marks for a stat
    TEAM_STAT = "team_stat"       # a team's record / points / yards, or a team leaderboard


# --------------------------------------------------------------------------- #
# Stat whitelist.
#
# Every supported statistic lives here. A stat is one of two shapes:
#   - direct:  a column we SUM (career) or read as-is (season / single game)
#   - derived: a ratio/formula built from component columns (completion %,
#              passer rating). Derived stats can't be summed, so they recompute
#              from component sums for career totals.
#
# `expr(alias, career)` returns the SELECT value expression. It only ever
# interpolates the table alias and hardcoded column names from this file —
# never user input — so it is safe to embed in SQL. Unknown stats are rejected
# by QuerySpec validation before any SQL is built.
# --------------------------------------------------------------------------- #


def _col(alias: str, col: str, career: bool) -> str:
    return f"SUM({alias}.{col})" if career else f"{alias}.{col}"


def _clamp(x: str) -> str:
    """NFL passer-rating component clamp to [0, 2.375] — portable (no LEAST/GREATEST)."""
    return f"(CASE WHEN ({x}) < 0 THEN 0 WHEN ({x}) > 2.375 THEN 2.375 ELSE ({x}) END)"


def _direct(col: str) -> Callable[[str, bool], str]:
    return lambda a, career: _col(a, col, career)


def _ratio(num: str, den: str) -> Callable[[str, bool], str]:
    def expr(a: str, career: bool) -> str:
        n, d = _col(a, num, career), _col(a, den, career)
        return f"ROUND(100.0 * {n} / NULLIF({d}, 0), 1)"
    return expr


def _passer_rating() -> Callable[[str, bool], str]:
    def expr(a: str, career: bool) -> str:
        att = f"NULLIF({_col(a, 'attempts', career)}, 0)"
        comp = _col(a, "completions", career)
        yds = _col(a, "passing_yards", career)
        td = _col(a, "passing_tds", career)
        ints = _col(a, "interceptions", career)
        ta = _clamp(f"({comp} * 1.0 / {att} - 0.3) * 5")
        tb = _clamp(f"({yds} * 1.0 / {att} - 3) * 0.25")
        tc = _clamp(f"({td} * 1.0 / {att}) * 20")
        td_ = _clamp(f"2.375 - ({ints} * 1.0 / {att}) * 25")
        return f"ROUND(({ta} + {tb} + {tc} + {td_}) / 6.0 * 100, 1)"
    return expr


@dataclass(frozen=True)
class StatDef:
    label: str
    expr: Callable[[str, bool], str]
    # Minimum-attempts qualifier for rate stats so a tiny sample can't top the
    # board (a backup going 1-for-1 shouldn't lead passer rating). `{a}` = alias.
    # Season/career leaderboards use `leader_min`; single-game boards use the
    # much lower `game_min` (100 attempts is impossible in one game).
    leader_min: str | None = None
    game_min: str | None = None


STATS: dict[str, StatDef] = {
    "passing_yards": StatDef("passing yards", _direct("passing_yards")),
    "passing_tds": StatDef("passing touchdowns", _direct("passing_tds")),
    "interceptions": StatDef("interceptions", _direct("interceptions")),
    "completion_percentage": StatDef(
        "completion percentage", _ratio("completions", "attempts"),
        leader_min="{a}.attempts >= 100", game_min="{a}.attempts >= 10",
    ),
    "passer_rating": StatDef(
        "passer rating", _passer_rating(),
        leader_min="{a}.attempts >= 100", game_min="{a}.attempts >= 10",
    ),
    "rushing_yards": StatDef("rushing yards", _direct("rushing_yards")),
    "rushing_tds": StatDef("rushing touchdowns", _direct("rushing_tds")),
    "receiving_yards": StatDef("receiving yards", _direct("receiving_yards")),
    "receptions": StatDef("receptions", _direct("receptions")),
    "receiving_tds": StatDef("receiving touchdowns", _direct("receiving_tds")),
    "targets": StatDef("targets", _direct("targets")),
    "sacks": StatDef("sacks taken", _direct("sacks")),
}


# --------------------------------------------------------------------------- #
# Team-stat whitelist (Intent.TEAM_STAT), aggregated over team_game_stats.
#
# `record` is special — it returns wins/losses/ties together, not one number —
# so its expression is None and build_sql handles it explicitly. The rest map
# to a single aggregate expression (`{a}` = table alias). Values are hardcoded,
# never user input, so they are safe to interpolate.
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class TeamStatDef:
    label: str
    expr: str | None  # None => the `record` special-case
    # Minimum games for a team to appear on a per-game leaderboard, so a team
    # with one blowout can't top "highest scoring offense" on a tiny sample.
    min_games: int | None = None


TEAM_STATS: dict[str, TeamStatDef] = {
    "record": TeamStatDef("record", None),
    "wins": TeamStatDef("wins", "SUM(CASE WHEN {a}.result = 'W' THEN 1 ELSE 0 END)"),
    "losses": TeamStatDef("losses", "SUM(CASE WHEN {a}.result = 'L' THEN 1 ELSE 0 END)"),
    "points": TeamStatDef("points", "SUM({a}.points_for)"),
    "points_per_game": TeamStatDef("points per game", "ROUND(AVG({a}.points_for * 1.0), 1)", min_games=3),
    "yards": TeamStatDef("yards", "SUM({a}.total_yards)"),
    "yards_per_game": TeamStatDef("yards per game", "ROUND(AVG({a}.total_yards * 1.0), 1)", min_games=3),
}


class QuerySpec(BaseModel):
    intent: Intent
    stat: str
    season: int | None = None
    season_type: str = "REG"
    player: str | None = None          # display name (for narration / LIKE fallback)
    player_id: str | None = None       # canonical id from the resolver (preferred)
    team: str | None = None            # team display name (narration)
    team_id: str | None = None         # canonical team id, e.g. "BUF"
    scope: str = "season"              # "season" | "career" (PLAYER_TOTAL)
    limit: int = Field(default=10, ge=1, le=100)

    @model_validator(mode="after")
    def _known_stat(self) -> "QuerySpec":
        # The stat must belong to the whitelist that matches the intent, so a
        # player intent can't smuggle in a team stat (and vice versa).
        allowed = TEAM_STATS if self.intent is Intent.TEAM_STAT else STATS
        if self.stat not in allowed:
            raise ValueError(f"unknown stat for {self.intent.value}: {self.stat}")
        return self

    def label(self) -> str:
        if self.intent is Intent.TEAM_STAT:
            return TEAM_STATS[self.stat].label
        return STATS[self.stat].label

    def team_expr(self, alias: str) -> str | None:
        tmpl = TEAM_STATS[self.stat].expr
        return tmpl.format(a=alias) if tmpl else None

    def team_min_games(self) -> int | None:
        return TEAM_STATS[self.stat].min_games

    def value_expr(self, alias: str, *, career: bool = False) -> str:
        return STATS[self.stat].expr(alias, career)

    def leader_min(self, alias: str) -> str | None:
        q = STATS[self.stat].leader_min
        return q.format(a=alias) if q else None

    def game_min(self, alias: str) -> str | None:
        q = STATS[self.stat].game_min
        return q.format(a=alias) if q else None

    def cache_key(self) -> str:
        # Must include every field build_sql() depends on — notably player_id
        # and team_id, since two players/teams can share a display name.
        return "|".join(
            str(x) for x in (
                self.intent.value, self.stat, self.season, self.season_type,
                (self.player or "").lower(), self.player_id,
                self.team_id, self.scope, self.limit,
            )
        )
