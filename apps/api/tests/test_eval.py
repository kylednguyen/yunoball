"""Regression guard: the golden eval set must stay at 100%."""

import os

os.environ.setdefault("DEMO", "1")

from app.eval import evaluate  # noqa: E402


def test_golden_set_passes():
    report = evaluate()
    assert report.total >= 10
    failures = [f"{r.question}: {r.detail}" for r in report.failures]
    assert not failures, f"eval regressions: {failures}"
    assert report.exec_acc == 100.0
    assert report.parse_acc == 100.0
