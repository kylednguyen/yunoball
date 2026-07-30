// No scheduled jobs yet. This file exists so the reservation is visible in the
// tree rather than living only in a doc.
//
// RESERVED — the live-games poller (docs/CONVEX_INTEGRATION.md §4.3, phase P4):
//
//   crons.interval(
//     "poll live games",
//     { seconds: 30 },
//     internal.liveGames.poll,   // action -> internalMutation -> liveGames
//   );
//
// It is not written because the blocker is not the plumbing. CLAUDE.md's data
// invariant is nflverse-only and ENGINEERING_PLAN Track B.1 constrains us to
// license-safe sources; a live-score feed is a new source with new terms and
// needs that review before any code. `liveGames` would also be ephemeral
// display state, not a stat — when ingest runs, Postgres `games` becomes the
// record and the live document is dropped (§1.3).

import { cronJobs } from "convex/server";

const crons = cronJobs();

export default crons;
