"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  nfl: (
    <>
      <path d="M7.5 4.5c3.7-2.3 7.4-.8 9.7 2.9 2.3 3.7 1.3 7.6-2.4 9.9-3.7 2.3-7.4.8-9.7-2.9-2.3-3.7-1.3-7.6 2.4-9.9z" />
      <path d="M8 16L16.5 6M8.8 10.2l5 3.1M10.4 8.1l5 3.1" />
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
  { href: "/", label: "NFL", icon: "nfl", group: "Sports" },
  { href: "/scores", label: "Scores", icon: "scores" },
  { href: "/glossary", label: "Glossary", icon: "glossary" },
  { href: "/fantasy", label: "Fantasy Builder AI", icon: "fantasy" },
];

const NFL_ROUTE_PREFIXES = ["/teams", "/standings", "/leaders", "/leaderboards", "/players", "/a/"];

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
  // Mobile drawer open state, and whether we're at the drawer breakpoint.
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
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

  // Track the drawer breakpoint; leaving mobile force-closes the drawer so a
  // widened/rotated viewport never keeps body scroll locked with no visible
  // way to close it.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const apply = () => {
      setIsMobile(mq.matches);
      if (!mq.matches) setOpen(false);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Reveal the top bar whenever the drawer opens or closes, so a close while
  // scrolled down doesn't instantly snap the bar off-screen (is-hidden).
  useEffect(() => {
    setHidden(false);
  }, [open]);

  // Close + return focus to the toggle. Used by every close affordance so a
  // keyboard/AT user is never stranded on the now-inert panel.
  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  // Open drawer behaves as a modal: lock body scroll, make the rest of the page
  // inert (so aria-modal is honest), trap Tab within the panel + toggle, close
  // on Escape, and move focus in.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const navEl = panel?.closest("nav");
    const SEL = 'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (e.key === "Tab" && panel) {
        // The toggle (the "×" close control) lives in the bar, outside the
        // panel — include it so keyboard users can reach a close affordance.
        const inPanel = Array.from(panel.querySelectorAll<HTMLElement>(SEL));
        const f = toggleRef.current ? [...inPanel, toggleRef.current] : inPanel;
        if (f.length === 0) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Everything except the nav is inert while the drawer is open.
    const bgEls = navEl
      ? Array.from(document.body.children).filter((el) => el !== navEl)
      : [];
    bgEls.forEach((el) => el.setAttribute("inert", ""));
    panel?.querySelector<HTMLElement>("a, button, input")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      bgEls.forEach((el) => el.removeAttribute("inert"));
    };
  }, [open]);

  return (
    <nav
      className={`yb-nav${hidden && !open ? " is-hidden" : ""}${open ? " is-open" : ""}`}
      aria-label="Primary"
      onFocusCapture={() => setHidden(false)}
    >
      <div className="yb-nav-bar">
        <Link href="/" className="yb-brand" onClick={close}>
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

      {/* Offline notice lives outside the drawer panel so it stays visible and
          announced on mobile even while the drawer (and its panel) is closed
          and inert. */}
      {offline && (
        <p className="yb-offline" role="status">
          Offline — data may be stale
        </p>
      )}

      <div
        className="yb-nav-panel"
        id="yb-nav-drawer"
        ref={panelRef}
        // On mobile the panel is a modal drawer; when closed it's off-canvas,
        // so `inert` keeps its links/search out of the tab order and AT tree.
        // On desktop it's the always-visible rail — never a dialog, never inert.
        role={isMobile ? "dialog" : undefined}
        aria-modal={isMobile ? true : undefined}
        aria-label={isMobile ? "Site navigation" : undefined}
        inert={isMobile && !open}
      >
        <div className="yb-nav-links">
          {LINKS.map(({ href, label, icon, group }) => {
            const active =
              href === "/"
                ? pathname === "/" || NFL_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
                : pathname.startsWith(href) ||
                  // Box scores are children of Scores in the IA.
                  (href === "/scores" && pathname.startsWith("/games")) ||
                  (href === "/fantasy" && pathname.startsWith("/assistant"));
            return (
              <span className="yb-nav-entry" key={href}>
                {group && <span className="yb-nav-section">{group}</span>}
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  onClick={close}
                >
                  <NavIcon name={icon} />
                  {label}
                </Link>
              </span>
            );
          })}
        </div>
        <p className="yb-nav-foot">Every number computed from nflverse data.</p>
      </div>

      {/* Mouse-only dismiss target; keyboard/AT users close via Escape or the
          toggle (which is the labelled control), so the scrim stays out of the
          tab order and the accessibility tree. */}
      <button
        type="button"
        className="yb-nav-scrim"
        aria-hidden="true"
        tabIndex={-1}
        onClick={close}
      />
    </nav>
  );
}
