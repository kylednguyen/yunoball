"""Integration test: every golden reference SQL still runs and denotes rows.

Skipped automatically when the warehouse isn't reachable (e.g. no Docker in CI),
so the unit suite stays green without infra. With a populated DB this is the
schema-drift guard for the golden set.
"""

from __future__ import annotations

import asyncio

import pytest

from app.eval import run_reference_only
from app.pipeline.execute import execute_sql


def _db_available() -> bool:
    try:
        asyncio.run(execute_sql("SELECT 1"))
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _db_available(), reason="warehouse not reachable; skipping reference eval"
)


def test_all_reference_sql_execute_and_return_rows():
    report = asyncio.run(run_reference_only())
    failures = [r for r in report.results if not r.passed]
    assert not failures, "reference SQL failures:\n" + "\n".join(
        f"  {r.id}: {r.error}" for r in failures
    )
    assert report.accuracy == 1.0
