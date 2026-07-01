"""The YunoBall query pipeline.

  L1 cache (text / semantic)
   → fuzzy entity resolve
   → parse to QuerySpec (rules fast-path, else LLM function-call)
   → L2 cache (spec)
   → trusted SQL template (bound params)
   → execute (read-only, timeout)
   → templated narration + table
   → write L1/L2

Falls back to raw NL->SQL (guarded) for anything that doesn't parse.
"""

from __future__ import annotations

from ..schemas import SearchRequest, SearchResponse
from ..config import settings
from .. import cache
from ..query import Intent, parse_rules, parse_llm, build_sql, narrate_spec
from .resolve import resolve_entities
from .retrieve import retrieve_context
from .generate_sql import generate_sql
from .guard_sql import guard_sql
from .execute import execute_sql
from .narrate import narrate


async def run_query_pipeline(req: SearchRequest) -> SearchResponse:
    question = req.question

    # --- L1: front-loaded cache (exact, then semantic) ---
    hit = await cache.get(cache.text_key(question)) or await cache.semantic_lookup(question)
    if hit is not None:
        return SearchResponse(**{**hit, "cached": True})

    # --- Entity resolution + parse to a structured spec ---
    entities = await resolve_entities(question)
    spec = parse_rules(question, entities)
    if spec is None and not settings.use_mock_llm:
        spec = await parse_llm(question)

    if spec is not None:
        # Attach the resolved canonical id if the parser didn't already.
        if spec.intent is Intent.PLAYER_TOTAL and not spec.player_id and entities:
            spec.player_id = entities[0].canonical_id
            spec.player = spec.player or entities[0].display_name

        # --- L2: spec-keyed cache (dedupes phrasings that map to one spec) ---
        skey = cache.spec_key(spec.cache_key())
        hit = await cache.get(skey)
        if hit is not None:
            await cache.set(cache.text_key(question), hit)
            return SearchResponse(**{**hit, "cached": True})

        sql, params = build_sql(spec)
        rows, columns = await execute_sql(sql, params)
        response = SearchResponse(
            question=question,
            narration=narrate_spec(spec, rows),
            sql=sql,
            rows=rows,
            columns=columns,
            entities=entities,
            cached=False,
        )
        payload = response.model_dump()
        await cache.set(cache.text_key(question), payload)
        await cache.set(skey, payload)
        return response

    # --- Long-tail fallback: raw NL -> SQL (guarded) ---
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
    await cache.set(cache.text_key(question), response.model_dump())
    return response
