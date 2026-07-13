/** The 100-question battery + parser edge cases, run through parseRules.
 *
 * Every input must land in one of three honest buckets:
 *   - a QuerySpec (the warehouse can answer it — asserted on intent/fields)
 *   - a tailored refusal (recognized but unsupported — never a wrong number)
 *   - null (generic honest "can't answer that yet")
 *
 * A wrong-bucket result is the failure mode this suite guards against:
 * answering "Micah Parsons tackles" with anything but a refusal, or turning
 * "which team gives up the fewest rushing yards" into a player leaderboard.
 */

import { describe, expect, it } from "vitest";
import { isRefusal, parseRules } from "../src/engine/parseRules.js";
import type { IndexedPlayer, IndexedTeam } from "../src/engine/resolve.js";

const P = (id: string, name: string, position: string | null): [string, IndexedPlayer][] => {
  const p = { playerId: id, name, position };
  const full = name.toLowerCase();
  const parts = full.split(" ");
  const keys: [string, IndexedPlayer][] = [[full, p], [parts.at(-1)!, p]];
  if (parts.length > 1 && parts[0]!.length >= 3) keys.push([parts[0]!, p]);
  return keys;
};

const INDEX = new Map<string, IndexedPlayer>([
  ...P("P_JALLEN", "Josh Allen", "QB"),
  ...P("P_LAMAR", "Lamar Jackson", "QB"),
  ...P("P_MAHOMES", "Patrick Mahomes", "QB"),
  ...P("P_HENRY", "Derrick Henry", "RB"),
  ...P("P_JJ", "Justin Jefferson", "WR"),
  ...P("P_BURROW", "Joe Burrow", "QB"),
  ...P("P_HURTS", "Jalen Hurts", "QB"),
  ...P("P_CMC", "Christian McCaffrey", "RB"),
  ...P("P_GARRETT", "Myles Garrett", null),
  ...P("P_PARSONS", "Micah Parsons", null),
  ...P("P_CHASE", "Ja'Marr Chase", "WR"),
  ...P("P_SAQUON", "Saquon Barkley", "RB"),
  ...P("P_KELCE", "Travis Kelce", "TE"),
  ...P("P_KITTLE", "George Kittle", "TE"),
  ...P("P_BRADY", "Tom Brady", "QB"),
  ...P("P_PEYTON", "Peyton Manning", "QB"),
  ...P("P_CALEB", "Caleb Williams", "QB"),
  ...P("P_MAYE", "Drake Maye", "QB"),
  ...P("P_STROUD", "C.J. Stroud", "QB"),
  ...P("P_LOVE", "Jordan Love", "QB"),
  // Nickname keys the live resolver installs from its map:
  ["cmc", { playerId: "P_CMC", name: "Christian McCaffrey", position: "RB" }],
  ["tb12", { playerId: "P_BRADY", name: "Tom Brady", position: "QB" }],
]);

const TEAMS = new Map<string, IndexedTeam>(
  [
    ["KC", "Kansas City Chiefs", "Chiefs"],
    ["BUF", "Buffalo Bills", "Bills"],
    ["BAL", "Baltimore Ravens", "Ravens"],
    ["PHI", "Philadelphia Eagles", "Eagles"],
    ["DET", "Detroit Lions", "Lions"],
    ["PIT", "Pittsburgh Steelers", "Steelers"],
    ["GB", "Green Bay Packers", "Packers"],
    ["DAL", "Dallas Cowboys", "Cowboys"],
    ["MIA", "Miami Dolphins", "Dolphins"],
    ["SF", "San Francisco 49ers", "49ers"],
    ["NE", "New England Patriots", "Patriots"],
  ].flatMap(([id, name, nick]): [string, IndexedTeam][] => [
    [name!.toLowerCase(), { teamId: id!, name: name! }],
    [nick!.toLowerCase(), { teamId: id!, name: name! }],
    [name!.replace(` ${nick!}`, "").toLowerCase(), { teamId: id!, name: name! }],
  ]),
);

const parse = (q: string) => parseRules(q, [], INDEX, { latestSeason: 2025, teams: TEAMS });

type Expect =
  | { kind: "answer"; spec: Record<string, unknown> }
  | { kind: "refusal"; contains?: string }
  | { kind: "null" };

const answer = (spec: Record<string, unknown>): Expect => ({ kind: "answer", spec });
const refusal = (contains?: string): Expect => ({ kind: "refusal", contains });
const generic: Expect = { kind: "null" };

function check(question: string, expected: Expect) {
  const result = parse(question);
  if (expected.kind === "answer") {
    expect(result, `${question} -> expected an answerable spec`).not.toBeNull();
    expect(isRefusal(result), `${question} -> unexpectedly refused`).toBe(false);
    expect(result).toMatchObject(expected.spec);
  } else if (expected.kind === "refusal") {
    expect(isRefusal(result), `${question} -> expected a tailored refusal`).toBe(true);
    if (expected.contains && isRefusal(result)) {
      expect(result.refusal.toLowerCase()).toContain(expected.contains.toLowerCase());
    }
  } else {
    expect(result, `${question} -> expected the generic honest fallback`).toBeNull();
  }
}

const CASES: [string, Expect][] = [
  // ---- 1. Basic player stats ----
  ["Josh Allen passing yards in 2024", answer({ intent: "player_total", stat: "passing_yards", season: 2024 })],
  ["Lamar Jackson rushing touchdowns in 2023", answer({ intent: "player_total", stat: "rushing_tds", season: 2023 })],
  ["Patrick Mahomes interceptions this season", answer({ intent: "player_total", stat: "interceptions", season: 2025 })],
  ["Derrick Henry rushing yards", answer({ intent: "player_total", stat: "rushing_yards", scope: "career" })],
  ["Justin Jefferson receiving yards", answer({ intent: "player_total", stat: "receiving_yards" })],
  ["Joe Burrow completion percentage", answer({ intent: "player_total", stat: "completion_pct" })],
  ["Jalen Hurts total touchdowns", answer({ intent: "player_total", stat: "total_tds" })],
  ["Christian McCaffrey scrimmage yards", answer({ intent: "player_total", stat: "scrimmage_yards" })],
  ["Myles Garrett sacks", answer({ intent: "player_total", stat: "def_sacks" })],
  ["Micah Parsons tackles", answer({ intent: "player_total", stat: "tackles" })],
  // ---- 2. Team stats ----
  ["Chiefs offensive ranking", refusal("team")],
  ["Bills points per game", answer({ intent: "team_stat", teamId: "BUF", metric: "points_for", perGame: true })], // upgraded: was a refusal
  ["Ravens defensive stats", refusal()],
  ["Eagles rushing offense", refusal()],
  ["Lions passing offense", refusal()],
  ["Steelers turnovers forced", refusal()],
  ["Packers third down percentage", refusal()],
  ["Cowboys red zone efficiency", refusal()],
  ["Dolphins yards per game", refusal()],
  ["49ers total offense", refusal()],
  // ---- 3. Comparisons ----
  ["Josh Allen vs Lamar Jackson passing yards", answer({ intent: "compare", stat: "passing_yards" })],
  ["Mahomes vs Burrow career stats", answer({ intent: "compare", playerId: "P_MAHOMES", player2Id: "P_BURROW" })],
  ["Justin Jefferson vs Ja'Marr Chase", answer({ intent: "compare", stat: "receiving_yards" })],
  ["Derrick Henry vs Saquon Barkley", answer({ intent: "compare", stat: "rushing_yards" })],
  ["Travis Kelce vs George Kittle", answer({ intent: "compare", stat: "receiving_yards" })],
  ["Bills vs Chiefs offense", refusal()],
  ["Ravens vs Steelers defense", refusal()],
  ["Caleb Williams vs Drake Maye", answer({ intent: "compare" })],
  ["CJ Stroud vs Jordan Love", answer({ intent: "compare", player2Id: "P_LOVE" })],
  ["Tom Brady vs Peyton Manning playoffs", answer({ intent: "compare", seasonType: "POST" })],
  // ---- 4. Filters ----
  ["Josh Allen playoff stats", answer({ intent: "player_total", seasonType: "POST" })],
  ["Lamar Jackson home games only", answer({ intent: "player_total", venue: "home" })],
  ["Mahomes away games", answer({ intent: "player_total", venue: "away" })],
  ["Bills Week 5 stats", refusal("team")],
  ["Chiefs after Week 10", refusal("team")],
  ["Ravens before Week 8", refusal("team")],
  ["Eagles in primetime", refusal("team question")], // primetime STAT splits answer; a bare team+primetime record isn't wired yet
  ["Dolphins vs AFC East", refusal()],
  ["Lions against winning teams", refusal("split")],
  ["Cowboys after bye week", refusal("split")],
  // ---- 5. Career questions ----
  ["Career passing yards", answer({ intent: "leaders", scope: "career", stat: "passing_yards" })],
  ["Career rushing touchdowns", answer({ intent: "leaders", scope: "career", stat: "rushing_tds" })],
  ["Career playoff wins", generic],
  ["Career interceptions", answer({ intent: "leaders", scope: "career", stat: "interceptions" })],
  ["Most career sacks", answer({ intent: "leaders", scope: "career", stat: "def_sacks" })],
  ["Most career receiving yards", answer({ intent: "leaders", scope: "career", stat: "receiving_yards" })],
  ["Longest career", generic],
  ["Career passer rating", answer({ intent: "leaders", stat: "passer_rating", scope: "career" })], // upgraded: was a refusal
  ["Career rushing average", answer({ intent: "leaders", stat: "yards_per_carry", scope: "career" })], // upgraded: was a refusal
  ["Career records", generic],
  // ---- 6. Leaders ----
  ["Passing leader", answer({ intent: "leaders", stat: "passing_yards" })],
  ["Rushing leader", answer({ intent: "leaders", stat: "rushing_yards" })],
  ["Receiving leader", answer({ intent: "leaders", stat: "receiving_yards" })],
  ["Sack leader", answer({ intent: "leaders", stat: "def_sacks" })],
  ["Touchdown leader", answer({ intent: "leaders", stat: "total_tds" })],
  ["Completion percentage leader", answer({ intent: "leaders", stat: "completion_pct" })],
  ["Highest QBR", refusal()],
  ["Most interceptions thrown", answer({ intent: "leaders", stat: "interceptions" })],
  ["Most forced fumbles", answer({ intent: "leaders", stat: "forced_fumbles" })],
  ["Most tackles", answer({ intent: "leaders", stat: "tackles" })],
  // ---- 7. Games / schedules ----
  ["Bills schedule", refusal("scores")],
  // ---- Super Bowls, game results, game logs, drafts (second-layer scope) ----
  ["who won super bowl 50", answer({ intent: "game_result", round: "SB", season: 2015, limit: 1 })],
  ["what was the final score of super bowl xlix", answer({ intent: "game_result", round: "SB", season: 2014 })],
  ["who won the superb owl in 2025", answer({ intent: "game_result", round: "SB", season: 2024 })],
  ["2024 super bowl", answer({ intent: "game_result", round: "SB", season: 2023 })],
  ["what teams played in the 2018 season's super bowl", answer({ intent: "game_result", round: "SB", season: 2018 })],
  ["all super bowls decided by 3 points or fewer", answer({ intent: "game_result", round: "SB", season: null, marginMax: 3 })],
  ["show every chiefs super bowl appearance", answer({ intent: "team_game_log", teamId: "KC", round: "SB" })],
  ["what is the patriots super bowl record", answer({ intent: "team_game_log", teamId: "NE", round: "SB" })],
  ["patrick mahomes super bowl game log", answer({ intent: "game_log", playerId: "P_MAHOMES", sbOnly: true })],
  ["who had the most receiving yards in super bowl liii", answer({ intent: "leaders", stat: "receiving_yards", sbOnly: true, season: 2018 })],
  ["compare brady and mahomes in super bowls", answer({ intent: "compare", sbOnly: true })],
  ["mahomes super bowl lvii stats", answer({ intent: "player_total", playerId: "P_MAHOMES", sbOnly: true, season: 2022 })],
  ["bills vs chiefs result", answer({ intent: "game_result", teamId: "BUF", team2Id: "KC", limit: 1 })],
  ["who won chiefs vs bills in week 11", answer({ intent: "game_result", teamId: "KC", team2Id: "BUF", weekMin: 11, limit: 1 })],
  ["ravens last game", answer({ intent: "game_result", teamId: "BAL", limit: 1 })],
  ["packers game on october 20, 2024", answer({ intent: "game_result", teamId: "GB", gameDate: "2024-10-20" })],
  ["dolphins playoff result", answer({ intent: "game_result", teamId: "MIA", seasonType: "POST", limit: 1 })],
  ["what happened in the afc championship", answer({ intent: "game_result", round: "CON", conf: "AFC" })],
  ["bills 2024 game log", answer({ intent: "team_game_log", teamId: "BUF", season: 2024 })],
  ["chiefs playoff results", answer({ intent: "team_game_log", teamId: "KC", seasonType: "POST" })],
  ["lions last ten games", answer({ intent: "team_game_log", teamId: "DET", limit: 10 })],
  ["ravens road game results", answer({ intent: "team_game_log", teamId: "BAL", venue: "away" })],
  ["packers postseason history", answer({ intent: "team_game_log", teamId: "GB", seasonType: "POST", season: null })],
  ["josh allen game log", answer({ intent: "game_log", playerId: "P_JALLEN" })],
  ["mahomes playoff game log", answer({ intent: "game_log", playerId: "P_MAHOMES", seasonType: "POST" })],
  ["justin jefferson games against green bay", answer({ intent: "game_log", playerId: "P_JJ", opponentId: "GB" })],
  ["lamar jackson home game log", answer({ intent: "game_log", playerId: "P_LAMAR", venue: "home" })],
  ["who was the first pick 2025", answer({ intent: "draft_pick", draftPick: 1, season: 2025, limit: 1 })],
  ["who was the 3rd overall pick in 2020", answer({ intent: "draft_pick", draftPick: 3, season: 2020 })],
  ["when was josh allen drafted", answer({ intent: "draft_pick", playerId: "P_JALLEN" })],
  ["who did the chiefs draft in 2023", answer({ intent: "draft_pick", teamId: "KC", season: 2023 })],
  ["first round picks 2024", answer({ intent: "draft_pick", draftRound: 1, season: 2024 })],
  ["most picks in 2024", answer({ intent: "leaders", stat: "interceptions", season: 2024 })], // draft must not hijack INT vocabulary
  ["Chiefs next game", refusal("scores")],
  ["Eagles last game", answer({ intent: "game_result", teamId: "PHI", limit: 1 })],
  ["Ravens score yesterday", answer({ intent: "game_result", teamId: "BAL", limit: 1 })],
  ["Week 7 schedule", refusal("scores")],
  // Bare broadcast names carry no askable stat — honest generic fallback.
  ["Monday Night Football", generic],
  ["Sunday Night Football", generic],
  ["Thanksgiving games", refusal("split")],
  ["Super Bowl winners", answer({ intent: "game_result", round: "SB", season: null })],
  ["AFC Championship results", answer({ intent: "game_result", round: "CON", conf: "AFC" })],
  // ---- 8. Natural language ----
  ["Who threw the most touchdowns last year?", answer({ intent: "leaders", stat: "passing_tds", season: 2024 })],
  ["Best rushing QB this season", answer({ intent: "leaders", stat: "rushing_yards", position: "QB", season: 2025 })],
  ["Which team has the best defense?", refusal("team")],
  ["Worst offense this year", refusal("team")],
  ["Who is leading the league in sacks?", answer({ intent: "leaders", stat: "def_sacks" })],
  ["Best rookie QB", answer({ intent: "leaders", position: "QB", rookie: true })],
  ["Highest scoring offense", refusal("team")],
  ["Lowest scoring defense", refusal("team")],
  ["Which team gives up the fewest rushing yards?", refusal("team")],
  ["Most explosive receiver", answer({ intent: "leaders", stat: "receiving_yards", position: "WR" })],
  // ---- 9. Advanced ----
  ["Josh Allen first 3 playoff games", answer({ intent: "player_total", firstN: 3, seasonType: "POST" })],
  ["Mahomes last 5 games", answer({ intent: "player_total", lastN: 5 })],
  ["Lamar games over 300 passing yards", answer({ intent: "game_count", threshold: { op: ">", value: 300 } })],
  ["Derrick Henry 100+ rushing yard games", answer({ intent: "game_count", threshold: { op: ">=", value: 100 } })],
  ["Justin Jefferson games with 2 touchdowns", answer({ intent: "game_count", stat: "receiving_tds" })],
  ["Bills record when Allen throws 3 TDs", refusal("split")],
  ["Chiefs games decided by 7 points or less", answer({ intent: "team_game_log", teamId: "KC", marginMax: 7 })],
  ["Ravens overtime record", refusal("split")],
  ["Lions comeback wins", refusal("split")],
  // ---- 10. Edge cases ----
  ["pat mahomes stats", answer({ intent: "player_total", playerId: "P_MAHOMES" })],
  ["josh allen bills qb", answer({ intent: "player_total", playerId: "P_JALLEN" })],
  ["allen passing stats", answer({ intent: "player_total", stat: "passing_yards" })],
  ["show me mahomes", answer({ intent: "player_seasons", playerId: "P_MAHOMES" })],
  ["2023 playoffs chiefs", refusal("team")],
  ["best qb", answer({ intent: "leaders", position: "QB", stat: "passing_yards", season: 2025 })],
  ["top wr", answer({ intent: "leaders", position: "WR", season: 2025 })],
  ["compare allen mahomes burrow", refusal("two players")],
  ["who has the most?", generic],
  ["stats", generic],
  // ---- Parser edge cases: nicknames ----
  ["CMC rushing yards", answer({ intent: "player_total", playerId: "P_CMC" })],
  ["TB12 passing touchdowns", answer({ intent: "player_total", playerId: "P_BRADY" })],
  // ---- date expressions ----
  ["Mahomes last game", answer({ intent: "player_total", lastN: 1 })],
  ["Justin Jefferson rookie year", answer({ intent: "player_total", rookie: true })],
  ["Josh Allen after Week 8", answer({ intent: "player_total", weekMin: 9 })],
  ["Josh Allen before Week 10", answer({ intent: "player_total", weekMax: 9 })],
  ["Josh Allen through Week 12", answer({ intent: "player_total", weekMax: 12 })],
  // ---- numeric filters ----
  ["Mahomes games with at least 3 touchdowns", answer({ intent: "game_count", threshold: { op: ">=", value: 3 } })],
  ["Jefferson games with more than 10 catches", answer({ intent: "game_count", stat: "receptions", threshold: { op: ">", value: 10 } })],
  ["Lamar games under 50 rushing yards", answer({ intent: "game_count", threshold: { op: "<", value: 50 } })],
  // ---- multi-entity / sorting ----
  ["Josh Allen and Lamar Jackson", answer({ intent: "compare" })],
  ["top 10 QBs", answer({ intent: "leaders", position: "QB", limit: 10 })],
  ["every rookie receiver", answer({ intent: "leaders", position: "WR", rookie: true })],
  ["fewest interceptions this season", answer({ intent: "leaders", stat: "interceptions", dir: "asc" })],
  // ---- Super Bowl narrows to each postseason's final game ----
  ["most touchdowns in the superbowl", answer({ intent: "leaders", sbOnly: true, seasonType: "POST" })],
  ["Mahomes super bowl passing yards", answer({ intent: "player_total", sbOnly: true })],
  // A QB asked about sacks means sacks TAKEN, not sacks made.
  ["Joe Burrow sacks", answer({ intent: "player_total", stat: "sacks_taken" })],
  // ---- week filters ride through leaders (and imply postseason past wk 18) ----
  ["most touchdowns in week 22", answer({ intent: "leaders", weekMin: 22, weekMax: 22, seasonType: "POST" })],
  ["most passing yards in week 5", answer({ intent: "leaders", weekMin: 5, weekMax: 5, seasonType: "REG" })],
  // ---- impossible-but-honest ----
  ["Mahomes receiving touchdowns", answer({ intent: "player_total", stat: "receiving_tds" })],
  ["Justin Jefferson passing yards", answer({ intent: "player_total", stat: "passing_yards" })],
  ["Brady 2025 stats", answer({ intent: "player_total", season: 2025 })],
  ["Bills score tomorrow", refusal("scores")],
  ["Chiefs 2030 record", answer({ intent: "team_game_log", teamId: "KC", season: 2030 })], // auditor turns this into no-data
  // ---- player bio / roster (answered from the players dimension) ----
  ["what team does Justin Jefferson play for", answer({ intent: "player_bio", bioField: "team", playerId: "P_JJ" })],
  ["how old is Patrick Mahomes", answer({ intent: "player_bio", bioField: "age", playerId: "P_MAHOMES" })],
  ["how tall is Josh Allen", answer({ intent: "player_bio", bioField: "height", playerId: "P_JALLEN" })],
  ["what college did Travis Kelce go to", answer({ intent: "player_bio", bioField: "college", playerId: "P_KELCE" })],
  ["tallest player", answer({ intent: "player_bio", bioField: "height", dir: "desc" })],
  ["oldest quarterback", answer({ intent: "player_bio", bioField: "age", dir: "desc", position: "QB" })],
  // ---- per-game rate, season range, league count, rank ----
  ["Justin Jefferson yards per game in 2023", answer({ intent: "player_total", perGame: true, playerId: "P_JJ", season: 2023 })],
  ["passing yards from 2021 to 2023", answer({ intent: "leaders", seasonMin: 2021, seasonMax: 2023 })],
  ["Derrick Henry rushing yards over the last 3 seasons", answer({ intent: "player_total", perGame: false, seasonMin: 2023, seasonMax: 2025, playerId: "P_HENRY" })],
  ["how many players had 1000 rushing yards in 2023", answer({ intent: "qualifying_count", stat: "rushing_yards", season: 2023 })],
  ["how many QBs threw for 4000 yards in 2023", answer({ intent: "qualifying_count", position: "QB", stat: "passing_yards", season: 2023 })],
  ["where does Patrick Mahomes rank in career passing yards", answer({ intent: "player_rank", stat: "passing_yards", playerId: "P_MAHOMES", scope: "career" })],
  ["where does Patrick Mahomes rank in completion percentage", answer({ intent: "player_rank", stat: "completion_pct", playerId: "P_MAHOMES" })],
  ["how many players had 100 receptions in 2023", answer({ intent: "qualifying_count", stat: "receptions", season: 2023 })],
  ["highest rushing yards per game in 2023", answer({ intent: "leaders", perGame: true, stat: "rushing_yards", season: 2023 })],
  ["Josh Allen passing yards at home per game in 2023", answer({ intent: "player_total", perGame: true, venue: "home", playerId: "P_JALLEN" })],
  // ---- rate stats (ratio machinery) ----
  ["Derrick Henry yards per carry in 2023", answer({ intent: "player_total", stat: "yards_per_carry", playerId: "P_HENRY", season: 2023 })],
  ["highest ypc in 2023", answer({ intent: "leaders", stat: "yards_per_carry", season: 2023 })],
  ["Josh Allen yards per attempt", answer({ intent: "player_total", stat: "yards_per_attempt", playerId: "P_JALLEN" })],
  ["Travis Kelce catch rate in 2023", answer({ intent: "player_total", stat: "catch_rate", playerId: "P_KELCE" })],
  // ---- month splits ----
  ["Derrick Henry rushing yards in December 2023", answer({ intent: "player_total", month: 12, season: 2023 })],
  ["most passing touchdowns in january", answer({ intent: "leaders", stat: "passing_tds", month: 1 })],
  // ---- player metadata: teams / experience ----
  ["what teams has Derrick Henry played for", answer({ intent: "player_bio", bioField: "teams", playerId: "P_HENRY" })],
  ["how many seasons has Patrick Mahomes played", answer({ intent: "player_bio", bioField: "experience", playerId: "P_MAHOMES" })],
  // ---- team metadata / stats / roster / leaders ----
  ["what division are the chiefs in", answer({ intent: "team_bio", teamField: "division", teamId: "KC" })],
  ["where do the packers play their home games", answer({ intent: "team_bio", teamField: "stadium", teamId: "GB" })],
  ["how many points did the chiefs score in 2023", answer({ intent: "team_stat", metric: "points_for", teamId: "KC", season: 2023 })],
  ["bills points allowed per game in 2024", answer({ intent: "team_stat", metric: "points_against", perGame: true, teamId: "BUF" })],
  ["eagles rushing yards in 2022", answer({ intent: "team_stat", stat: "rushing_yards", teamId: "PHI", metric: null })],
  ["who led the chiefs in receiving yards in 2023", answer({ intent: "leaders", teamId: "KC", stat: "receiving_yards", season: 2023 })],
  ["chiefs roster 2023", answer({ intent: "team_roster", teamId: "KC", season: 2023 })],
  ["who played for the bills in 2022", answer({ intent: "team_roster", teamId: "BUF", season: 2022 })],
  // ---- wave 2: jersey / coach / colors / primetime / weather / air yards ----
  ["what number does Patrick Mahomes wear", answer({ intent: "player_bio", bioField: "jersey", playerId: "P_MAHOMES" })],
  ["who coaches the chiefs", answer({ intent: "team_bio", teamField: "coach", teamId: "KC" })],
  ["what are the packers colors", answer({ intent: "team_bio", teamField: "colors", teamId: "GB" })],
  ["Josh Allen passing yards in primetime in 2023", answer({ intent: "player_total", primetime: true, season: 2023 })],
  ["most rushing yards in primetime 2023", answer({ intent: "leaders", primetime: true, stat: "rushing_yards" })],
  ["Josh Allen passing yards in freezing weather", answer({ intent: "player_total", tempMax: 32 })],
  ["Ja'Marr Chase air yards in 2023", answer({ intent: "player_total", stat: "receiving_air_yards", playerId: "P_CHASE" })],
  ["Patrick Mahomes air yards in 2023", answer({ intent: "player_total", stat: "passing_air_yards" })],
  ["most receiving air yards in 2023", answer({ intent: "leaders", stat: "receiving_air_yards" })],
  // ---- wave 3: awards / streaks / milestones / medians / franchise ----
  ["who won mvp in 2023", answer({ intent: "award", award: "MVP", season: 2023 })],
  ["who won the super bowl mvp in 2022", answer({ intent: "award", award: "SBMVP" })],
  ["how many mvps does Tom Brady have", answer({ intent: "award", award: "MVP", playerId: "P_BRADY" })],
  ["Derrick Henry median rushing yards in 2023", answer({ intent: "player_total", median: true, playerId: "P_HENRY" })],
  ["Justin Jefferson 5-game rolling average receiving yards", answer({ intent: "player_total", perGame: true, lastN: 5 })],
  ["chiefs winning streak", answer({ intent: "team_streak", teamId: "KC", kind: "win" })],
  ["Dolphins losing streak", answer({ intent: "team_streak", teamId: "MIA", kind: "loss" })],
  ["Derrick Henry games in a row with a rushing touchdown", answer({ intent: "player_streak", playerId: "P_HENRY", stat: "rushing_tds" })],
  ["when were the packers founded", answer({ intent: "team_bio", teamField: "founded", teamId: "GB" })],
  ["did the raiders relocate", generic], // LV not in the battery team fixture; live resolver answers
  // ---- routing guards: game lookups must not be hijacked by team-info ----
  ["what was the score of the eagles game", answer({ intent: "game_result", teamId: "PHI" })],
  ["chiefs record in 2023", answer({ intent: "team_game_log", teamId: "KC", season: 2023 })],
  // ---- still genuinely unanswerable ----
  ["Josh Allen QBR in 2023", refusal("passer rating")],
  ["longest touchdown of 2023", answer({ intent: "scoring", longest: true, season: 2023 })], // upgraded: was a refusal
  ["fastest to 10000 passing yards", answer({ intent: "milestone", stat: "passing_yards", target: 10000 })], // upgraded: was a refusal
  ["was Justin Jefferson traded", refusal("transactions")],
  ["chiefs depth chart", refusal("depth charts")],
  ["patriots injury report", refusal("injury")],
  ["who made the pro bowl in 2023", refusal("awards")],
];

describe("the 100-question battery + parser edge cases", () => {
  it.each(CASES)("%s", (question, expected) => {
    check(question, expected);
  });
});
