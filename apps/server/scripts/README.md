# QA scripts

## `parseHarness.mts` — offline parser ground-truth

Runs natural-language questions through the **real** `parseRules` engine
without a database, so parser output can be judged against expectations in
bulk (accuracy audits, regression batteries).

```bash
# from apps/server (cwd matters: tsx + the @yunoball/types symlink resolve here)
npx tsx scripts/parseHarness.mts path/to/questions.txt   # one question per line
```

Output is JSONL on stdout — one `{"q": ..., "result": <QuerySpec | {refusal} | null>}`
per line; all logging goes to stderr.

### Fixtures (`fixtures/`)
`players.json` (top ~1500 by prominence) and `teams.json` are point-in-time
snapshots of the warehouse, regenerable with the queries documented at the top
of the harness. The index/resolution logic is ported from
`src/engine/resolve.ts`; if that file changes, re-sync the ported helpers here.
The fixture is capped and uses a slightly simplified prominence formula, so a
question naming a very obscure player may not resolve where production would —
adequate for auditing question *shapes*, not a substitute for the live pipeline.
