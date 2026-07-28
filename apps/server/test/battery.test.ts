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
  ...P("P_DIGGS", "Stefon Diggs", "WR"),
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
  // ---- "since YYYY" season ranges (the range must never be silently dropped) ----
  ["most passing yards since 2020", answer({ intent: "leaders", stat: "passing_yards", season: null, seasonMin: 2020, seasonMax: 2025, scope: "career" })],
  ["who has the most receptions since 2022", answer({ intent: "leaders", stat: "receptions", seasonMin: 2022, seasonMax: 2025, scope: "career" })],
  ["most rushing tds since 2015", answer({ intent: "leaders", stat: "rushing_tds", seasonMin: 2015, seasonMax: 2025 })],
  // "in a season since YYYY" stays a single-season record board, bounded.
  ["most rushing yards in a season since 2015", answer({ intent: "leaders", stat: "rushing_yards", season: null, seasonMin: 2015, seasonMax: 2025, scope: "season" })],
  ["Derrick Henry rushing yards since 2020", answer({ intent: "player_total", playerId: "P_HENRY", seasonMin: 2020, seasonMax: 2025, scope: "career" })],
  ["how many games did Josh Allen throw for 300 yards since 2020", answer({ intent: "game_count", playerId: "P_JALLEN", seasonMin: 2020, seasonMax: 2025, threshold: { op: ">=", value: 300 } })],
  // ---- threshold game counts: word numbers, "above", "or more" ----
  ["How many games did Lamar have above a 100 passer rating?", answer({ intent: "game_count", stat: "passer_rating", playerId: "P_LAMAR", threshold: { op: ">", value: 100 } })],
  ["How many games did Josh Allen throw at least three touchdowns?", answer({ intent: "game_count", stat: "passing_tds", playerId: "P_JALLEN", threshold: { op: ">=", value: 3 } })],
  ["How many games did Christian McCaffrey have at least 100 rushing yards?", answer({ intent: "game_count", stat: "rushing_yards", playerId: "P_CMC", threshold: { op: ">=", value: 100 } })],
  ["How many playoff games did Mahomes have a passer rating above 100?", answer({ intent: "game_count", stat: "passer_rating", seasonType: "POST", threshold: { op: ">", value: 100 } })],
  ["Josh Allen games over 25 fantasy points", answer({ intent: "game_count", stat: "fantasy_points_ppr", threshold: { op: ">", value: 25 } })],
  // ---- qualifying-game count leaderboards ----
  ["Which quarterback had the most games with a passer rating over 100?", answer({ intent: "game_count_leaders", stat: "passer_rating", position: "QB", threshold: { op: ">", value: 100 } })],
  ["Who has the most games with over 300 passing yards?", answer({ intent: "game_count_leaders", stat: "passing_yards", threshold: { op: ">", value: 300 } })],
  ["Who had the most games with two or more receiving touchdowns?", answer({ intent: "game_count_leaders", stat: "receiving_tds", threshold: { op: ">=", value: 2 } })],
  ["Which player had the most 100-yard rushing games after turning 30?", answer({ intent: "game_count_leaders", stat: "rushing_yards", threshold: { op: ">=", value: 100 }, minAgeYears: 30 })],
  ["who had the most 100-yard rushing games before their fifth season", answer({ intent: "game_count_leaders", stat: "rushing_yards", threshold: { op: ">=", value: 100 }, beforeSeasonN: 5 })],
  ["most games with over 300 passing yards in 2023", answer({ intent: "game_count_leaders", season: 2023, scope: "season" })],
  // ---- Task 2: first-N-games / first-N-seasons leaderboard windows
  // (exact benchmark wording from .superpowers/sdd/q100.txt, numbers noted) ----
  ["Who scored the most touchdowns in his first three NFL seasons?", // q9
    answer({ intent: "leaders", stat: "total_tds", beforeSeasonN: 4, firstN: null, scope: "career" })],
  ["Who scored the most touchdowns through his first 50 career games?", // q10
    answer({ intent: "leaders", stat: "total_tds", firstN: 50, beforeSeasonN: null })],
  ["Who scored the most touchdowns through his first 100 career games?", // q11
    answer({ intent: "leaders", stat: "total_tds", firstN: 100 })],
  ["Who gained the most rushing yards before his fifth NFL season?", // q22
    answer({ intent: "leaders", stat: "rushing_yards", beforeSeasonN: 5 })],
  ["Who had the most rushing yards through his first 50 games?", // q23
    answer({ intent: "leaders", stat: "rushing_yards", firstN: 50 })],
  ["Who had the most rushing yards through his first 100 games?", // q24
    answer({ intent: "leaders", stat: "rushing_yards", firstN: 100 })],
  ["Which quarterback has the most rushing yards in his first five seasons?", // q37
    answer({ intent: "leaders", stat: "rushing_yards", position: "QB", beforeSeasonN: 6 })],
  ["Who threw the most touchdown passes before his fifth NFL season?", // q41
    answer({ intent: "leaders", stat: "passing_tds", beforeSeasonN: 5 })],
  ["Who threw the most touchdown passes through his first 50 starts?", // q42
    answer({ intent: "leaders", stat: "passing_tds", firstN: 50, startsPhrase: true })],
  ["Who threw the most touchdown passes through his first 100 starts?", // q43
    answer({ intent: "leaders", stat: "passing_tds", firstN: 100, startsPhrase: true })],
  ["Who had the most passing yards through his first three seasons?", // q44
    answer({ intent: "leaders", stat: "passing_yards", beforeSeasonN: 4 })],
  ["Who had the most passing yards through his first five seasons?", // q45
    answer({ intent: "leaders", stat: "passing_yards", beforeSeasonN: 6 })],
  ["Who had the most receiving yards before his fifth NFL season?", // q61
    answer({ intent: "leaders", stat: "receiving_yards", beforeSeasonN: 5 })],
  ["Who had the most receptions before his fifth NFL season?", // q62
    answer({ intent: "leaders", stat: "receptions", beforeSeasonN: 5 })],
  ["Who had the most receiving touchdowns before his fifth NFL season?", // q63
    answer({ intent: "leaders", stat: "receiving_tds", beforeSeasonN: 5 })],
  ["Who had the most receiving yards through his first 50 games?", // q64
    answer({ intent: "leaders", stat: "receiving_yards", firstN: 50 })],
  ["Who had the most receptions through his first 100 games?", // q65
    answer({ intent: "leaders", stat: "receptions", firstN: 100 })],
  ["Which tight end had the most receiving yards in his first five seasons?", // q78
    answer({ intent: "leaders", stat: "receiving_yards", position: "TE", beforeSeasonN: 6 })],
  ["Who had the most sacks through his first 50 games?", // q83
    answer({ intent: "leaders", stat: "def_sacks", firstN: 50 })],
  ["Who had the most interceptions through his first 100 games?", // q84
    answer({ intent: "leaders", stat: "interceptions", firstN: 100 })],
  ["Who scored the most total touchdowns in his first 10 playoff games?", // q96
    answer({ intent: "leaders", stat: "total_tds", firstN: 10, seasonType: "POST", startsPhrase: false })],
  // ---- Task 3: age-window ("after turning N") aggregate leaderboards
  // (exact benchmark wording from .superpowers/sdd/q100.txt, numbers noted) ----
  ["Who scored the most touchdowns after turning 30?", // q12
    answer({ intent: "leaders", stat: "total_tds", minAgeYears: 30 })],
  ["Who scored the most touchdowns after turning 35?", // q13
    answer({ intent: "leaders", stat: "total_tds", minAgeYears: 35 })],
  ["Who recorded the most rushing yards after turning 30?", // q25
    answer({ intent: "leaders", stat: "rushing_yards", minAgeYears: 30 })],
  ["Who recorded the most rushing yards after turning 35?", // q26
    answer({ intent: "leaders", stat: "rushing_yards", minAgeYears: 35 })],
  ["Who threw the most touchdown passes after turning 35?", // q46
    answer({ intent: "leaders", stat: "passing_tds", minAgeYears: 35 })],
  ["Who threw the most touchdown passes after turning 40?", // q47
    answer({ intent: "leaders", stat: "passing_tds", minAgeYears: 40 })],
  ["Who recorded the most receiving yards after turning 30?", // q66
    answer({ intent: "leaders", stat: "receiving_yards", minAgeYears: 30 })],
  ["Who recorded the most receiving yards after turning 35?", // q67
    answer({ intent: "leaders", stat: "receiving_yards", minAgeYears: 35 })],
  ["Who recorded the most sacks after turning 30?", // q85
    answer({ intent: "leaders", stat: "def_sacks", minAgeYears: 30 })],
  ["Who recorded the most sacks after turning 35?", // q86
    answer({ intent: "leaders", stat: "def_sacks", minAgeYears: 35 })],
  // Combined windows land BOTH fields on the spec (AND filters in the
  // executor) — never first-match-wins with a narration that lies about
  // which filter ran.
  ["Who scored the most touchdowns after turning 30 in his first three seasons?",
    answer({ intent: "leaders", stat: "total_tds", minAgeYears: 30, beforeSeasonN: 4, firstN: null })],
  ["Who scored the most touchdowns through his first 100 games after turning 30?",
    answer({ intent: "leaders", stat: "total_tds", firstN: 100, minAgeYears: 30 })],
  // q97 needs a MAX-age filter (Task 2's rule) — must refuse, never
  // silently answer a plain POST board; still true after Task 3.
  ["Who threw the most playoff touchdown passes before turning 25?", refusal("maximum-age")],
  // The no-"NFL" phrasing must answer identically to q22 (one regex source).
  ["Who gained the most rushing yards before his fifth season?",
    answer({ intent: "leaders", stat: "rushing_yards", beforeSeasonN: 5 })],
  // Age/experience splits refuse anywhere they aren't computed.
  ["Derrick Henry rushing yards after turning 30", refusal("qualifying-game")],
  ["most 100-yard rushing games against winning teams", refusal("split")],
  // ---- Task 4: TD-distance + defensive-TD scoring boards over scoring_plays
  // (exact benchmark wording from .superpowers/sdd/q100.txt, numbers noted) ----
  ["Who has scored the most 1-yard touchdowns in NFL history?", // q1
    answer({ intent: "scoring_board", yardsMin: 1, yardsMax: 1, tdKind: null, scope: "career" })],
  ["Who has scored the most touchdowns from inside the 5-yard line?", // q2
    answer({ intent: "scoring_board", yardsMin: null, yardsMax: 5, tdKind: null })],
  ["Who has scored the most rushing touchdowns from exactly 1 yard out?", // q3
    answer({ intent: "scoring_board", yardsMin: 1, yardsMax: 1, tdKind: "rush" })],
  ["Who has scored the most receiving touchdowns from exactly 1 yard out?", // q4
    answer({ intent: "scoring_board", yardsMin: 1, yardsMax: 1, tdKind: "pass" })],
  ["Who has scored the most touchdowns of 50 or more yards?", // q5
    answer({ intent: "scoring_board", yardsMin: 50, yardsMax: null, tdKind: null })],
  ["Who has scored the most touchdowns of 75 or more yards?", // q6
    answer({ intent: "scoring_board", yardsMin: 75, yardsMax: null })],
  ["Who has scored the most touchdowns of 90 or more yards?", // q7
    answer({ intent: "scoring_board", yardsMin: 90, yardsMax: null })],
  ["Who has the most defensive touchdowns in NFL history?", // q91
    answer({ intent: "scoring_board", tdKind: "defense", yardsMin: null, yardsMax: null })],
  ["Who has the most interception-return touchdowns?", // q92
    answer({ intent: "scoring_board", tdKind: "int_return" })],
  ["Who has the most fumble-return touchdowns?", // q93
    answer({ intent: "scoring_board", tdKind: "fumble_return" })],
  // Variants: "50+ yard touchdowns", pick sixes, season + week scoping.
  ["most 50+ yard touchdowns", answer({ intent: "scoring_board", yardsMin: 50, yardsMax: null })],
  ["who has the most pick sixes", answer({ intent: "scoring_board", tdKind: "int_return" })],
  ["most defensive touchdowns in 2023",
    answer({ intent: "scoring_board", tdKind: "defense", season: 2023, scope: "season" })],
  ["most 1-yard rushing touchdowns in the playoffs",
    answer({ intent: "scoring_board", yardsMin: 1, yardsMax: 1, tdKind: "rush", seasonType: "POST" })],
  // Player-scoped distance counts stay honest refusals (league boards only).
  ["Derrick Henry 5-yard touchdowns", refusal("play length")],
  ["Who scored the most 1-yard touchdowns?", // pre-Task-4 wording, now answers
    answer({ intent: "scoring_board", yardsMin: 1, yardsMax: 1 })],
  ["Josh Allen QBR in 2023", refusal("passer rating")],
  ["longest touchdown of 2023", answer({ intent: "scoring", longest: true, season: 2023 })], // upgraded: was a refusal
  ["fastest to 10000 passing yards", answer({ intent: "milestone", stat: "passing_yards", target: 10000 })], // upgraded: was a refusal
  ["was Justin Jefferson traded", refusal("transactions")],
  ["chiefs depth chart", refusal("depth charts")],
  ["patriots injury report", refusal("injury")],
  ["who made the pro bowl in 2023", refusal("awards")],
  // ---- Teammate combos ("X stats with Y": same game, same team) ----
  ["josh allen passer rating with stefon diggs",
    answer({ intent: "player_total", stat: "passer_rating", playerId: "P_JALLEN", withPlayerId: "P_DIGGS" })],
  ["travis kelce receiving yards with patrick mahomes", // reverse direction: subject is half one, never the more-prominent name
    answer({ intent: "player_total", stat: "receiving_yards", playerId: "P_KELCE", withPlayerId: "P_MAHOMES" })],
  ["joe burrow games with 3 passing touchdowns with jamarr chase", // threshold + teammate compose
    answer({ intent: "game_count", playerId: "P_BURROW", withPlayerId: "P_CHASE" })],
  ["lamar jackson games with 3 passing touchdowns", // threshold phrasing must NOT trip the combo path
    answer({ intent: "game_count", playerId: "P_LAMAR", withPlayerId: null })],
  ["joe burrow passing yards to jamarr chase", // targeting → disclosed played-together split
    answer({ intent: "player_total", stat: "passing_yards", playerId: "P_BURROW", withPlayerId: "P_CHASE", pairingApprox: true })],
  ["jamarr chase receiving yards from joe burrow", // receiver-side pairing, same stand-in
    answer({ intent: "player_total", stat: "receiving_yards", playerId: "P_CHASE", withPlayerId: "P_BURROW", pairingApprox: true })],
  ["joe burrow most passing yards in a game with jamarr chase", // single-game bests compose the with-window now
    answer({ intent: "single_game", stat: "passing_yards", playerId: "P_BURROW", withPlayerId: "P_CHASE" })],
  ["mahomes most passing yards in a game vs the bills", // …and the opponent window
    answer({ intent: "single_game", stat: "passing_yards", playerId: "P_MAHOMES", opponentId: "BUF" })],
  ["josh allen passing yards from 2021 to 2023", // season ranges never read as a from-pairing
    answer({ intent: "player_total", stat: "passing_yards", playerId: "P_JALLEN", seasonMin: 2021, seasonMax: 2023, withPlayerId: null })],
  ["derrick henry compared to saquon barkley", // "compared to" routes to compare, never a pairing
    answer({ intent: "compare", playerId: "P_HENRY", player2Id: "P_SAQUON" })],
  ["passer rating with jamarr chase", refusal("named player")],
  // ---- Workflow-confirmed defect pins (verify run wf_90104bf5) ----
  ["joe burrow games with 2 passing touchdowns to jamarr chase", // targeting inside a with-half still discloses
    answer({ intent: "game_count", playerId: "P_BURROW", withPlayerId: "P_CHASE", pairingApprox: true })],
  ["who threw the most passing touchdowns to travis kelce", // passer board keyed on target: refuse, never subject-flip
    refusal("pass-target")],
  ["mahomes most passing yards in a playoff game", // adjective between "a" and "game"
    answer({ intent: "single_game", playerId: "P_MAHOMES", seasonType: "POST" })],
  ["derrick henry most rushing yards in a road game",
    answer({ intent: "single_game", playerId: "P_HENRY", venue: "away" })],
  ["josh allen most passing yards in a primetime game",
    answer({ intent: "single_game", playerId: "P_JALLEN", primetime: true })],
  ["most rushing yards in a super bowl", // all-time single-SB board, never pinned to the latest season
    answer({ intent: "single_game", stat: "rushing_yards", sbOnly: true, season: null, playerId: null })],
  // ---- Opponent splits ("X vs the <team>": games against one opponent) ----
  ["mahomes vs the bills", // bare form defaults to the position's primary stat
    answer({ intent: "player_total", stat: "passing_yards", playerId: "P_MAHOMES", opponentId: "BUF" })],
  ["patrick mahomes passer rating against the bills",
    answer({ intent: "player_total", stat: "passer_rating", playerId: "P_MAHOMES", opponentId: "BUF" })],
  ["josh allen completion percentage against buffalo", // city form, no "the"
    answer({ intent: "player_total", stat: "completion_pct", playerId: "P_JALLEN", opponentId: "BUF" })],
  ["josh allen stats vs the chiefs defense", // unit word names the opponent, not a team-unit ask
    answer({ intent: "player_total", playerId: "P_JALLEN", opponentId: "KC" })],
  ["mahomes games with 300 passing yards against the bills", // threshold + opponent compose
    answer({ intent: "game_count", playerId: "P_MAHOMES", opponentId: "BUF" })],
  ["josh allen passer rating vs the chiefs in the playoffs", // opponent + season-type compose
    answer({ intent: "player_total", playerId: "P_JALLEN", opponentId: "KC", seasonType: "POST" })],
  ["derrick henry rushing yards against the steelers in 2020",
    answer({ intent: "player_total", stat: "rushing_yards", playerId: "P_HENRY", opponentId: "PIT", season: 2020 })],
  ["mahomes vs josh allen", // player-vs-player still compares, never an opponent split
    answer({ intent: "compare", playerId: "P_MAHOMES", player2Id: "P_JALLEN" })],
  ["Chiefs offensive ranking vs the bills", refusal("team")], // no player subject: team-unit refusal stands
  // ---- Task 5: opponent + game-result context boards
  // (exact benchmark wording from .superpowers/sdd/q100.txt, numbers noted) ----
  ["Who scored the most touchdowns in games his team lost?", // q17
    answer({ intent: "leaders", stat: "total_tds", gameResult: "L", oneScore: false, scope: "career" })],
  ["Who scored the most touchdowns in one-score games?", // q18
    answer({ intent: "leaders", stat: "total_tds", gameResult: null, oneScore: true, scope: "career" })],
  ["Who scored the most touchdowns against teams with winning records?", // q19
    answer({ intent: "leaders", stat: "total_tds", oppWinningRecord: true, scope: "career" })],
  ["Who has scored the most touchdowns against one specific opponent?", // q20
    answer({ intent: "leaders", stat: "total_tds", perOpponent: true, scope: "career" })],
  ["Who has the most career rushing yards in games his team lost?", // q27
    answer({ intent: "leaders", stat: "rushing_yards", gameResult: "L", scope: "career" })],
  ["Who has the most rushing yards against a single opponent?", // q40
    answer({ intent: "leaders", stat: "rushing_yards", perOpponent: true, scope: "career" })],
  ["Who has the most games with at least three interceptions and still won?", // q57
    answer({
      intent: "game_count_leaders", stat: "interceptions",
      threshold: { op: ">=", value: 3 }, gameResult: "W", andStat: null,
    })],
  ["Who threw the most touchdown passes in games his team lost?", // q58
    answer({ intent: "leaders", stat: "passing_tds", gameResult: "L", scope: "career" })],
  ["Who has the most passing yards in one-score losses?", // q59
    answer({ intent: "leaders", stat: "passing_yards", gameResult: "L", oneScore: true, scope: "career" })],
  ["Who has thrown the most touchdown passes against a single opponent?", // q60
    answer({ intent: "leaders", stat: "passing_tds", perOpponent: true, scope: "career" })],
  ["Who has the most receiving yards in games his team lost?", // q76
    answer({ intent: "leaders", stat: "receiving_yards", gameResult: "L", scope: "career" })],
  ["Who has the most receiving touchdowns in one-score games?", // q77
    answer({ intent: "leaders", stat: "receiving_tds", oneScore: true, scope: "career" })],
  ["Who has the most receiving yards against a single opponent?", // q80
    answer({ intent: "leaders", stat: "receiving_yards", perOpponent: true, scope: "career" })],
  // "against a single quarterback" (q94, q95) is NOT attributable — sacks and
  // interceptions are recorded against the opposing TEAM in the warehouse,
  // never a specific opposing quarterback. Deliberately excluded from
  // PER_OPPONENT_RE, so the parser builds a plain leaderboard (no
  // perOpponent) and the audit guard refuses it by name (see audit.test.ts).
  ["Who has the most sacks against a single quarterback?", // q94
    answer({ intent: "leaders", stat: "def_sacks" })],
  ["Who has the most interceptions against a single quarterback?", // q95
    answer({ intent: "leaders", stat: "interceptions" })],
  ["Who has the most career games with both a rushing and receiving touchdown?", // q99
    answer({
      intent: "game_count_leaders", stat: "rushing_tds",
      threshold: { op: ">=", value: 1 },
      andStat: "receiving_tds", andThreshold: { op: ">=", value: 1 },
      scope: "career",
    })],
  ["Who has the most career games with at least one passing and one rushing touchdown?", // q100
    answer({
      intent: "game_count_leaders", stat: "passing_tds",
      threshold: { op: ">=", value: 1 },
      andStat: "rushing_tds", andThreshold: { op: ">=", value: 1 },
      scope: "career",
    })],
  // Variant wording: "close" is a synonym for "one-score"; the combined
  // one-score-loss phrase collapses to one narration phrase, not two.
  ["most rushing yards in close losses",
    answer({ intent: "leaders", stat: "rushing_yards", gameResult: "L", oneScore: true })],
  // Ascending per-opponent boards carry dir asc — the executor must flip the
  // ORDER BY, not answer the maximum narrated as "fewest".
  ["Who has scored the fewest touchdowns against a single opponent?",
    answer({ intent: "leaders", stat: "total_tds", perOpponent: true, dir: "asc" })],
  // ---- Task 6: derived-negation ("without") boards
  // (exact benchmark wording from .superpowers/sdd/q100.txt, numbers noted) ----
  ["Who has the most career touchdowns without ever leading the league in touchdowns?", // q16
    answer({ intent: "leaders", stat: "total_tds", withoutLeagueLead: true, scope: "career" })],
  ["Who has the most career rushing yards without a 1,500-yard season?", // q21
    answer({ intent: "leaders", stat: "rushing_yards", withoutSeasonAtLeast: 1500, scope: "career" })],
  // Pro Bowl (q28, q88) is an awards-dependent negation — it never reaches
  // the "without" machinery at all: the existing Pro Bowl UNSUPPORTED entry
  // refuses it directly, same mechanism as "who made the pro bowl in 2023"
  // above.
  ["Who has the most career rushing yards without making a Pro Bowl?", refusal("awards")], // q28
  ["Who has the most career interceptions without making a Pro Bowl?", refusal("awards")], // q88
  // q29 keeps its Task-5 game_count_leaders shape unchanged (the rushing-
  // title exclusion isn't implemented — the documented call in the plan is
  // to keep this refusing; see audit.test.ts for the "still refuses" case).
  ["Who has the most 100-yard rushing games without winning a rushing title?", // q29
    answer({ intent: "game_count_leaders", stat: "rushing_yards", threshold: { op: ">=", value: 100 } })],
  ["Who has the most rushing attempts without scoring a touchdown?", // q35
    answer({
      intent: "leaders", stat: "carries",
      crossStat: "rushing_tds", crossOp: "=", crossValue: 0, scope: "career",
    })],
  // Review repro: the TD side must come from the stat itself (receptions ->
  // RECEIVING touchdowns), never a string-prefix rushing default — the
  // pre-fix parser answered this with SUM(rushing_tds)=0, nonsense for WRs.
  ["Who has the most receptions without scoring a touchdown?",
    answer({
      intent: "leaders", stat: "receptions",
      crossStat: "receiving_tds", crossOp: "=", crossValue: 0, scope: "career",
    })],
  ["Who has the most rushing touchdowns with fewer than 1,000 career rushing yards?", // q36
    answer({
      intent: "leaders", stat: "rushing_tds",
      crossStat: "rushing_yards", crossOp: "<", crossValue: 1000, scope: "career",
    })],
  ["Who has the most passing yards without ever leading the NFL in passing yards?", // q48
    answer({ intent: "leaders", stat: "passing_yards", withoutLeagueLead: true, scope: "career" })],
  ["Who has the most career receiving yards without a 1,500-yard season?", // q68
    answer({ intent: "leaders", stat: "receiving_yards", withoutSeasonAtLeast: 1500, scope: "career" })],
  ["Who has the most career receptions without a 100-catch season?", // q69
    answer({ intent: "leaders", stat: "receptions", withoutSeasonAtLeast: 100, scope: "career" })],
  ["Who has the most career receiving touchdowns without leading the league?", // q70
    answer({ intent: "leaders", stat: "receiving_tds", withoutLeagueLead: true, scope: "career" })],
  ["Who has the most career sacks without leading the league in sacks?", // q87
    answer({ intent: "leaders", stat: "def_sacks", withoutLeagueLead: true, scope: "career" })],
  // q49, q50, q51, q98 (MVP, playoff win, conference championship, Super
  // Bowl) never get a withoutSeasonAtLeast/withoutLeagueLead/crossStat field
  // — none of those negations are implemented — so parseRules keeps
  // whatever shape it already produced pre-Task-6 (an award/leaders spec
  // that doesn't capture the qualifier at all). What actually keeps these
  // honest is the audit guard's catch-all "without" rule, verified in
  // audit.test.ts, not the shape here.

  // Task 7 benchmark rerun: bare "multiple" wasn't in the threshold vocabulary
  // at all, so these fell all the way through to a bare season leaderboard —
  // "games with multiple rushing touchdowns" silently became "most rushing
  // touchdowns [last season]", dropping the games-with filter entirely.
  // "multiple" now reads as the same >=2 bound "two or more" already has.
  ["Who has the most games with multiple rushing touchdowns?", // q33
    answer({ intent: "game_count_leaders", stat: "rushing_tds", threshold: { op: ">=", value: 2 } })],
  ["Who has the most games with multiple interceptions?", // q90
    answer({ intent: "game_count_leaders", stat: "interceptions", threshold: { op: ">=", value: 2 } })],
];

describe("the 100-question battery + parser edge cases", () => {
  it.each(CASES)("%s", (question, expected) => {
    check(question, expected);
  });
});

describe("review fixes: targeted regressions", () => {
  it("season-threshold negation refuses the unit mismatch instead of ranking the wrong column", () => {
    // Pre-fix: "1,000-yard" parsed as withoutSeasonAtLeast(1000) against
    // receptions regardless of unit, so this executed catches < 1000 for a
    // question naming a YARD season — a wrong number, not a refusal. The
    // unit-family guard now nulls the field on a mismatch (receptions wants
    // "catch", not "yard"), so the field never lands on the spec at all —
    // see audit.test.ts for the resulting pipeline-level refusal.
    const result = parse("Who has the most career receptions without a 1,000-yard season?");
    expect(result).not.toBeNull();
    expect(isRefusal(result)).toBe(false);
    expect((result as unknown as Record<string, unknown>).withoutSeasonAtLeast).toBeFalsy();
  });

  it("the bare-number-plus-yards threshold never tail-matches a comma-grouped number", () => {
    // Pre-fix: "1,500 rushing yard games" matched on the "500" fragment
    // after the comma (a live wrong-number bug: threshold value 500, not
    // 1,500) — the (?<!,) guard now refuses the match outright rather than
    // silently misreading a comma-grouped number's tail.
    const result = parse("Derrick Henry 1,500 rushing yard games");
    expect(result).not.toBeNull();
    expect(isRefusal(result)).toBe(false);
    expect(result).not.toMatchObject({ intent: "game_count", threshold: { value: 500 } });
  });
});
