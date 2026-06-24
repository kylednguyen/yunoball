import { Nav } from "./components/Nav";
import { Search } from "./search";

export default function Home() {
  return (
    <main className="wrap">
      <Nav showWordmark={false} />
      <section className="hero">
        <h1>
          Yuno<span>Ball</span>
        </h1>
        <p className="tagline">
          Ask anything about NFL history — every answer is computed from real
          data, and we show you the query behind it.
        </p>
      </section>
      <Search />
    </main>
  );
}
