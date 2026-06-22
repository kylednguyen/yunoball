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


class SearchResponse(BaseModel):
    question: str
    narration: str
    sql: str  # the validated SQL we ran — surfaced for transparency
    rows: list[dict[str, Any]]
    columns: list[str]
    entities: list[ResolvedEntity]
    cached: bool
