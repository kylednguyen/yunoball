"""The YunoBall query pipeline.

  L1 cache (text / semantic)
   → fuzzy entity resolve
   → parse to QuerySpec (rules fast-path, else LLM function-call)
   → L2 cache (spec)
   → trusted SQL template (bound params)
   → execute (read-only, timeout)
   → templated narration + table
   → write L1/L2 + durable shareable store

Falls back to raw NL->SQL (guarded) for anything that doesn't parse (real LLM).
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


async def _finalize(response: SearchResponse, *, use_cache: bool, spec_key: str | None) -> SearchResponse:
    """Write the answer to L1/L2 cache and the durable shareable store."""
    if not use_cache:
        return response
    payload = response.model_dump()
    await cache.set(cache.text_key(response.question), payload)
    if spec_key is not None:
        await cache.set(spec_key, payload)
    cache.persist_answer(payload)  # best-effort; no-op in the SQLite demo
    return response


async def run_query_pipeline(
    req: SearchRequest, *, use_cache: bool = True
) -> SearchResponse:
    question = req.question

    # --- L1: front-loaded cache (exact, then semantic) ---
    if use_cache:
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
        if use_cache:
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
            share_id=cache.share_id(question),
        )
        return await _finalize(response, use_cache=use_cache, spec_key=skey)

    # --- Nothing parsed to a spec ---
    # The key-less rule-based engine can only answer structured shapes; be
    # honest rather than guess. The raw NL->SQL fallback needs a real LLM.
    if settings.use_mock_llm:
        return SearchResponse(
            question=question,
            narration=(
                "I can't answer that one yet — try a stats question like "
                "\"most passing yards in 2023\" or \"Patrick Mahomes career "
                "passing touchdowns\"."
            ),
            sql="",
            rows=[],
            columns=[],
            entities=entities,
            cached=False,
            share_id=cache.share_id(question),
        )

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
        share_id=cache.share_id(question),
    )
    return await _finalize(response, use_cache=use_cache, spec_key=None)
