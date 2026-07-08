"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Search" },
  { href: "/scores", label: "Scores" },
  { href: "/standings", label: "Standings" },
  { href: "/fantasy", label: "Fantasy" },
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/assistant", label: "Assistant", badge: "AI" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="yb-nav" aria-label="Primary">
      <Link href="/" className="yb-brand">
        Yuno<span>Ball</span>
      </Link>
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
