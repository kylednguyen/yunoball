# Domain Coverage Matrix

Status of every domain area against the search engine, verified by the
138-question audit corpus (`apps/server/src/cli/searchAudit.ts`) against a
live 2020–2024 warehouse: **122 answered · 14 tailored refusals · 2 generic
fallbacks · 0 wrong · 0 errors**.

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
| Awards | 🚫 | not in nflverse — tailored refusal |

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
| Founded | 🚫 | not in nflverse — refusal |
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
| Scoring summaries (TDs) | ✅ | scoring_plays: "Chase first touchdown" → *Sep 12, 2021 vs MIN* |
| Play-by-play / Drive summaries | 🚫 | only TD events are distilled — tailored refusal |

## Analysis

| Item | Status | Example |
|---|---|---|
| Comparisons | ✅ | "Mahomes vs Allen career passing yards" |
| Rankings | ✅ | "where does Mahomes rank in career passing yards" → *1st of 3,666* |
| Records (season/single-game highs) | ✅ | "most rushing yards in a season" |
| Milestones ("fastest to…") | 🚫 | needs cumulative timelines — refusal |
| Playoffs (WC/DIV/CON/SB, history) | ✅ | round-aware filters + team playoff logs |
| Championships | ✅ (1999+) | "Chiefs super bowl history" → their SB record |
| Franchise relocations | 🟡 | folded forward at ingest (OAK→LV etc.); not narrated |
| Retired numbers / HOF | 🚫 | not in data — refusal |

## Discovery, aggregation, trends

| Item | Status | Example |
|---|---|---|
| "How many players…" counts | ✅ | "how many players had 1000 rushing yards in 2023" → *12* |
| Sum / Count / Min / Max | ✅ | totals, leaders asc/desc |
| Percentage | ✅ | completion %, catch rate |
| Per game | ✅ | "Jefferson average receiving yards in 2023" → *107.4/game* |
| **Per attempt / carry / reception** | ✅ | "Henry yards per carry in 2023" → *4.2*; YPA, YPR |
| Per drive | 🚫 | needs drive data — refusal |
| Median / rolling averages | 🚫 | refusal |
| First/last N, since/before Week X | ✅ | windows + week ranges |
| Hot/cold & win streaks | 🚫 | refusal (team streak shows on team pages) |

## Advanced analytics

| Item | Status |
|---|---|
| EPA / DVOA / CPOE / success rate / win probability / expected points / pressure rate | 🚫 tailored refusal — proprietary or needs full play-by-play |
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
