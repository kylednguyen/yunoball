"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Search" },
  { href: "/scores", label: "Scores" },
  { href: "/standings", label: "Standings" },
  { href: "/fantasy", label: "Fantasy" },
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/assistant", label: "Assistant", badge: "AI" },
];

/** Compact stat search available on every page; lands on the home search. */
function QuickSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <form
      className="yb-nav-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const question = q.trim();
        if (question) router.push(`/?q=${encodeURIComponent(question)}`);
      }}
    >
      <input
        className="yb-input"
        type="search"
        placeholder="Quick stat search…"
        aria-label="Search NFL stats"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </form>
  );
}

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="yb-nav" aria-label="Primary">
      <Link href="/" className="yb-brand">
        Yuno<span>Ball</span>
      </Link>
      {pathname !== "/" && <QuickSearch />}
      <div className="yb-nav-links">
        {LINKS.map(({ href, label, badge }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}>
              {label}
              {badge && <span className="yb-nav-badge">{badge}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
