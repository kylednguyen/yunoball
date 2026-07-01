import { Nav } from "./components/Nav";
import { Search } from "./search";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 820,
        margin: "0 auto",
        padding: "48px 20px 120px",
      }}
    >
      <Nav />
      <h1 style={{ fontSize: 40, marginBottom: 4 }}>
        Yuno<span style={{ color: "var(--accent)" }}>Ball</span>
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 28 }}>
        Ask anything about NFL history — every answer is backed by real data,
        and we show you the query behind it.
      </p>
      <Search />
    </main>
  );
}
