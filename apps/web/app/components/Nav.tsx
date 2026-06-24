import Link from "next/link";

export function Nav() {
  return (
    <nav style={{ display: "flex", gap: 18, marginBottom: 28, fontSize: 14 }}>
      <Link href="/" style={{ textDecoration: "none", color: "var(--muted)" }}>
        Search
      </Link>
      <Link href="/leaderboards" style={{ textDecoration: "none", color: "var(--muted)" }}>
        Leaderboards
      </Link>
    </nav>
  );
}
