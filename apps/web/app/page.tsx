import { HomeDashboard } from "./components/HomeDashboard";
import { ScoreTicker } from "./components/ScoreTicker";

/** NFL hub. Search is the persistent bar in the layout (1); the ticker is the
 *  current week's scores (3); everything else — featured matchup, performers,
 *  division & league leaders, fantasy, playoff picture and trending questions —
 *  lives in the dashboard below. */
export default function Home() {
  return (
    <main id="main" className="yb-home">
      <h1 className="yb-sr-only">NFL data dashboard</h1>
      <ScoreTicker />

      <HomeDashboard />
    </main>
  );
}
