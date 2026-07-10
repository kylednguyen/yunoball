"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SearchSuggest } from "./SearchSuggest";

/** Stroke-only 24px icons (no fills, no glows) — rendered at 16px. */
const ICONS: Record<string, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5" />
    </>
  ),
  scores: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M12 6v12" />
    </>
  ),
  teams: <path d="M12 3l7 3v5c0 4.8-3.2 7.7-7 9-3.8-1.3-7-4.2-7-9V6l7-3z" />,
  standings: <path d="M6 20v-8m6 8V4m6 16v-6" />,
  leaders: (
    <>
      <path d="M8 4h8v4a4 4 0 01-8 0V4z" />
      <path d="M8 5H5.5a2.5 2.5 0 002.5 4M16 5h2.5A2.5 2.5 0 0116 9" />
      <path d="M12 12v4m-4 4h8m-6 0v-4h4v4" />
    </>
  ),
  fantasy: (
    <path d="M12 3.5l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8 2.5-5z" />
  ),
  assistant: <path d="M21 12a8 8 0 01-8 8H4l2.2-2.9A8 8 0 1121 12z" />,
  glossary: (
    <>
      <path d="M12 6a4 4 0 00-4-2H3v14h5a4 4 0 014 2 4 4 0 014-2h5V4h-5a4 4 0 00-4 2z" />
      <path d="M12 6v14" />
    </>
  ),
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

const LINKS = [
  { href: "/", label: "Search", icon: "search" },
  { href: "/scores", label: "Scores", icon: "scores" },
  { href: "/teams", label: "Teams", icon: "teams" },
  { href: "/standings", label: "Standings", icon: "standings" },
  { href: "/leaders", label: "Leaders", icon: "leaders" },
  { href: "/fantasy", label: "Fantasy", icon: "fantasy" },
  { href: "/assistant", label: "Assistant", badge: "Pro", icon: "assistant" },
  { href: "/glossary", label: "Glossary", icon: "glossary" },
];

/** Compact search on every page: teams/players jump to their pages,
 *  questions land on the home search. */
function QuickSearch({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  // Same global shortcut the home search owns: "/" or ⌘K / Ctrl-K focuses
  // the quick search on every other page (command-palette entry point).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(
        (document.activeElement as HTMLElement)?.tagName ?? "",
      );
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key === "k")) {
        e.preventDefault();
        wrap.current?.querySelector("input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="yb-nav-search" role="search" ref={wrap}>
      <SearchSuggest
        value={q}
        onValueChange={setQ}
        onSearch={(question) => {
          onNavigate?.();
          router.push(`/?q=${encodeURIComponent(question)}`);
        }}
        placeholder="Search…"
        inputClass="yb-input"
        ariaLabel="Search NFL teams, players, and stats"
      />
    </div>
  );
}

/** Hamburger / close icon for the mobile drawer toggle. */
function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </>
      ) : (
        <>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </>
      )}
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  // Mobile top bar: hide scrolling down, reveal scrolling up (CSS applies the
  // transform only ≤860px; the desktop rail ignores the class).
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  // Mobile drawer open state.
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Non-alarming offline notice; recovers automatically when back online.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    setOffline(!navigator.onLine);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (Math.abs(delta) > 8) {
        setHidden(delta > 0 && y > 64);
        lastY.current = y;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While the drawer is open: lock body scroll, close on Escape (returning
  // focus to the toggle), and move focus into the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a, button, input")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <nav
      className={`yb-nav${hidden && !open ? " is-hidden" : ""}${open ? " is-open" : ""}`}
      aria-label="Primary"
      onFocusCapture={() => setHidden(false)}
    >
      <div className="yb-nav-bar">
        <Link href="/" className="yb-brand" onClick={() => setOpen(false)}>
          Yuno<span>Ball</span>
        </Link>
        <button
          ref={toggleRef}
          type="button"
          className="yb-nav-toggle"
          aria-expanded={open}
          aria-controls="yb-nav-drawer"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <MenuIcon open={open} />
        </button>
      </div>

      <div className="yb-nav-panel" id="yb-nav-drawer" ref={panelRef}>
        {offline && (
          <p className="yb-offline" role="status">
            Offline — data may be stale
          </p>
        )}
        {pathname !== "/" && <QuickSearch onNavigate={() => setOpen(false)} />}
        <div className="yb-nav-links">
          {LINKS.map(({ href, label, badge, icon }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname.startsWith(href) ||
                  // Box scores are children of Scores in the IA.
                  (href === "/scores" && pathname.startsWith("/games"));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <NavIcon name={icon} />
                {label}
                {badge && <span className="yb-nav-badge">{badge}</span>}
              </Link>
            );
          })}
        </div>
        <p className="yb-nav-foot">Every number computed from nflverse data.</p>
      </div>

      <button
        type="button"
        className="yb-nav-scrim"
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />
    </nav>
  );
}
