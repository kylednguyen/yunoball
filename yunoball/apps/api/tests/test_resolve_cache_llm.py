"""Tests for fuzzy entity resolution, the cache, and LLM-JSON validation."""

import asyncio
import os

os.environ.setdefault("DEMO", "1")

from app import cache  # noqa: E402
from app.database import get_engine  # noqa: E402
from app.seed import is_seeded, seed_demo  # noqa: E402
from app.pipeline.resolve import resolve_entities, clear_cache  # noqa: E402
from app.query import spec_from_json, QuerySpec, Intent  # noqa: E402


def _seed():
    eng = get_engine()
    if not is_seeded(eng):
        seed_demo(eng)
    clear_cache()


# ---- fuzzy resolution ----

def test_resolve_full_name():
    _seed()
    ents = asyncio.run(resolve_entities("Patrick Mahomes career passing yards"))
    assert ents and ents[0].display_name == "Patrick Mahomes"


def test_resolve_last_name_only():
    _seed()
    ents = asyncio.run(resolve_entities("Mahomes passing yards in 2023"))
    assert ents and ents[0].display_name == "Patrick Mahomes"


def test_resolve_typo():
    _seed()
    ents = asyncio.run(resolve_entities("how many yards did Mahomez throw"))
    assert ents and ents[0].display_name == "Patrick Mahomes"


def test_resolve_no_false_positive_on_leaders():
    _seed()
    # A pure leaderboard question must not resolve to a player.
    assert asyncio.run(resolve_entities("Most rushing yards in 2023")) == []


# ---- LLM JSON validation (untrusted input) ----

def test_spec_from_json_valid():
    spec = spec_from_json({"intent": "leaders", "stat": "passing_tds", "season": 2023})
    assert isinstance(spec, QuerySpec) and spec.intent is Intent.LEADERS


def test_spec_from_json_rejects_bad_stat():
    # A hallucinated column must never produce a spec.
    assert spec_from_json({"intent": "leaders", "stat": "salary"}) is None


def test_spec_from_json_rejects_missing_intent():
    assert spec_from_json({"stat": "passing_tds"}) is None


def test_spec_from_json_normalizes_synonym():
    spec = spec_from_json({"intent": "leaders", "stat": "passing_touchdowns"})
    assert spec is not None and spec.stat == "passing_tds"


def test_spec_from_json_rejects_out_of_bounds_limit():
    # limit is bounded (<=100) by the schema, so a huge value is rejected.
    assert spec_from_json({"intent": "leaders", "stat": "passing_tds", "limit": 9999}) is None


# ---- cache round-trip ----

def test_cache_roundtrip():
    key = cache.text_key("unit test question")
    asyncio.run(cache.set(key, {"narration": "hi", "rows": []}))
    got = asyncio.run(cache.get(key))
    assert got and got["narration"] == "hi"
