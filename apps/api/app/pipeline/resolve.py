"""Stage 1 — Entity resolution.

Map free-text mentions ("Mahomes", "the Chiefs", "Pat Mahomes") to canonical
player/team ids. Strategy: pg_trgm fuzzy match against `entity_aliases`,
backstopped by pgvector cosine similarity, with the LLM disambiguating ties.
Resolved ids are injected into the NL->SQL prompt so the model filters on
stable keys instead of guessing string matches.

TODO(phase-2): implement trigram + vector lookup over entity_aliases.
"""

from __future__ import annotations

from ..schemas import ResolvedEntity


async def resolve_entities(_question: str) -> list[ResolvedEntity]:
    return []
