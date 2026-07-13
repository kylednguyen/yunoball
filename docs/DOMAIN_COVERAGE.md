# Domain Coverage Matrix

Status of every domain area against the search engine, verified by the
154-question audit corpus (`apps/server/src/cli/searchAudit.ts`) against a
live 2020–2024 warehouse: **145 answered · 9 tailored refusals · 0 generic
fallbacks · 0 wrong · 0 errors** (as of wave 4b — EPA/success/CPOE/longest
TDs/per-drive).

Legend: ✅ answered from the warehouse · 🟡 partially (noted) ·
📥 needs a new ingest column (data exists in nflverse, not loaded yet) ·
🚫 honest tailored refusal (data genuinely not available)

## Player metadata

| Item | Status | Example |
|---|---|---|
| Height / Weight / Age / Birthday | ✅ | "how tall is Josh Allen" → *6'5", 237 lbs* |
| College | ✅ | "what college did Travis Kelce go to" → *Cincinnati* |
| Draft | ✅ | "where was Bryce Young drafted" → *pick 1, 2023* |
| Position / Current team | ✅ | "what team does Aaron Rodgers play for" → *NY Jets* |
| Previous teams | ✅ | "what teams has Derrick Henry played for" → *Titans (2020–2023), Ravens (2024)* |
| Experience | ✅ | "how many seasons has Mahomes played" → *5 in the warehouse, 2020–2024* |
| Jersey number | ✅ | "what number does Mahomes wear" → *No. 15* |
| Awards (MVP, SB MVP) | ✅ | "who won MVP in 2023" → *Lamar Jackson*; counts per player. Curated facts table (`engine/facts.ts`), 1999–2024 |
| Awards (Pro Bowl, All-Pro, HOF) | 🚫 | full honor rosters would risk invented facts — refusal |

## Stats

| Item | Status | Example |
|---|---|---|
| Season / Career / Single-game / Game logs | ✅ | core engine |
| Splits: home/away, playoffs, opponent, **month** | ✅ | "Henry rushing yards in December 2023" → *275* |
| Splits: division/conference opponent | 🟡 | opponent-by-team works; grouped div/conf splits live on player pages |
| Splits: primetime | ✅ | "Mahomes passing yards in primetime in 2023" → *1,357* |
| Splits: weather (cold) | ✅ | "Josh Allen passing yards in freezing weather" → *1,362 (≤32°F)* |

## Team

| Item | Status | Example |
|---|---|---|
| Division / Conference / Stadium | ✅ | "what division are the chiefs in" → *AFC West* |
| Coach / Colors | ✅ | "who coaches the chiefs" → *Andy Reid*; colors from nflverse |
| Founded | ✅ | "when were the packers founded" → *1921* (curated facts) |
| Team stats (points, yards) | ✅ | "how many points did the chiefs score in 2023" → *371* |
| Points allowed / per game | ✅ | "bills points allowed in 2023" → *311*; "chiefs points per game" → *21.8* |
| Team leaders | ✅ | "who led the chiefs in receiving yards in 2023" → *Kelce, 984* |
| Roster lookups | ✅ | "chiefs roster 2023" → *55 players, led by Mahomes…* |
| Team-unit league rankings | 🚫 | team pages rank offense/defense; search refuses honestly |
| Schedules (future games) | 🟡 | historical schedule = game log; future games load with the next ingest |
| Standings | ✅ (page + API) | `/standings`; search routes team records ("Eagles record in 2022" → *14-3*) |
| Transactions / Injuries / Depth charts | 🚫 | not in nflverse core — tailored refusals |

## Games

| Item | Status | Example |
|---|---|---|
| Game results / Head-to-head | ✅ | "did the Chiefs beat the 49ers in the Super Bowl" → *25-22* |
| Box scores | ✅ (page + API) | `/games/:id/boxscore` |
| Scoring summaries (TDs) | ✅ | scoring_plays: "Chase first touchdown" → *Sep 12, 2021 vs MIN*; longest TDs by play length (wave 4b) |
| Play-by-play / Drive summaries | 🚫 | only TD events are distilled — tailored refusal |

## Analysis

| Item | Status | Example |
|---|---|---|
| Comparisons | ✅ | "Mahomes vs Allen career passing yards" |
| Rankings | ✅ | "where does Mahomes rank in career passing yards" → *1st of 3,666* |
| Records (season/single-game highs) | ✅ | "most rushing yards in a season" |
| Milestones ("fastest to…") | ✅ | "fastest to 10000 passing yards" → *Mahomes, 34 games* (cumulative windows; warehouse-era careers) |
| Playoffs (WC/DIV/CON/SB, history) | ✅ | round-aware filters + team playoff logs |
| Championships | ✅ (1999+) | "Chiefs super bowl history" → their SB record |
| Franchise relocations / renames | ✅ | "did the raiders relocate" → *Oakland→Las Vegas, 2020* (curated facts) |
| Retired numbers / Ring of Honor / HOF | 🚫 | large honor rosters, fabrication risk — refusal |

## Discovery, aggregation, trends

| Item | Status | Example |
|---|---|---|
| "How many players…" counts | ✅ | "how many players had 1000 rushing yards in 2023" → *12* |
| Sum / Count / Min / Max | ✅ | totals, leaders asc/desc |
| Percentage | ✅ | completion %, catch rate |
| Per game | ✅ | "Jefferson average receiving yards in 2023" → *107.4/game* |
| **Per attempt / carry / reception** | ✅ | "Henry yards per carry in 2023" → *4.2*; YPA, YPR |
| Per drive | ✅ | "chiefs points per drive in 2023" (drive counts from pbp, wave 4b) |
| Median | ✅ | "Henry median rushing yards in 2023" → *75/game* (PERCENTILE_CONT) |
| Rolling averages | ✅ | "Jefferson 5-game rolling average" → *99/game* (last-N window rate) |
| First/last N, since/before Week X | ✅ | windows + week ranges |
| Win/loss streaks (team) | ✅ | "chiefs winning streak" → current + longest on file |
| Stat streaks (player) | ✅ | "Henry games in a row with a rushing TD" → *7 (active: 2)* |

## Advanced analytics

| Item | Status |
|---|---|
| Passer rating | ✅ NFL formula over warehouse sums — "Mahomes passer rating in 2023" → *92.6* (matches official) |
| EPA / CPOE / success rate / expected points | ✅ pbp-aggregated per player-game — "Mahomes EPA in 2023" → *+24.8*; boards + ranks with volume floors |
| QBR / DVOA / win probability / pressure rate | 🚫 proprietary models or data not in public pbp |
| Air yards | ✅ — "Tyreek Hill air yards in 2023" → *1,847*; passing/receiving boards |

## NL edge cases

| Item | Status | Mechanism |
|---|---|---|
| Typos | ✅ | difflib-equivalent fuzzy resolver |
| Nicknames / abbreviations | ✅ | nickname map (CMC, TB12, Gronk…), initials |
| Ambiguous names | ✅ | auditor clarification ("Which Allen?") |
| Relative dates | ✅ | "this season", "last year", "last game" |
| Impossible queries | ✅ | tailored refusals; gibberish → honest fallback |

## Ingested in wave 2

Jersey numbers (rosters), head coach (schedules `home_coach`/`away_coach`),
team colors (`teams_colors_logos`), kickoff weekday/time for primetime
splits, kickoff temperature/wind for weather splits, and passing/receiving
air yards (weekly stats) are now warehouse columns — see the ✅ rows above.

## Deferred scope (explicit product decisions)

These areas are intentionally not built yet — they are deferred, not missed:

| Area | Decision |
|---|---|
| Injuries, depth charts | Deferred to the future live-fantasy effort ("wave 4c"). nflverse carries the data; ingest + intents are sketched but unshipped. |
| Transactions (trades, free agency, waivers, signings, releases) | Deferred with wave 4c. |
| Fantasy tools, predictions, news | Out of scope for the deterministic answer engine; planned as part of a separate "live fantasy football feedback" product surface. |
| DVOA, QBR | 🚫 permanent refusal — proprietary third-party models; computing them would fabricate numbers. |
| Pressure rate, win probability | 🚫 permanent refusal — require play-level data the warehouse deliberately does not carry. |

The engine's guarantee is *numbers from facts, never hallucinated* — a
tailored refusal is the correct answer wherever the warehouse cannot
support the computation.
