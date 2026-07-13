/** Search-hardening audit harness.
 *
 * Drives the top ~100 plausible questions through the real query pipeline
 * (parse -> audit -> build -> execute -> narrate) against the live warehouse
 * and buckets each outcome, so regressions and coverage gaps are visible at a
 * glance. Run: tsx src/cli/searchAudit.ts  (needs DATABASE_URL populated).
 *
 * Not a unit test — a diagnostic. It prints a table and a JSON blob so the
 * responses double as a golden corpus for manual review.
 */

import { writeFileSync } from "node:fs";
import { runQueryPipeline } from "../engine/pipeline.js";
import { closePools } from "../db/pool.js";

/** The corpus: realistic phrasings across every supported shape plus known
 * gap areas, using players/teams present in the 2020–2024 warehouse. */
const QUESTIONS: string[] = [
  // --- leaders: season ---
  "most passing yards in 2023",
  "who threw the most touchdowns in 2022",
  "most rushing yards in 2024",
  "who led the league in receiving yards in 2023",
  "most receptions in 2022",
  "most interceptions thrown in 2021",
  "most sacks in 2023",
  "who had the most tackles in 2022",
  "top 5 rushing touchdowns in 2023",
  "most fantasy points in 2023",
  // --- leaders: career / all-time ---
  "most career passing yards",
  "most passing touchdowns all time",
  "most rushing yards in a season",
  "most receiving yards in a season since 1999",
  // --- leaders: positional / direction / rookie ---
  "best quarterback in 2023",
  "top 10 wide receivers in 2023",
  "fewest interceptions in 2022",
  "most rushing yards by a rookie in 2023",
  "best running back in 2024",
  "who threw the fewest touchdowns in 2023",
  // --- player_total: season ---
  "Patrick Mahomes passing yards in 2022",
  "how many touchdowns did Josh Allen throw in 2023",
  "Justin Jefferson receiving yards in 2022",
  "Derrick Henry rushing yards in 2023",
  "Ja'Marr Chase receptions in 2023",
  "Tyreek Hill receiving yards in 2023",
  "CeeDee Lamb receiving yards in 2023",
  "Lamar Jackson rushing yards in 2024",
  // --- player_total: career ---
  "Patrick Mahomes career passing touchdowns",
  "Derrick Henry career rushing yards",
  "Travis Kelce career receiving yards",
  "Aaron Rodgers career passing yards",
  "Davante Adams career receiving touchdowns",
  // --- single game ---
  "most passing yards in a single game",
  "most rushing yards in one game",
  "Derrick Henry most rushing yards in a game",
  "Justin Jefferson most receiving yards in a single game",
  "Patrick Mahomes most passing touchdowns in a game",
  // --- compare ---
  "Patrick Mahomes vs Josh Allen",
  "Justin Jefferson vs Ja'Marr Chase receiving yards",
  "Derrick Henry versus Saquon Barkley rushing yards",
  "Josh Allen vs Lamar Jackson passing touchdowns",
  "Patrick Mahomes vs Josh Allen career passing yards",
  "Jalen Hurts vs Josh Allen in 2022",
  // --- scoring (first/last TD) ---
  "Ja'Marr Chase first touchdown",
  "when did Justin Jefferson score his first touchdown",
  "Puka Nacua last touchdown",
  "Patrick Mahomes first playoff touchdown",
  // --- game_count thresholds ---
  "how many games did Josh Allen throw for 300 yards in 2023",
  "Derrick Henry 100 yard rushing games in 2023",
  "Tyreek Hill games with over 100 receiving yards in 2023",
  "how many 400 yard passing games does Patrick Mahomes have",
  // --- game_result / team_game_log ---
  "who won the Super Bowl in 2023",
  "who won Super Bowl 58",
  "did the Chiefs beat the 49ers in the Super Bowl",
  "Eagles record in 2022",
  "Chiefs last 5 games",
  "Lions record in 2023",
  "Ravens playoff record",
  // --- draft ---
  "who was the first pick in the 2023 draft",
  "who did the Panthers draft first in 2023",
  "where was Bryce Young drafted",
  "first overall pick 2021 draft",
  // --- playoff / super bowl scopes ---
  "most passing yards in the playoffs 2023",
  "Patrick Mahomes passing yards in the Super Bowl",
  "Travis Kelce receptions in the playoffs",
  "most rushing yards in the postseason 2023",
  // --- venue / week filters ---
  "Josh Allen passing yards at home in 2023",
  "Derrick Henry rushing yards on the road in 2023",
  "most touchdowns in week 1 2023",
  "Justin Jefferson receiving yards through week 8 2022",
  // --- completion % (ratio, game-sourced) ---
  "highest completion percentage in 2023",
  "Patrick Mahomes completion percentage in 2022",
  // --- game log ---
  "Josh Allen game log 2023",
  "Justin Jefferson last 5 games",
  "Derrick Henry first 5 games",
  // --- defensive ---
  "most sacks by a defense in 2023",
  "Micah Parsons sacks in 2023",
  "Myles Garrett forced fumbles in 2023",
  "most passes defended in 2022",
  // --- player_seasons ---
  "Patrick Mahomes stats by season",
  "Josh Allen career stats",
  // --- KNOWN GAP AREAS (expect refusal or fallback, not a wrong number) ---
  "passing yards from 2021 to 2023",              // multi-season range
  "receiving yards over the last 3 seasons",       // relative range
  "how many players had 1000 rushing yards in 2023", // league-wide count
  "where does Patrick Mahomes rank in career passing yards", // rank lookup
  "what team does Justin Jefferson play for",       // roster/bio
  "how old is Patrick Mahomes",                     // bio
  "tallest player in the NFL",                      // bio superlative
  "Patrick Mahomes passer rating in 2023",          // efficiency metric
  "Josh Allen QBR in 2023",                         // efficiency metric
  "Justin Jefferson yards per game in 2023",        // per-game rate
  "longest touchdown of 2023",                      // pbp detail
  "Patrick Mahomes red zone touchdowns",            // situational split
  "who has the longest active touchdown streak",     // streaks
  "fastest to 10000 passing yards",                 // milestone/pace
  "2023 MVP",                                        // awards
  // --- adversarial / ambiguity traps ---
  "Micah Parsons tackles",                          // no-year defensive, watch bucket
  "the goat",                                        // nonsense
  "asldkfj",                                         // gibberish
  "Derrick Henry",                                   // bare name
  "Chiefs",                                           // bare team
  "2000 yard rushers",                               // number-as-season trap
  "who threw for the most yards",                    // bare leaders, no year
  // --- domain wave: rate stats ---
  "Derrick Henry yards per carry in 2023",
  "highest yards per carry in 2023",
  "Patrick Mahomes yards per attempt career",
  "Justin Jefferson yards per reception in 2022",
  "Travis Kelce catch rate in 2023",
  "Derrick Henry career rushing average",
  "Justin Jefferson average receiving yards in 2023",
  // --- domain wave: month splits ---
  "Derrick Henry rushing yards in December 2023",
  "most passing touchdowns in january",
  // --- domain wave: player metadata ---
  "what teams has Derrick Henry played for",
  "how many seasons has Patrick Mahomes played",
  // --- domain wave: team metadata / stats / roster / leaders ---
  "what division are the chiefs in",
  "what conference are the eagles in",
  "where do the packers play their home games",
  "how many points did the chiefs score in 2023",
  "bills points allowed in 2023",
  "chiefs points per game in 2023",
  "eagles rushing yards in 2022",
  "who led the chiefs in receiving yards in 2023",
  "chiefs roster 2023",
  "who played for the bills in 2022",
  // --- domain wave 2: jersey / coach / colors / primetime / weather / air yards ---
  "what number does Patrick Mahomes wear",
  "who coaches the chiefs",
  "what are the packers colors",
  "Patrick Mahomes passing yards in primetime in 2023",
  "most rushing yards in primetime 2023",
  "Josh Allen passing yards in freezing weather",
  "Tyreek Hill air yards in 2023",
  "most receiving air yards in 2023",
  // --- domain wave: honest refusals for absent data ---
  "patrick mahomes EPA in 2023",
  "was Justin Jefferson traded",
  "chiefs depth chart",
  "jets injury report",
  "who made the pro bowl in 2023",
];

type Bucket = "ANSWERED" | "EMPTY" | "REFUSAL" | "FALLBACK" | "AUDIT_BLOCK" | "ERROR";

interface Row {
  q: string;
  bucket: Bucket;
  intent: string | null;
  rows: number;
  narration: string;
  sql: string;
}

function classify(r: {
  sql: string; rows: unknown[]; narration: string;
  intent?: string | null; audit?: unknown;
}): Bucket {
  if (r.sql && r.rows.length > 0) return "ANSWERED";
  if (r.sql && r.rows.length === 0) return "EMPTY";
  // sql === "" from here on
  if (/can't answer that one yet/i.test(r.narration)) return "FALLBACK";
  if (r.audit) return "AUDIT_BLOCK";
  return "REFUSAL";
}

async function main(): Promise<number> {
  const results: Row[] = [];
  for (const q of QUESTIONS) {
    try {
      const res = await runQueryPipeline(q, { useCache: false });
      results.push({
        q,
        bucket: classify(res),
        intent: res.intent ?? null,
        rows: res.rows.length,
        narration: res.narration,
        sql: res.sql,
      });
    } catch (err) {
      results.push({
        q, bucket: "ERROR", intent: null, rows: 0,
        narration: `THREW: ${(err as Error).message}`, sql: "",
      });
    }
  }

  const tally: Record<string, number> = {};
  for (const r of results) tally[r.bucket] = (tally[r.bucket] ?? 0) + 1;

  const line = "─".repeat(96);
  console.log(line);
  console.log(`SEARCH AUDIT — ${results.length} questions`);
  console.log(line);
  for (const r of results) {
    const tag = r.bucket.padEnd(11);
    console.log(`${tag} ${(r.intent ?? "-").padEnd(14)} n=${String(r.rows).padStart(3)}  ${r.q}`);
    console.log(`            ${r.narration.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  console.log(line);
  console.log("TALLY:", JSON.stringify(tally));
  console.log(line);

  const outPath = new URL("../../../../search-audit-results.json", import.meta.url).pathname;
  writeFileSync(outPath, JSON.stringify({ tally, results }, null, 2));
  console.log(`wrote ${outPath}`);

  await closePools();
  return 0;
}

main().then((code) => process.exit(code));
