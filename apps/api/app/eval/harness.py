"""Run the golden set and score execution accuracy.

Two modes:
  * reference-only  — execute every reference SQL and confirm it still runs and
    returns rows. No LLM needed; this is the cheap CI gate that catches schema
    drift and broken golden SQL.
  * full eval       — also run the NL->SQL pipeline per question and compare the
    predicted result set to the reference. Needs OPENAI_API_KEY.

    yunoball-eval                 # full eval if a key is set, else reference-only
    yunoball-eval --reference-only
    yunoball-eval --min-accuracy 0.8   # exit non-zero if below threshold (CI)
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from typing import Any

from ..config import settings
from ..pipeline import run_query_pipeline
from ..pipeline.execute import execute_sql
from ..schemas import SearchRequest
from .golden import GOLDEN, GoldenCase


# --------------------------- result-set comparison -------------------------- #


def _norm_value(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, Decimal):
        return round(float(v), 3)
    if isinstance(v, (int, float)):
        f = float(v)
        return None if f != f else round(f, 3)  # NaN -> None
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return str(v)


def _norm_rows(rows: list[dict[str, Any]]) -> list[tuple]:
    """Order-insensitive multiset of value-tuples (column order preserved)."""
    return sorted((tuple(_norm_value(v) for v in row.values()) for row in rows), key=repr)


def rows_match(expected: list[dict], predicted: list[dict]) -> bool:
    return _norm_rows(expected) == _norm_rows(predicted)


# --------------------------------- reporting -------------------------------- #


@dataclass
class CaseResult:
    id: str
    question: str
    passed: bool
    expected_rows: int
    predicted_rows: int | None = None
    predicted_sql: str | None = None
    error: str | None = None


@dataclass
class EvalReport:
    mode: str
    results: list[CaseResult] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def accuracy(self) -> float:
        return self.passed / self.total if self.total else 0.0

    def summary(self) -> str:
        lines = [f"YunoBall eval [{self.mode}] — {self.passed}/{self.total} "
                 f"({self.accuracy:.0%})", ""]
        for r in self.results:
            mark = "PASS" if r.passed else "FAIL"
            detail = ""
            if r.error:
                detail = f"  ! {r.error}"
            elif not r.passed:
                detail = f"  expected {r.expected_rows} rows, got {r.predicted_rows}"
            lines.append(f"  [{mark}] {r.id}: {r.question}{detail}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "passed": self.passed,
            "total": self.total,
            "accuracy": self.accuracy,
            "results": [asdict(r) for r in self.results],
        }


# ----------------------------------- runs ----------------------------------- #


async def run_reference_only(cases: list[GoldenCase] = GOLDEN) -> EvalReport:
    report = EvalReport(mode="reference-only")
    for case in cases:
        try:
            rows, _ = await execute_sql(case.reference_sql)
            # A correct reference query always denotes at least one row
            # (aggregates included). Zero rows usually means a bad name/filter.
            report.results.append(
                CaseResult(
                    id=case.id,
                    question=case.question,
                    passed=len(rows) > 0,
                    expected_rows=len(rows),
                    error=None if rows else "reference SQL returned 0 rows",
                )
            )
        except Exception as err:  # noqa: BLE001
            report.results.append(
                CaseResult(case.id, case.question, False, 0, error=f"{type(err).__name__}: {err}")
            )
    return report


async def evaluate(cases: list[GoldenCase] = GOLDEN) -> EvalReport:
    report = EvalReport(mode="execution-accuracy")
    for case in cases:
        try:
            expected, _ = await execute_sql(case.reference_sql)
        except Exception as err:  # noqa: BLE001
            report.results.append(
                CaseResult(case.id, case.question, False, 0,
                           error=f"reference failed: {type(err).__name__}: {err}")
            )
            continue
        try:
            resp = await run_query_pipeline(SearchRequest(question=case.question), use_cache=False)
            report.results.append(
                CaseResult(
                    id=case.id,
                    question=case.question,
                    passed=rows_match(expected, resp.rows),
                    expected_rows=len(expected),
                    predicted_rows=len(resp.rows),
                    predicted_sql=resp.sql,
                )
            )
        except Exception as err:  # noqa: BLE001
            report.results.append(
                CaseResult(case.id, case.question, False, len(expected),
                           error=f"pipeline failed: {type(err).__name__}: {err}")
            )
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the YunoBall accuracy eval.")
    ap.add_argument("--reference-only", action="store_true",
                    help="Only validate reference SQL (no LLM).")
    ap.add_argument("--min-accuracy", type=float, default=None,
                    help="Exit non-zero if execution accuracy is below this (0-1).")
    ap.add_argument("--json", action="store_true", help="Emit JSON report.")
    args = ap.parse_args()

    reference_only = args.reference_only or not settings.openai_api_key
    if reference_only and not args.reference_only:
        print("[eval] OPENAI_API_KEY not set — running reference-only.\n")

    report = asyncio.run(run_reference_only() if reference_only else evaluate())

    print(json.dumps(report.to_dict(), indent=2) if args.json else report.summary())

    failed_reference = reference_only and report.passed < report.total
    below_threshold = (
        not reference_only
        and args.min_accuracy is not None
        and report.accuracy < args.min_accuracy
    )
    if failed_reference or below_threshold:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
