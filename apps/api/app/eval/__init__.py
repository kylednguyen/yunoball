"""Accuracy eval harness — the product's non-negotiable.

A golden set of `question -> reference SQL` pairs. The reference SQL is the
ground truth (authored + verified against the warehouse); the pipeline's
generated SQL is judged by whether its *result set* matches the reference's,
not by string similarity. That's "execution accuracy" — the metric that tracks
whether answers are actually correct.
"""

from .golden import GOLDEN, GoldenCase
from .harness import EvalReport, evaluate, run_reference_only

__all__ = ["GOLDEN", "GoldenCase", "EvalReport", "evaluate", "run_reference_only"]
