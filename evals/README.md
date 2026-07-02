# Evaluation harness

YunoBall is evaluation-driven: accuracy is the product, so a golden set of
canonical NFL questions is scored through the **real** query pipeline on every
change and gated at 100% in CI.

## Where it lives

The harness imports the live pipeline (`run_query_pipeline`, `parse_rules`, the
seed), so it lives **inside the API package** rather than here — Python can only
import it with the app on the path:

```
apps/api/app/eval/
  golden.json     # 50+ canonical question → expected-answer cases
  runner.py       # scores parse accuracy + execution accuracy
  __main__.py     # CLI entrypoint
apps/api/tests/test_eval.py   # CI gate: >= 50 cases at 100%
```

This directory is the signpost for anyone looking for `/evals`.

## What it measures

Each case asserts two things against the seeded demo warehouse (no API key
needed):

- **Parse accuracy** — the question produced the right `QuerySpec` (intent + stat).
- **Execution accuracy** — the generated SQL returned the right top answer + value.

The golden set spans all five intents (`leaders`, `player_total`, `single_game`,
`team_stat`, `comparison`) and every whitelisted stat, so it doubles as an
executable spec for the query engine.

## Run it

```bash
cd apps/api
DEMO=1 python -m app.eval          # prints a per-case PASS/FAIL report
DEMO=1 pytest tests/test_eval.py   # the CI gate
```

Add cases in `apps/api/app/eval/golden.json`. Grow the set with every new intent
or stat so accuracy stays measured, not assumed.
