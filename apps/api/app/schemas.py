"""API request/response models."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class SearchRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    # Prior turns enable conversational follow-ups ("...and in the playoffs?").
    history: list[HistoryTurn] = Field(default_factory=list)


class ResolvedEntity(BaseModel):
    mention: str
    entity_type: Literal["player", "team"]
    canonical_id: str
    display_name: str
    confidence: float


class StatChip(BaseModel):
    label: str  # e.g. "1,459 YDS"
    category: str  # passing | rushing | receiving | scoring | record | advanced | general


class PrimaryStat(BaseModel):
    """The headline of the answer card — the one big number + who/when."""

    subject: str | None = None  # "Christian McCaffrey"
    subject_type: str | None = None  # player | team
    value: str | None = None  # formatted big number, e.g. "1,459"
    unit: str | None = None  # "rushing yards"
    context: str | None = None  # "2023 regular season"


class ComparisonCard(BaseModel):
    label: str  # "This season" / "Per game" / "Last 5 games" / "League rank"
    value: str
    note: str | None = None


class Suggestion(BaseModel):
    label: str  # short, e.g. "Playoffs only"
    query: str  # the question to re-run


class SourceInfo(BaseModel):
    label: str = "nflverse"
    coverage: str = "2022–2024 · regular & postseason"
    freshness: str = "Final"  # Final | Live | Projected
    updated: str | None = None  # data-through date
    warnings: list[str] = Field(default_factory=list)


class SearchResponse(BaseModel):
    question: str
    narration: str
    sql: str  # the validated SQL we ran — surfaced for transparency
    rows: list[dict[str, Any]]
    columns: list[str]
    entities: list[ResolvedEntity]
    cached: bool
    share_id: str | None = None  # stable handle for the shareable answer page

    # Answer-first presentation layer (numbers derived from rows, never invented)
    query_type: str | None = None
    interpretation: str | None = None
    primary: PrimaryStat | None = None
    chips: list[StatChip] = Field(default_factory=list)
    comparisons: list[ComparisonCard] = Field(default_factory=list)
    alternatives: list[Suggestion] = Field(default_factory=list)
    followups: list[str] = Field(default_factory=list)
    source: SourceInfo | None = None
