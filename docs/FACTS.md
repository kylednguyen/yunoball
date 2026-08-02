# Notable facts — the fact of the day

> ESPN-style stat lines ("only the fourth 200-yard rushing game since 2019"),
> mined from the warehouse on a schedule and published one per day.

## The constraint that shapes the design

YunoBall's core invariant is that a number is never wrong: the parser
translates, a template builder writes the SQL, the warehouse is the source of
truth, and anything that can't be answered precisely is refused. A feature that
generated SQL or prose at request time would break that on day one.

So the work splits across **two clocks**:

| | Who | When | Output |
|---|---|---|---|
| **Design time** | the `stat-scout` agent + `stat-facts` skill | on demand, in dev | **probe modules** — SQL + a narration template + a test, reviewed in a PR |
| **Run time** | `pnpm facts:mine`, plain Node | weekly on a schedule | rows in `stat_facts`, one row in `fact_of_the_day` |

A model's only contribution is the probe source, written at design time and
pinned by a golden test. Nothing generative runs in a request, and no sentence
a user sees was composed by a model.

## The probe

A probe returns **every occurrence** of one rare event, newest first. The miner
derives the claim from that list:

- newest row → the subject
- row count → the population ("just the fourth…")
- next distinct occurrence → the prior season ("…since 2019")
- same season+week rows → co-holders, so "first" doesn't crown one of two

Probes reuse the query engine's own machinery — `Params` for bound values and
`statDef()` for stat expressions — so a probe can only reference a stat the
engine already knows how to compute, and cannot interpolate a literal into SQL.

Families in `apps/server/src/facts/probes/`: `gameThreshold`,
`seasonThreshold`, `conjunction`, `streak`, `teamGame`.

## The coverage floor

**This is the part that keeps the feature honest.** The warehouse starts in
1999, and newer datasets start later. "First since 1972" is unprovable here and
is exactly where this class of feature ships a wrong number.

Floors are **derived from the warehouse at mine time**, never hardcoded:
`floorsFor()` reads `MIN(season)` per source table, and a probe's floor is the
*latest* of its sources' floors — it can only see as far back as its most
recently-starting input. A backfill therefore widens what probes may claim
automatically, and a dataset that failed to load tightens it.

The rule is enforced twice:

1. `sinceClause()` cannot say more than the data supports. With no prior
   occurrence on record it renders "since 1999, the earliest season on record
   here" rather than "ever" — because the true statement is about *our record*,
   not about NFL history.
2. `assertNoUnsupportedYear()` scans the rendered headline and **throws** on any
   year before the floor, catching a hand-written year in a template that the
   phrase builders can't see.

An empty dataset gets an unreachable floor, so a probe over it produces no
claim at all rather than an unbounded one.

## Scoring

Four terms, weighted as constants (`facts/score.ts`) — this ranks a backlog, it
is not a model:

```
surprise = 2.0·log(1/frequency)        rarity, per season of record
         + 1.2·log(1 + drought)        seasons since the previous occurrence
         + 0.8·recency                 did it happen in the current season
         + 0.5·roundness               400 yards reads as a milestone, 387 does not
```

Then near-duplicates collapse: one fact per (subject, metric family, week), so
a reader never gets two passing facts about one quarterback in one day.

## Selection and the cron

Two cadences, because they answer to different things — mining only needs to
run when the data changes (weekly, chained off the nflverse ingest via
`workflow_run`), selection runs daily because that is the product promise.
See `.github/workflows/facts.yml`.

**Neither is load-bearing.** Selection is a pure function of the date over the
ranked backlog: `sha1(day) % pool`, filtered by a 10-day subject cooldown. The
scheduled job and `GET /api/facts/today` compute the same answer, so the
endpoint backfills on a miss and a skipped or delayed run self-heals on the
next request. Scheduled GitHub Actions drift and are occasionally dropped
entirely; the design removes the dependency rather than monitoring it.

Mining is idempotent — `fact_id` hashes probe, variant, subject and date — so
re-running a week updates rows in place.

## Storage and API

`stat_facts` carries the claim **and its proof**: the exact SQL and the peer
rows behind it. A fact that can't show its work doesn't ship, the same way an
answer card exposes its query. `fact_of_the_day` is one row per day.

```
GET /api/facts/today[?day=YYYY-MM-DD]   -> { day, fact | null }
GET /api/facts[?season=&limit=]          -> { facts: [...] }
GET /api/facts/:factId                   -> the fact + sql + evidence
```

List responses drop `sql`/`evidence` to keep the home payload small; the detail
route carries them.

## Offseason

Mining finds nothing new from February to September, which is what the backlog
is for: a season's mining yields hundreds of ranked facts and daily selection
rotates through them under the cooldown. The miner warns when it produces no
candidates rather than exiting quietly green.

## Adding a probe

See the `stat-facts` skill (`.claude/skills/stat-facts/`) for the procedure and
the review checklist, and `.claude/agents/stat-scout.md` for the research agent
that authors them. Short version: copy the closest family, write variants from
a round-number ladder, dry-run with `pnpm facts:mine --dry-run --probe <id>`,
read the headlines out loud, add a test, and commit probe + registry line +
test together.

Never loosen a guard to ship a fact. Drop the fact.
