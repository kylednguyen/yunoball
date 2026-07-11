/** Team records derived on the fly from final scores — never stored, so
 * standings always agree with the scores page. Shared by standings + teams. */

import { q } from "../db/pool.js";

export interface FinalGame {
  week: number;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
}

export async function finalGames(season: number): Promise<FinalGame[]> {
  return q<FinalGame>(
    `SELECT week, home_team, away_team, home_score, away_score
     FROM games
     WHERE season = $1 AND season_type = 'REG'
       AND home_score IS NOT NULL AND away_score IS NOT NULL
     ORDER BY week`,
    [season],
  );
}

export interface RecordAgg {
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  results: string[];
}

export function emptyRecord(): RecordAgg {
  return { w: 0, l: 0, t: 0, pf: 0, pa: 0, results: [] };
}

/** Accumulate W-L-T / points / result sequence per team from final scores. */
export function computeRecords(games: FinalGame[], seed: string[] = []): Map<string, RecordAgg> {
  const records = new Map<string, RecordAgg>(seed.map((t) => [t, emptyRecord()]));
  for (const g of games) {
    for (const [team, ours, theirs] of [
      [g.home_team, g.home_score, g.away_score],
      [g.away_team, g.away_score, g.home_score],
    ] as const) {
      let rec = records.get(team);
      if (!rec) {
        if (seed.length > 0) continue; // seeded mode: ignore unknown teams
        rec = emptyRecord();
        records.set(team, rec);
      }
      rec.pf += ours;
      rec.pa += theirs;
      const key = ours > theirs ? "w" : ours < theirs ? "l" : "t";
      rec[key] += 1;
      rec.results.push(key.toUpperCase());
    }
  }
  return records;
}

export function streak(results: string[]): string {
  if (results.length === 0) return "—";
  const last = results.at(-1)!;
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
  return `${last}${n}`;
}

export function winPct(rec: RecordAgg): number {
  const played = rec.w + rec.l + rec.t;
  return played ? (rec.w + rec.t * 0.5) / played : 0;
}
