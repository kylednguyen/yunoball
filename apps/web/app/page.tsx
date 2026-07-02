import { Nav } from "./components/Nav";
import { Search } from "./search";

export default function Home() {
  return (
    <main className="wrap wrap-wide">
      <Nav />
      <section className="hero hero-compact">
        <h1>
          Ask NFL history <span>anything</span>
        </h1>
        <p className="tagline">
          Every answer is computed from real data, with the exact query behind
          it. No hallucinated numbers.
        </p>
      </section>
      <Search />
    </main>
  );
}
