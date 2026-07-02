"""Stage 0: condense conversational follow-ups into a standalone question.

When the request carries history, an LLM rewrites the follow-up ("...and in
the playoffs?") into a self-contained question using the prior turns. The rest
of the pipeline (entity resolution, intent classification, SQL generation,
and the cache key) only ever sees the standalone form, so no other stage
needs to know about conversation state.

Degrades gracefully: with no history, no configured LLM, or an LLM failure,
the raw question passes through unchanged.
"""

from __future__ import annotations

import logging

from .. import llm
from ..config import settings
from ..schemas import HistoryTurn

log = logging.getLogger("yunoball.condense")

MAX_TURNS = 6  # the most recent turns are enough to resolve a follow-up

SYSTEM = """You rewrite a follow-up NFL stats question into a single standalone question.
Use the conversation so far to fill in whatever the follow-up leaves implicit
(player, team, stat, season, game). Keep the follow-up's own constraints.
If the question already stands alone, output it unchanged.
Output ONLY the rewritten question, with no prose and no quotes."""


async def condense_question(question: str, history: list[HistoryTurn]) -> str:
    """Return the standalone form of `question` given prior conversation turns."""
    if not history or not settings.llm_configured:
        return question

    transcript = "\n".join(f"{t.role}: {t.content}" for t in history[-MAX_TURNS:])
    user = (
        f"Conversation so far:\n{transcript}\n\n"
        f"Follow-up: {question}\n\n"
        "Standalone question:"
    )
    try:
        rewritten = await llm.complete(
            model=settings.sql_model, system=SYSTEM, user=user, max_tokens=150
        )
    except Exception:  # noqa: BLE001
        log.warning("follow-up condensing failed; using the raw question", exc_info=True)
        return question

    rewritten = rewritten.strip().strip('"').strip()
    return rewritten if rewritten else question
