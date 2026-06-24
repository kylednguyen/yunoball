"""OpenAI client wrapper — chat completions + embeddings."""

from __future__ import annotations

from openai import AsyncOpenAI

from .config import settings

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        # base_url lets us target any OpenAI-compatible server (e.g. Ollama).
        # Local Ollama ignores the key, but the SDK requires a non-empty one.
        _client = AsyncOpenAI(
            api_key=settings.openai_api_key or "not-needed",
            base_url=settings.llm_base_url,
        )
    return _client


async def complete(*, model: str, system: str, user: str, max_tokens: int) -> str:
    resp = await get_client().chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return (resp.choices[0].message.content or "").strip()


async def complete_json(*, model: str, system: str, user: str, max_tokens: int) -> dict:
    """Chat completion constrained to a JSON object. Tolerant of models that wrap
    the object in prose/fences — extracts the first {...} and parses it."""
    import json
    import re

    try:
        resp = await get_client().chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
    except Exception:
        # Some endpoints reject response_format; retry without it.
        resp = await get_client().chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
    text = (resp.choices[0].message.content or "").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    return {}


async def embed(text: str) -> list[float]:
    resp = await get_client().embeddings.create(
        model=settings.embedding_model, input=text
    )
    return resp.data[0].embedding


async def embed_many(texts: list[str], *, batch_size: int = 1000) -> list[list[float]]:
    """Embed many texts, batched (the embeddings API accepts a list per call)."""
    out: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        chunk = texts[i : i + batch_size]
        resp = await get_client().embeddings.create(
            model=settings.embedding_model, input=chunk
        )
        out.extend(d.embedding for d in resp.data)
    return out
