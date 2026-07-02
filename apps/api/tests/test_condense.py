"""Tests for follow-up condensing (LLM mocked; no network, no DB)."""

from __future__ import annotations

import asyncio

import pytest

from app.config import settings
from app.pipeline import condense
from app.schemas import HistoryTurn, SearchRequest

HISTORY = [
    HistoryTurn(role="user", content="How many passing yards did Patrick Mahomes have in 2023?"),
    HistoryTurn(role="assistant", content="Patrick Mahomes threw for 4,183 yards in 2023."),
]

STANDALONE = "How many passing yards did Patrick Mahomes have in the 2023 playoffs?"


def _llm_configured(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "test-key")


def test_no_history_passes_question_through(monkeypatch):
    _llm_configured(monkeypatch)
    monkeypatch.setattr(
        condense.llm, "complete", lambda **kw: pytest.fail("LLM should not be called")
    )
    q = "Who led the NFL in rushing in 2023?"
    assert asyncio.run(condense.condense_question(q, [])) == q


def test_no_llm_configured_skips_rewriting(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", None)
    monkeypatch.setattr(settings, "llm_base_url", None)
    q = "and in the playoffs?"
    assert asyncio.run(condense.condense_question(q, HISTORY)) == q


def test_rewrites_follow_up_using_history(monkeypatch):
    _llm_configured(monkeypatch)
    captured = {}

    async def fake_complete(*, model, system, user, max_tokens):
        captured["user"] = user
        return STANDALONE

    monkeypatch.setattr(condense.llm, "complete", fake_complete)
    out = asyncio.run(condense.condense_question("and in the playoffs?", HISTORY))
    assert out == STANDALONE
    # The prior turns made it into the rewrite prompt.
    assert "Patrick Mahomes" in captured["user"]
    assert "and in the playoffs?" in captured["user"]


def test_llm_failure_falls_back_to_raw_question(monkeypatch):
    _llm_configured(monkeypatch)

    async def boom(**kwargs):
        raise RuntimeError("llm down")

    monkeypatch.setattr(condense.llm, "complete", boom)
    q = "and in the playoffs?"
    assert asyncio.run(condense.condense_question(q, HISTORY)) == q


def test_blank_rewrite_falls_back_to_raw_question(monkeypatch):
    _llm_configured(monkeypatch)

    async def fake_complete(**kwargs):
        return '"  "'

    monkeypatch.setattr(condense.llm, "complete", fake_complete)
    q = "and in the playoffs?"
    assert asyncio.run(condense.condense_question(q, HISTORY)) == q


def test_pipeline_cache_key_uses_the_condensed_question(monkeypatch):
    """The rewritten question, not the raw follow-up, drives the cache lookup."""
    from app import pipeline as pl

    async def fake_condense(question, history):
        return STANDALONE

    monkeypatch.setattr(pl, "condense_question", fake_condense)

    seen = {}

    async def fake_get_cached(question):
        seen["question"] = question
        return {
            "question": question,
            "narration": "cached",
            "sql": "SELECT 1",
            "rows": [],
            "columns": [],
            "entities": [],
            "cached": False,
        }

    monkeypatch.setattr(pl.cache, "get_cached", fake_get_cached)

    req = SearchRequest(question="and in the playoffs?", history=HISTORY)
    resp = asyncio.run(pl.run_query_pipeline(req))
    assert seen["question"] == STANDALONE
    assert resp.cached is True
