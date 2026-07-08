import { Leaders } from "./components/Leaders";
import { Nav } from "./components/Nav";
import { Search } from "./search";

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        <section
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "64px 20px 40px",
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

        <nav className="yb-quick" aria-label="Explore the platform">
          <a href="/scores">
            <span className="t">Scores</span>
            <span className="d">Week-by-week finals</span>
          </a>
          <a href="/standings">
            <span className="t">Standings</span>
            <span className="d">Live from game results</span>
          </a>
          <a href="/fantasy">
            <span className="t">Fantasy</span>
            <span className="d">Build a PPR lineup</span>
          </a>
          <a href="/assistant">
            <span className="t">Assistant</span>
            <span className="d">Chat with the AI agent</span>
          </a>
        </nav>

        <Leaders />
      </main>
    </>
  );
}
