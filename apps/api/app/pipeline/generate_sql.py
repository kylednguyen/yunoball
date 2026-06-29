"""Stage 3 — NL -> SQL generation.

Grounded with resolved entities and the retrieved schema/few-shot context.
Returns raw SQL; `guard_sql` validates it before execution.
"""

from __future__ import annotations

import re

from .. import llm
from ..config import settings
from ..mock_nl2sql import mock_generate_sql
from ..schemas import ResolvedEntity
from .retrieve import RetrievedContext

SYSTEM = """You translate natural-language NFL questions into a single read-only PostgreSQL SELECT query.
Rules:
- Output ONLY the SQL. No prose, no markdown fences.
- SELECT only. Never write DDL/DML. Single statement.
- Use the provided schema and resolved entity ids. Filter on ids, not name strings, when ids are given.
- Prefer player_season_stats for season/career totals; player_game_stats for per-game.
- Always include a sensible LIMIT.

Schema:
{schema}"""


async def generate_sql(
    *, question: str, entities: list[ResolvedEntity], context: RetrievedContext
) -> str:
    # No API key: deterministic rule-based generation (works against the
    # SQLite demo or a real Postgres alike).
    if settings.use_mock_llm:
        return mock_generate_sql(question)

    few_shot = "\n\n".join(
        f"Q: {e['question']}\nSQL: {e['sql']}" for e in context.examples
    )
    entity_block = (
        "\n".join(
            f'- "{e.mention}" -> {e.entity_type} {e.canonical_id} ({e.display_name})'
            for e in entities
        )
        or "(none resolved)"
    )

    user = "\n".join(
        part
        for part in [
            f"Examples:\n{few_shot}\n" if few_shot else "",
            f"Resolved entities:\n{entity_block}\n",
            f"Question: {question}",
            "SQL:",
        ]
        if part
    )

    text = await llm.complete(
        model=settings.sql_model,
        system=SYSTEM.format(schema=context.schema_doc),
        user=user,
        max_tokens=1024,
    )
    # Strip accidental code fences.
    return re.sub(r"^```sql\s*|\s*```$", "", text, flags=re.IGNORECASE).strip()
