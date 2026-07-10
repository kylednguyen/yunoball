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
  ["Bills points per game", refusal()],
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
  ["Eagles in primetime", refusal("split")],
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
  ["Career passer rating", refusal()],
  ["Career rushing average", refusal("rate")],
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
  ["Monday Night Football", refusal("split")],
  ["Sunday Night Football", refusal("split")],
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
];

describe("the 100-question battery + parser edge cases", () => {
  it.each(CASES)("%s", (question, expected) => {
    check(question, expected);
  });
});
