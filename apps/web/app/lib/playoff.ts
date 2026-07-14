/** Playoff seeding + clinch tags derived from the standings.
 *
 *  ponytail: the warehouse exposes no seed, tiebreaker or clinch data, so this
 *  ranks by win pct then point differential — the real NFL breaks ties on
 *  head-to-head / conference records. It's a projection, labelled as such in
 *  the UI. Swap in server-computed seeds if/when the API grows them.
 */
import type { ConferenceStandings, StandingRow } from "./api";

export type ClinchKind = "bye" | "div" | "wc" | "out";

export interface Seed {
  team: StandingRow;
  seed: number;
  kind: ClinchKind;
}

/** Clinch abbreviations, ESPN-style: z = #1 seed (bye), y = division winner,
 *  w = wildcard, e = eliminated. */
export const CLINCH_TAG: Record<ClinchKind, string> = {
  bye: "z*",
  div: "y",
  wc: "w",
  out: "e",
};

const byStrength = (a: StandingRow, b: StandingRow) =>
  b.pct - a.pct || b.point_diff - a.point_diff;

/** The seven-team field for one conference: four division winners (top seed is
 *  the bye), then the three best remaining teams as wildcards. */
export function seedConference(conf: ConferenceStandings): Seed[] {
  const winners = conf.divisions.map((d) => d.teams[0]!).sort(byStrength);
  const winnerIds = new Set(winners.map((t) => t.team_id));
  const wildcards = conf.divisions
    .flatMap((d) => d.teams)
    .filter((t) => !winnerIds.has(t.team_id))
    .sort(byStrength)
    .slice(0, 3);
  return [
    ...winners.map((team, i) => ({ team, seed: i + 1, kind: (i === 0 ? "bye" : "div") as ClinchKind })),
    ...wildcards.map((team, i) => ({ team, seed: winners.length + i + 1, kind: "wc" as ClinchKind })),
  ];
}

/** Clinch kind for every team in a conference (seeded teams plus everyone else
 *  as "out"), keyed by team_id — for the standings clinch column. */
export function clinchByTeam(conf: ConferenceStandings): Map<string, ClinchKind> {
  const map = new Map<string, ClinchKind>();
  for (const s of seedConference(conf)) map.set(s.team.team_id, s.kind);
  for (const t of conf.divisions.flatMap((d) => d.teams)) {
    if (!map.has(t.team_id)) map.set(t.team_id, "out");
  }
  return map;
}
