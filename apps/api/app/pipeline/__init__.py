"""The YunoBall query pipeline.

Two lookup paths:
  1. Structured (fast): NL -> QuerySpec (rules, else LLM function-call) ->
     deterministic SQL builder -> DB -> templated narration. No SQL guard,
     no second LLM call.
  2. Long-tail fallback: raw NL -> SQL -> guard -> execute -> LLM narration.

(Answer-cache lookup/store wraps both.)
"""

from __future__ import annotations

from ..schemas import SearchRequest, SearchResponse
from ..config import settings
from .. import cache
from ..query import parse_rules, build_sql, narrate_spec
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

    # --- Path 1: structured QuerySpec (fast, no guard, no 2nd LLM call) ---
    spec = parse_rules(question)
    # (prod) LLM function-calling fallback for the long tail would go here:
    #   if spec is None and not settings.use_mock_llm: spec = await parse_llm(question)

    if spec is not None:
        sql, params = build_sql(spec)
        rows, columns = await execute_sql(sql, params)
        response = SearchResponse(
            question=question,
            narration=narrate_spec(spec, rows),
            sql=sql,
            rows=rows,
            columns=columns,
            entities=[],
            cached=False,
        )
        await cache.set_cached(question, response.model_dump())
        return response

    # --- Path 2: raw NL -> SQL fallback ---
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
