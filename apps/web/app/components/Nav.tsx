import Link from "next/link";

export function Nav({ showWordmark = true }: { showWordmark?: boolean }) {
  return (
    <nav className="nav">
      <Link href="/" className="wordmark" style={{ visibility: showWordmark ? "visible" : "hidden" }}>
        Yuno<span>Ball</span>
      </Link>
      <div className="nav-links">
        <Link href="/">Search</Link>
        <Link href="/leaderboards">Leaderboards</Link>
      </div>
    </nav>
  );
}
