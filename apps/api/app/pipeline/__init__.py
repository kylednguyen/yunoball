"""The YunoBall query pipeline.

    cache lookup -> resolve entities -> classify intent (templated SQL)
                 -> [fallback: retrieve context -> free-form NL->SQL]
                 -> guard -> execute -> narrate -> enrich -> cache store
"""

from __future__ import annotations

from ..config import settings
from ..schemas import SearchRequest, SearchResponse
from .. import cache
from .resolve import resolve_entities
from .retrieve import retrieve_context
from .intent import build_sql, classify_intent
from .generate_sql import generate_sql
from .guard_sql import UnsafeSqlError, guard_sql
from .execute import execute_sql
from .narrate import narrate
from .enrich import enrich


async def _plan_sql(question: str, entities) -> str | None:
    """Try the safe intent->template path; return guarded SQL or None to fall back."""
    if not settings.llm_configured:
        return None
    plan = await classify_intent(question)
    if not plan:
        return None
    templated = build_sql(plan, entities)
    if not templated:
        return None
    try:
        return guard_sql(templated)
    except UnsafeSqlError:
        return None


async def run_query_pipeline(req: SearchRequest, *, use_cache: bool = True) -> SearchResponse:
    question = req.question

    if use_cache:
        cached = await cache.get_cached(question)
        if cached is not None:
            return SearchResponse(**{**cached, "cached": True})

    entities = await resolve_entities(question)

    safe_sql = await _plan_sql(question, entities)
    if safe_sql is None:
        # Fall back to free-form NL->SQL grounded with schema + few-shot.
        context = await retrieve_context(question)
        raw_sql = await generate_sql(question=question, entities=entities, context=context)
        safe_sql = guard_sql(raw_sql)

    rows, columns = await execute_sql(safe_sql)
    narration = await narrate(question=question, rows=rows)

    extras = enrich(
        question=question, sql=safe_sql, rows=rows, columns=columns, entities=entities
    )

    response = SearchResponse(
        question=question,
        narration=narration,
        sql=safe_sql,
        rows=rows,
        columns=columns,
        entities=entities,
        cached=False,
        share_id=cache.share_id(question),
        **extras,
    )

    if use_cache:
        await cache.set_cached(question, response.model_dump())
        cache.persist_answer(response.model_dump())  # durable + shareable
    return response
