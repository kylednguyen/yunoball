---
name: stat-facts
description: Author, review and debug YunoBall fact probes — the SQL templates behind the fact of the day. Use when adding a probe, when a mined headline reads wrong, when the fact backlog is empty or stale, or when changing how facts are scored, phrased or selected. Covers the probe contract, the coverage-floor rules, the surprise scoring, and the mine/select CLI.
---

# Authoring fact probes

A **probe** is a checked-in SQL template that returns every occurrence of one
rare event, newest first. The miner derives the whole claim from that list:
newest row is the subject, row count is the population, the next distinct
occurrence is when it last happened. Probes are the only way a fact enters the
product.

Read `docs/FACTS.md` for the architecture. This is the procedure.

## Adding a probe

1. **Pick a family and a grain.** `probes/gameThreshold.ts` (single game),
   `seasonThreshold.ts` (season rollup), `conjunction.ts` (two thresholds at
   once), `streak.ts` (consecutive games), `teamGame.ts` (team box score). Copy
   the closest one.

2. **Write the variants from a round-number ladder.** Thresholds come from
   numbers a broadcast would use — 100, 200, 400 yards; 4, 5, 6 touchdowns —
   chosen *before* you look at how many rows they return. Explore first to find
   roughly where the cliff is, then snap to the nearest round number. Never the
   reverse. `test/facts.test.ts` enforces "multiple of five, or ten and under".

3. **Write the SQL.** Two rules:
   - Every user-derived value goes through `p.add(...)`. Nothing is
     interpolated, ever. There is a test that greps for bare literals.
   - Stat expressions come from `statDef(variant)` (the engine's `STATS`
     allowlist), not hand-written column names. A probe should not be able to
     name a column the query engine doesn't know.

   Select `subject_id`, `subject_name`, `season`, `week`, `value` plus whatever
   the headline needs, order newest first, and `LIMIT` at `maxPopulation + 1`
   so the miner can tell "rare" from "capped out".

4. **Write the headline template.** Compose it from `subjectPhrase()`,
   `ordinal()`, `whenPhrase()` and `sinceClause()`. Do not write a year, and do
   not compute a number the SQL didn't return.

5. **Register it** — one line in `registry.ts`. Nothing is auto-discovered.

6. **Dry-run it and read the output:**

   ```
   pnpm facts:mine --dry-run --probe <your_probe_id> --limit 40
   ```

   Read the headlines out loud. Check each one against the review list below.

7. **Add a golden test.** The registry-wide tests in `test/facts.test.ts` will
   already cover your probe's SQL shape, threshold roundness and headline
   rendering. Add a case of your own for anything specific to your claim.

8. **Commit the probe, the registry line and the test together.**

## Reviewing a mined headline

- Does the "since" clause match what the data can prove? If the event has no
  prior occurrence on record, the headline must say "since &lt;floor&gt;, the
  earliest season on record here" — not "ever", not "first ever".
- Is it about the right unit? Population counts *occurrences*. If one player
  can appear twice, "the fourth player to" is wrong and "the fourth game of"
  is right.
- Would two people share the honour? Same season and week means co-holders;
  `subjectPhrase()` handles the naming, but check the verb agrees.
- Is the threshold a number a fan counts in, or one you found by fishing?
- Does it read like a sentence someone would say out loud?

## Commands

```
pnpm facts:mine --dry-run          # score and print, write nothing
pnpm facts:mine --dry-run --limit 40
pnpm facts:mine --probe game_streak --since 2024
pnpm facts:mine                    # upsert stat_facts
pnpm facts:mine --list             # the registry, no database needed
pnpm facts:select                  # publish today's fact
pnpm facts:select --day 2026-08-02
```

Mining is idempotent — `fact_id` hashes the probe, variant, subject and date,
so re-running a week updates rows rather than duplicating them.

## Debugging

**Empty backlog.** Check `--since`: by default only events in the latest loaded
season become facts, so an offseason run finds nothing new. `--since 2020`
widens it. If it is genuinely empty in-season, run `--list` and then one probe
at a time.

**"not rare enough" skips.** The variant's threshold is too low for its
`maxPopulation`. Raise the threshold to the next rung of the ladder — do not
raise `maxPopulation` to let a common event through.

**A probe throws.** Failures are isolated per probe and logged with the variant
key; the rest of the run continues. The usual causes are a stat that isn't
computable at the probe's grain (the `assertVariantComputable` guard) and a
headline naming a year before the coverage floor (`assertNoUnsupportedYear`).

**A headline breaches the floor.** Do not relax the guard. Rewrite the template
to use `sinceClause()`; the guard exists because that mistake is invisible in
review and catastrophic in production.

## What not to do

- Don't write to `stat_facts` or `fact_of_the_day` by hand.
- Don't put an LLM in the mining path. The miner is deterministic; that is the
  entire reason this design is allowed to exist alongside "never a wrong
  number".
- Don't loosen a guard to ship a fact. Drop the fact.
