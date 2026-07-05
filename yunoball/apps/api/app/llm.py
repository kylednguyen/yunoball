"""OpenAI client wrapper — chat completions + embeddings."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .config import settings

if TYPE_CHECKING:
    from openai import AsyncOpenAI

_client: "AsyncOpenAI | None" = None


def get_client() -> "AsyncOpenAI":
    # Imported lazily so demo mode runs without the openai package configured.
    global _client
    if _client is None:
        from openai import AsyncOpenAI

        _client = AsyncOpenAI(api_key=settings.openai_api_key)
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
