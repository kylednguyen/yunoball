"""Run the eval and print a report.

    cd apps/api && DEMO=1 python -m app.eval

Exits non-zero if any case fails, so it can gate CI.
"""

from __future__ import annotations

import sys

from .runner import evaluate


def main() -> int:
    report = evaluate()

    for r in report.results:
        mark = "PASS" if r.passed else "FAIL"
        line = f"[{mark}] {r.question}"
        if not r.passed:
            flags = []
            if not r.parse_ok:
                flags.append("parse")
            if not r.exec_ok:
                flags.append("exec")
            line += f"  <- {'/'.join(flags)} {r.detail}"
        print(line)

    print("-" * 60)
    print(
        f"{report.passed}/{report.total} passed   "
        f"parse={report.parse_acc:.0f}%   exec={report.exec_acc:.0f}%"
    )
    return 0 if not report.failures else 1


if __name__ == "__main__":
    sys.exit(main())
