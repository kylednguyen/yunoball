import { HomeDashboard } from "./components/HomeDashboard";
import { Leaders } from "./components/Leaders";
import { ScoreTicker } from "./components/ScoreTicker";
import { Search } from "./search";

export default function Home() {
  return (
    <>
      <ScoreTicker />
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <section className="mb-10 text-center">
          <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            Ask anything about the <span className="text-primary">NFL</span>
          </h1>
          <p className="mx-auto mt-1 mb-6 max-w-prose text-muted-foreground">
            Every answer is computed from real historical data, and we show you the
            query behind it.
          </p>
          <div className="text-left">
            <Search />
          </div>
        </section>

        <HomeDashboard />

        <Leaders />
      </div>
    </>
  );
}
