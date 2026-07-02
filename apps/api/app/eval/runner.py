"""Evaluation harness.

Runs a golden set of question -> expected-answer cases through the real query
pipeline and measures two things:

  - parse accuracy      : did we produce the right QuerySpec (intent + stat)?
  - execution accuracy  : did the query return the right top answer + value?

It runs against the deterministic seed data, so it needs no API key and gives a
stable regression signal as we expand query coverage. Point it at a real
Postgres (with a golden set tied to that data) to measure the LLM path.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..database import get_engine
from ..pipeline import run_query_pipeline
from ..query import parse_rules
from ..schemas import SearchRequest
from ..seed import is_seeded, seed_demo

GOLDEN_PATH = Path(__file__).parent / "golden.json"


@dataclass
class CaseResult:
    question: str
    parse_ok: bool
    exec_ok: bool
    detail: str = ""

    @property
    def passed(self) -> bool:
        return self.parse_ok and self.exec_ok


@dataclass
class Report:
    results: list[CaseResult] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def parse_acc(self) -> float:
        return _pct(sum(r.parse_ok for r in self.results), self.total)

    @property
    def exec_acc(self) -> float:
        return _pct(sum(r.exec_ok for r in self.results), self.total)

    @property
    def passed(self) -> int:
        return sum(r.passed for r in self.results)

    @property
    def failures(self) -> list[CaseResult]:
        return [r for r in self.results if not r.passed]


def _pct(n: int, d: int) -> float:
    return 100.0 * n / d if d else 0.0


def _ensure_seeded() -> None:
    engine = get_engine()
    if not is_seeded(engine):
        seed_demo(engine)


def _numeric_values(row: dict[str, Any]) -> list[Any]:
    return [v for v in row.values() if isinstance(v, (int, float))]


def _value_matches(expected: Any, values: list[Any]) -> bool:
    """True if a numeric cell equals `expected`, tolerant of float rounding
    (derived stats like passer rating come back as ROUND()ed doubles)."""
    if isinstance(expected, float):
        return any(isinstance(v, (int, float)) and abs(v - expected) < 0.05 for v in values)
    return expected in values


def _eval_case(case: dict[str, Any]) -> CaseResult:
    question = case["question"]

    # Parse accuracy — the structured spec.
    spec = parse_rules(question)
    parse_ok = spec is not None
    if parse_ok and "intent" in case:
        parse_ok = spec.intent.value == case["intent"] and spec.stat == case["stat"]

    # Execution accuracy — run the full pipeline against the seeded DB.
    resp = asyncio.run(run_query_pipeline(SearchRequest(question=question)))
    exec_ok = bool(resp.rows)
    detail = ""
    if not resp.rows:
        detail = "no rows returned"
    else:
        top = resp.rows[0]
        name_ok = str(top.get("full_name")) == case.get("top_name")
        val_ok = _value_matches(case.get("top_value"), _numeric_values(top))
        exec_ok = name_ok and val_ok
        if not exec_ok:
            detail = f"got top={top.get('full_name')} values={_numeric_values(top)}"

    return CaseResult(question=question, parse_ok=parse_ok, exec_ok=exec_ok, detail=detail)


def evaluate(path: Path = GOLDEN_PATH) -> Report:
    _ensure_seeded()
    cases = json.loads(path.read_text())
    return Report(results=[_eval_case(c) for c in cases])
