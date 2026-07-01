import Link from "next/link";

export function Nav() {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid var(--border)",
        padding: "14px 22px",
        position: "sticky",
        top: 0,
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "saturate(180%) blur(8px)",
        zIndex: 10,
      }}
    >
      <Link
        href="/"
        style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em", color: "var(--text)" }}
      >
        Yuno<span style={{ color: "var(--accent)" }}>Ball</span>
      </Link>
      <div style={{ display: "flex", gap: 22, fontSize: 14, fontWeight: 500 }}>
        <Link href="/" style={{ color: "var(--muted)" }}>
          Search
        </Link>
        <Link href="/leaderboards" style={{ color: "var(--muted)" }}>
          Leaderboards
        </Link>
      </div>
    </nav>
  );
}
