import { Dashboard } from "./components/Dashboard";
import { Leaders } from "./components/Leaders";
import { Nav } from "./components/Nav";
import { Trending } from "./components/Trending";
import { Search } from "./search";

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        {/* Hero — search stays the front door */}
        <section
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "56px 20px 8px",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: 52,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              margin: "0 0 10px",
            }}
          >
            Ask anything about the <span style={{ color: "var(--accent)" }}>NFL</span>
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 18, margin: "0 auto 32px", maxWidth: 520 }}>
            Every answer is computed from real historical data, and we show you the
            query behind it.
          </p>
          <div style={{ textAlign: "left" }}>
            <Search />
          </div>
        </section>

        {/* Live dashboard — tiles, standings, top-5 modules (from the API) */}
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 20px 0" }}>
          <Dashboard />
          <Trending />
        </div>

        {/* Record books showcase */}
        <Leaders />
      </main>
    </>
  );
}
