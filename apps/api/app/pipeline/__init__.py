"""The YunoBall query pipeline.

    cache lookup -> resolve entities -> retrieve context -> NL->SQL
                 -> guard -> execute -> narrate -> cache store
"""

from __future__ import annotations

from ..schemas import SearchRequest, SearchResponse
from .. import cache
from .resolve import resolve_entities
from .retrieve import retrieve_context
from .generate_sql import generate_sql
from .guard_sql import guard_sql
from .execute import execute_sql
from .narrate import narrate


async def run_query_pipeline(req: SearchRequest) -> SearchResponse:
    question = req.question

    cached = await cache.get_cached(question)
    if cached is not None:
        return SearchResponse(**{**cached, "cached": True})

    entities = await resolve_entities(question)
    context = await retrieve_context(question)

    raw_sql = await generate_sql(question=question, entities=entities, context=context)
    safe_sql = guard_sql(raw_sql)

    rows, columns = await execute_sql(safe_sql)
    narration = await narrate(question=question, rows=rows)

    response = SearchResponse(
        question=question,
        narration=narration,
        sql=safe_sql,
        rows=rows,
        columns=columns,
        entities=entities,
        cached=False,
    )

    await cache.set_cached(question, response.model_dump())
    return response
