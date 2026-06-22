"""OpenAI client wrapper — chat completions + embeddings."""

from __future__ import annotations

from openai import AsyncOpenAI

from .config import settings

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
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
