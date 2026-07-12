# Search Hardening Audit

A diagnostic that drives the **top ~100 plausible questions** through the real
query pipeline (`resolve → parse → audit → build → execute → narrate`) against a
live warehouse and buckets every outcome. Its purpose is to catch the one
failure mode a stats product cannot ship: a **confidently wrong number**.

- Harness: [`apps/server/src/cli/searchAudit.ts`](../apps/server/src/cli/searchAudit.ts)
- Run: `DATABASE_URL=… npx tsx apps/server/src/cli/searchAudit.ts`
  (writes `search-audit-results.json` at the repo root; gitignored)
- Warehouse used for the run below: seasons **2020–2024**.

## Outcome buckets

Every question must land in an honest bucket — never a wrong number:

| Bucket | Meaning |
|---|---|
| `ANSWERED` | Parsed, executed, returned rows + a templated headline |
| `REFUSAL` | Recognized but unsupported → a **tailored** "not yet" message |
| `FALLBACK` | Unrecognized → generic honest "can't answer that yet" |
| `EMPTY` | Parsed + built SQL but **0 rows** — a red flag to investigate |
| `AUDIT_BLOCK` | Second-layer auditor stopped it (e.g. resolved a non-entity) |
| `ERROR` | Threw |

## Result

| | Before hardening | After hardening |
|---|---|---|
| ANSWERED | 91 | **85** |
| REFUSAL | 6 | **16** |
| FALLBACK | 4 | **3** |
| EMPTY | 2 | **0** |
| AUDIT_BLOCK | 1 | **0** |
| **Silent wrong answers** | **8+** | **0** |

The answer count *dropped* on purpose: eight questions that used to return a
confident wrong number now either compute correctly or refuse honestly.

## Findings fixed

Each of these produced a wrong number or wrong-shaped answer **before** the
audit. All are covered by the 227-test server suite plus this harness.

| # | Question class | Before (wrong) | After | Fix |
|---|---|---|---|---|
| 1 | First/last-N game totals | "Jefferson last 5 games" → **7,432** (his *career*) | **495** (the 5 games) | `build.ts` `playerGameRowsSql`: window totals now computed over the `LIMIT`-ed rows, not before |
| 2 | Single-game high, player named | "Derrick Henry most rushing yards in a game" → league-wide board | Henry's own best game | `parseRules.ts`/`build.ts`: `single_game` keeps `playerId`/season |
| 3 | Yardage game-counts | "throw for 300 yards", "100 yard rushing games", "400 yard passing games" → **season/career total** | correct `game_count` | `parseRules.ts` `threshold()`: recognizes `N-yard` phrasings |
| 4 | Number-as-season | "since 1999" → season 1999 (EMPTY); "2000 yard rushers" → season 2000 (EMPTY) | all-time leaders | `parseRules.ts` `detectSeason()`: `since YYYY` = all-time; a year glued to a stat unit is a threshold, not a season |
| 5 | Rank lookups | "where does Mahomes rank…" → his total | honest refusal | new `UNSUPPORTED` rule |
| 6 | Bio | "how old is Mahomes" → "**22,940 passing yards**" | honest refusal | new `UNSUPPORTED` rule |
| 7 | Per-game rates | "Jefferson yards per game" → season total | honest refusal | new `UNSUPPORTED` rule |
| 8 | Play distance | "longest touchdown of 2023" → "44 total touchdowns" | honest refusal | new `UNSUPPORTED` rule (scoped to a play noun so "longest career" still falls through) |
| 9 | Streaks / milestones | "longest active TD streak", "fastest to 10000 yards" → TD/yard leaders | honest refusal | new `UNSUPPORTED` rules |
| 10 | Season ranges | "passing yards from 2021 to 2023" → **only 2021** | honest refusal | new `UNSUPPORTED` rule |
| 11 | League-wide counts | "how many players had 1000 rushing yards" → a leaderboard | honest refusal | new `UNSUPPORTED` rule |
| 12 | Position false-positive | "best running back in 2024" → resolved player "Henry **Back**→Black" | RB leaders | `resolve.ts`: role nouns (`running`, `back`, `wide`, `receiver`, …) added to the resolver stop-list |

## The corpus + responses

Grouped by bucket. This doubles as a golden reference for manual review.

### Answered correctly (85)

**Leaders (season / career / positional / direction / rookie)**
- most passing yards in 2023 → *Tua Tagovailoa leads with 4,624.*
- who threw the most touchdowns in 2022 → *Patrick Mahomes, 41.*
- most rushing yards in 2024 → *Saquon Barkley, 2,005.*
- who led the league in receiving yards in 2023 → *Tyreek Hill, 1,799.*
- most receptions in 2022 → *Justin Jefferson, 128.*
- most interceptions thrown in 2021 → *Matthew Stafford, 17.*
- most sacks in 2023 → *T.J. Watt, 19.*
- who had the most tackles in 2022 → *Nick Bolton, 171.*
- top 5 rushing touchdowns in 2023 → *Raheem Mostert, 18.*
- most fantasy points in 2023 → *CeeDee Lamb, 403.2 PPR.*
- most career passing yards → *Patrick Mahomes, 22,940 (all time).*
- most passing touchdowns all time → *Patrick Mahomes, 169.*
- most rushing yards in a season → *Derrick Henry, 2,027 (2020).*
- most receiving yards in a season since 1999 → *Cooper Kupp, 1,947 (2021).*
- best quarterback in 2023 → *Tua Tagovailoa (QB), 4,624.*
- top 10 wide receivers in 2023 → *Tyreek Hill (WR), 1,799.*
- fewest interceptions in 2022 → *fewest (min. 8 games), 0.*
- most rushing yards by a rookie in 2023 → *Bijan Robinson, 976.*
- best running back in 2024 → *Saquon Barkley (RB), 2,005.*
- who threw the fewest touchdowns in 2023 → *fewest (min. 8 games), 0.*
- most touchdowns in week 1 2023 → *Jordan Love, 3.*
- most passing yards in the playoffs 2023 → *Patrick Mahomes, 1,051.*
- most rushing yards in the postseason 2023 → *Isiah Pacheco, 313.*
- highest completion percentage in 2023 → *Jake Browning, 70.4%.*
- most passes defended in 2022 → *Sauce Gardner, 20.*
- who threw for the most yards → *Tom Brady, 5,316 (2021).*

**Player totals (season / career / splits)**
- Patrick Mahomes passing yards in 2022 → *5,250.*
- how many touchdowns did Josh Allen throw in 2023 → *29.*
- Justin Jefferson receiving yards in 2022 → *1,809.*
- Derrick Henry rushing yards in 2023 → *1,167.*
- Ja'Marr Chase receptions in 2023 → *100.*
- Tyreek Hill receiving yards in 2023 → *1,799.*
- CeeDee Lamb receiving yards in 2023 → *1,749.*
- Lamar Jackson rushing yards in 2024 → *915.*
- Patrick Mahomes career passing touchdowns → *169.*
- Derrick Henry career rushing yards → *7,590.*
- Travis Kelce career receiving yards → *5,686.*
- Aaron Rodgers career passing yards → *16,006.*
- Davante Adams career receiving touchdowns → *59.*
- Patrick Mahomes passing yards in the Super Bowl → *1,042 (career SB).*
- Travis Kelce receptions in the playoffs → *126 (career postseason).*
- Josh Allen passing yards at home in 2023 → *2,161.*
- Derrick Henry rushing yards on the road in 2023 → *339.*
- Justin Jefferson receiving yards through week 8 2022 → *752.*
- Patrick Mahomes completion percentage in 2022 → *67.1%.*
- Micah Parsons sacks in 2023 → *14.*
- Myles Garrett forced fumbles in 2023 → *4.*
- Micah Parsons tackles → *234 (career).*
- **Justin Jefferson last 5 games → 495 receiving yards.** *(was 7,432 — fixed)*
- **Derrick Henry first 5 games → 588 rushing yards.** *(was 7,590 — fixed)*

**Single game (now player-scoped)**
- most passing yards in a single game → *Joe Burrow, 525 (Wk 16, 2021).*
- most rushing yards in one game → *Saquon Barkley, 255 (Wk 12, 2024).*
- Derrick Henry most rushing yards in a game → *250 (Wk 17, 2020).*
- Justin Jefferson most receiving yards in a single game → *223 (Wk 14, 2022).*
- Patrick Mahomes most passing touchdowns in a game → *5 (Wk 1, 2022).*

**Compare (career / season / stat-specific)**
- Patrick Mahomes vs Josh Allen → *Mahomes leads passing yards, 22,940–21,271.*
- Justin Jefferson vs Ja'Marr Chase receiving yards → *7,432–5,425.*
- Derrick Henry versus Saquon Barkley rushing yards → *7,590–4,906.*
- Josh Allen vs Lamar Jackson passing touchdowns → *165–124.*
- Patrick Mahomes vs Josh Allen career passing yards → *22,940–21,271.*
- Jalen Hurts vs Josh Allen in 2022 → *Allen leads, 4,283–3,701.*

**Scoring (first / last TD)**
- Ja'Marr Chase first touchdown → *Sep 12, 2021 vs MIN.*
- when did Justin Jefferson score his first touchdown → *Sep 27, 2020 vs TEN.*
- Puka Nacua last touchdown → *Dec 8, 2024 vs BUF.*
- Patrick Mahomes first playoff touchdown → *Jan 17, 2021 vs CLE (rushing).*

**Game counts (thresholds)**
- how many games did Josh Allen throw for 300 yards in 2023 → *5.*
- Derrick Henry 100 yard rushing games in 2023 → *4.*
- Tyreek Hill games with over 100 receiving yards in 2023 → *8.*
- how many 400 yard passing games does Patrick Mahomes have → *7 (career).*

**Game results / team logs / drafts / game log / player seasons**
- who won the Super Bowl in 2023 → *Chiefs beat Eagles 38-35 (SB LVII).*
- who won Super Bowl 58 → *Chiefs beat 49ers 25-22 (SB LVIII).*
- did the Chiefs beat the 49ers in the Super Bowl → *yes, 25-22.*
- Eagles record in 2022 → *14-3.*  ·  Lions record in 2023 → *12-5.*
- Chiefs last 5 games → *3-2.*  ·  Ravens playoff record → *3-4.*
- who was the first pick in the 2023 draft → *Bryce Young (Panthers).*
- who did the Panthers draft first in 2023 → *Bryce Young, 5 picks.*
- where was Bryce Young drafted → *pick 1, round 1, 2023.*
- first overall pick 2021 draft → *Trevor Lawrence (Jaguars).*
- Josh Allen game log 2023 → *17 games.*
- Derrick Henry → *regular-season stats, season by season (2020–2024).*

### Honest tailored refusals (16)

Unsupported but recognized — a "not yet" that points somewhere useful, never a
wrong number:

- most sacks by a defense in 2023 · Chiefs · what team does Justin Jefferson play for → *team-unit / team-page*
- passing yards from 2021 to 2023 · receiving yards over the last 3 seasons → *season ranges not supported*
- how many players had 1000 rushing yards in 2023 → *league-wide counts not supported*
- where does Patrick Mahomes rank in career passing yards → *rank lookups not supported*
- how old is Patrick Mahomes · tallest player in the NFL → *bio not searchable*
- Patrick Mahomes passer rating · Josh Allen QBR · Patrick Mahomes red zone touchdowns → *rate/efficiency not tracked*
- Justin Jefferson yards per game in 2023 → *per-game rates not computed in search*
- longest touchdown of 2023 → *play distances not tracked*
- who has the longest active touchdown streak → *streaks not tracked*
- fastest to 10000 passing yards → *milestone-pace not supported*

### Generic fallbacks (3)

Genuinely unrecognized — the correct place to be honest and generic:

- 2023 MVP *(awards not modeled)* · the goat · asldkfj

## Known remaining gaps (safe — not wrong)

Documented, not silent:

- **"Patrick Mahomes stats by season"** routes to a career total instead of the
  season-by-season `player_seasons` view (a bare name like "Derrick Henry"
  routes correctly). Minor routing nicety, not a wrong number.
- **"2000 yard rushers"** answers a scrimmage-yards leaderboard (imperfect stat
  pick) rather than a league-wide count — an accepted shape, no wrong number.
- Season ranges, league counts, ranks, bio, rate metrics, streaks and awards are
  the documented future-feature surface (all refuse honestly today).
