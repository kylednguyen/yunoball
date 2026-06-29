"""Stage 5 — Narrate the result.

Turn the SQL result into a concise, StatMuse-style natural-language answer. The
data table is rendered alongside, so this is a one/two-sentence lede, never the
source of the numbers.
"""

from __future__ import annotations

import json
from typing import Any

from .. import llm
from ..config import settings
from ..mock_nl2sql import mock_narrate

SYSTEM = (
    "Write a one or two sentence answer to the NFL question using ONLY the "
    "provided rows. Be precise with numbers. Do not invent data. No markdown."
)


async def narrate(*, question: str, rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "No matching results found."

    if settings.use_mock_llm:
        return mock_narrate(question, rows)

    user = (
        f"Question: {question}\n"
        f"Data (JSON rows):\n{json.dumps(rows[:25], default=str)}"
    )
    return await llm.complete(
        model=settings.narrate_model, system=SYSTEM, user=user, max_tokens=300
    )
