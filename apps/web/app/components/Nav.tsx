import Link from "next/link";

export function Nav() {
  return (
    <nav className="nav">
      <Link href="/" className="wordmark">
        Yuno<span>Ball</span>
      </Link>
      <div className="nav-links">
        <Link href="/">Search</Link>
        <Link href="/leaderboards">Leaderboards</Link>
      </div>
    </nav>
  );
}
