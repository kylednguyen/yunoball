"""OpenAI client wrapper.

The LLM's only job is parsing a question into a QuerySpec (a tool call), so this
is a thin lazy client — no completion or embedding helpers.
"""

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
