/** The probe registry — the only place a probe becomes live.
 *
 * Adding a probe means adding a module under probes/ and one line here, with a
 * golden test alongside it. Nothing discovers probes by scanning the directory:
 * a probe reaching production should be a visible, reviewable diff.
 */

import { conjunctionProbe } from "./probes/conjunction.js";
import { gameThresholdProbe } from "./probes/gameThreshold.js";
import { seasonThresholdProbe } from "./probes/seasonThreshold.js";
import { streakProbe } from "./probes/streak.js";
import { teamGameProbe } from "./probes/teamGame.js";
import type { FactProbe } from "./types.js";

export const PROBES: FactProbe[] = [
  gameThresholdProbe,
  seasonThresholdProbe,
  conjunctionProbe,
  streakProbe,
  teamGameProbe,
];

export function probeById(id: string): FactProbe | undefined {
  return PROBES.find((p) => p.id === id);
}
