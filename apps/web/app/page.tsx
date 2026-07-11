import { HomeDashboard } from "./components/HomeDashboard";
import { Leaders } from "./components/Leaders";
import { ScoreTicker } from "./components/ScoreTicker";
import { Search } from "./search";

export default function Home() {
  return (
    <>
      <ScoreTicker />
      <main id="main">
        <section className="yb-hero">
          <h1>
            Ask anything about the <span>NFL</span>
          </h1>
          <p>
            Every answer is computed from real historical data, and we show you the
            query behind it.
          </p>
          <div className="yb-search-shell">
            <Search />
          </div>
        </section>

        <HomeDashboard />

        <Leaders />
      </main>
    </>
  );
}
