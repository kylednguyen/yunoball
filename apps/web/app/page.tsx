import { HomeDashboard } from "./components/HomeDashboard";
import { Leaders } from "./components/Leaders";
import { ScoreTicker } from "./components/ScoreTicker";

export default function Home() {
  return (
    <main id="main" className="yb-home">
      <h1 className="yb-sr-only">NFL data dashboard</h1>
      <ScoreTicker />

      <HomeDashboard />

      <Leaders />
    </main>
  );
}
