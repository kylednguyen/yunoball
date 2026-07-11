"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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
    <section ref={ref} aria-labelledby="leaders-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="leaders-heading"
          className="font-heading text-2xl font-bold tracking-tight sm:text-3xl"
        >
          The record books, since 1999
        </h2>
        <Button asChild variant="link" size="sm" className="h-auto p-0">
          <Link href="/leaders">Live leaderboards →</Link>
        </Button>
      </div>
      <p className="mt-1 mb-6 max-w-prose text-muted-foreground">
        Single-season leaders from the warehouse. Pick a stat, then tap a name to
        ask about that season.
      </p>

      <Tabs value={activeKey} onValueChange={setActiveKey}>
        <TabsList aria-label="Stat category" className="flex-wrap">
          {CATEGORIES.map((c) => (
            <TabsTrigger key={c.key} value={c.key}>
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={activeKey}>
          <ol className="mt-6 flex flex-col gap-3" aria-label={category.label}>
        {category.rows.map((r, i) => {
          const pct = shown ? r.value / max : 0;
          return (
            <li
              key={`${r.name}-${r.season}`}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(9rem,14rem)_minmax(0,1fr)_auto]"
            >
              <span className="font-heading text-lg font-bold tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <button
                onClick={() => ask(r)}
                title={`Ask about ${r.name}'s ${category.label.toLowerCase()} in ${r.season}`}
                className="flex flex-col items-start rounded-md text-left transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground">
                  {r.team}, {r.season}
                </span>
              </button>
              <span
                className="col-span-3 order-last h-2 overflow-hidden rounded-full bg-muted sm:order-none sm:col-span-1"
                aria-hidden="true"
              >
                <span
                  className={cn(
                    "block h-full origin-left rounded-full bg-primary",
                    !reduced && "transition-transform duration-700 ease-out",
                  )}
                  style={{
                    transform: `scaleX(${pct})`,
                    transitionDelay: reduced ? "0ms" : `${i * 70}ms`,
                  }}
                />
              </span>
              <Badge variant="secondary" className="justify-self-end tabular-nums">
                {display[i]?.toLocaleString() ?? 0}
                <span className="ml-1 text-muted-foreground">{category.unit}</span>
              </Badge>
            </li>
          );
        })}
          </ol>
        </TabsContent>
      </Tabs>
    </section>
  );
}
