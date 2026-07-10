"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Interactive "single-season leaders" showcase for the landing page.
 *
 * Data are real NFL single-season records from 1999 onward — the window the
 * warehouse actually covers — so every figure is a real record AND clicking a
 * leader asks the live app a question it can answer. Bars grow and values count
 * up once the section scrolls into view; switching a category re-animates.
 * Everything collapses to a static final state under prefers-reduced-motion.
 */

interface Leader {
  name: string;
  team: string;
  season: number;
  value: number;
}

interface Category {
  key: string;
  label: string;
  unit: string;
  /** Builds the natural-language question sent to the search on click. */
  question: (l: Leader) => string;
  rows: Leader[];
}

const CATEGORIES: Category[] = [
  {
    key: "pass_yds",
    label: "Passing yards",
    unit: "yds",
    question: (l) => `How many passing yards did ${l.name} have in ${l.season}?`,
    rows: [
      { name: "Peyton Manning", team: "DEN", season: 2013, value: 5477 },
      { name: "Drew Brees", team: "NO", season: 2011, value: 5476 },
      { name: "Tom Brady", team: "NE", season: 2011, value: 5235 },
      { name: "Drew Brees", team: "NO", season: 2016, value: 5208 },
      { name: "Patrick Mahomes", team: "KC", season: 2018, value: 5097 },
    ],
  },
  {
    key: "rush_yds",
    label: "Rushing yards",
    unit: "yds",
    question: (l) => `How many rushing yards did ${l.name} have in ${l.season}?`,
    rows: [
      { name: "Adrian Peterson", team: "MIN", season: 2012, value: 2097 },
      { name: "Jamal Lewis", team: "BAL", season: 2003, value: 2066 },
      { name: "Derrick Henry", team: "TEN", season: 2020, value: 2027 },
      { name: "Chris Johnson", team: "TEN", season: 2009, value: 2006 },
      { name: "Ahman Green", team: "GB", season: 2003, value: 1883 },
    ],
  },
  {
    key: "rec_yds",
    label: "Receiving yards",
    unit: "yds",
    question: (l) => `How many receiving yards did ${l.name} have in ${l.season}?`,
    rows: [
      { name: "Calvin Johnson", team: "DET", season: 2012, value: 1964 },
      { name: "Cooper Kupp", team: "LAR", season: 2021, value: 1947 },
      { name: "Julio Jones", team: "ATL", season: 2015, value: 1871 },
      { name: "Antonio Brown", team: "PIT", season: 2015, value: 1834 },
      { name: "Marvin Harrison", team: "IND", season: 2002, value: 1722 },
    ],
  },
  {
    key: "pass_td",
    label: "Passing TDs",
    unit: "TD",
    question: (l) => `How many passing touchdowns did ${l.name} throw in ${l.season}?`,
    rows: [
      { name: "Peyton Manning", team: "DEN", season: 2013, value: 55 },
      { name: "Patrick Mahomes", team: "KC", season: 2018, value: 50 },
      { name: "Tom Brady", team: "NE", season: 2007, value: 50 },
      { name: "Peyton Manning", team: "IND", season: 2004, value: 49 },
      { name: "Aaron Rodgers", team: "GB", season: 2011, value: 48 },
    ],
  },
];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Reveal once the section enters the viewport (no scroll listeners). */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

const DEFAULT_CATEGORY = CATEGORIES[0]!;

export function Leaders() {
  const [activeKey, setActiveKey] = useState(DEFAULT_CATEGORY.key);
  const reduced = usePrefersReducedMotion();
  const { ref, shown } = useReveal<HTMLElement>();

  const category = useMemo(
    () => CATEGORIES.find((c) => c.key === activeKey) ?? DEFAULT_CATEGORY,
    [activeKey],
  );
  const max = Math.max(...category.rows.map((r) => r.value));

  // Count-up: finite tween from 0 to each row's value on reveal / tab change.
  const [display, setDisplay] = useState<number[]>(() => category.rows.map(() => 0));
  useEffect(() => {
    const targets = category.rows.map((r) => r.value);
    if (reduced || !shown) {
      setDisplay(shown ? targets : targets.map(() => 0));
      return;
    }
    let raf = 0;
    let start = 0;
    const DURATION = 850;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const step = (now: number) => {
      if (!start) start = now;
      const p = Math.min((now - start) / DURATION, 1);
      const e = ease(p);
      setDisplay(targets.map((v) => Math.round(v * e)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [activeKey, shown, reduced, category.rows]);

  function ask(l: Leader) {
    window.dispatchEvent(new CustomEvent("yb:ask", { detail: category.question(l) }));
  }

  return (
    <section ref={ref} className="yb-leaders" aria-labelledby="leaders-heading">
      <div className="yb-leaders-head">
        <h2 id="leaders-heading" className="yb-leaders-title">
          The record books, since 1999
        </h2>
        <a className="yb-leaders-more" href="/leaders">
          Live leaderboards →
        </a>
      </div>
      <p className="yb-leaders-sub">
        Single-season leaders from the warehouse. Pick a stat, then tap a name to
        ask about that season.
      </p>

      <div className="yb-tabs" role="tablist" aria-label="Stat category">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={c.key === activeKey}
            className="yb-tab"
            onClick={() => setActiveKey(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <ol className="yb-lb" role="tabpanel" aria-label={category.label}>
        {category.rows.map((r, i) => {
          const pct = shown ? r.value / max : 0;
          return (
            <li key={`${r.name}-${r.season}`} className="yb-lb-row">
              <span className="yb-lb-rank">{i + 1}</span>
              <button
                className="yb-lb-name"
                onClick={() => ask(r)}
                title={`Ask about ${r.name}'s ${category.label.toLowerCase()} in ${r.season}`}
              >
                <span className="yb-lb-player">{r.name}</span>
                <span className="yb-lb-meta">
                  {r.team}, {r.season}
                </span>
              </button>
              <span className="yb-lb-track" aria-hidden="true">
                <span
                  className="yb-lb-fill"
                  style={{
                    transform: `scaleX(${pct})`,
                    transitionDelay: reduced ? "0ms" : `${i * 70}ms`,
                  }}
                />
              </span>
              <span className="yb-lb-value">
                {display[i]?.toLocaleString() ?? 0}
                <span className="yb-lb-unit"> {category.unit}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
