"use client";

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnswerCard } from "./components/AnswerCard";
import { SearchSuggest } from "./components/SearchSuggest";
import { AnswerSkeleton } from "./components/Skeleton";
import { ask, friendlyError, type AnswerResult } from "./lib/api";

const RECENTS_KEY = "yb:recent-searches";

function loadRecents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function Search() {
  const [question, setQuestion] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecents(loadRecents());
  }, []);

  // Global shortcut: "/" or ⌘K / Ctrl-K focuses the search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key === "k")) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Deep-link: /?q=… runs the question on arrival (the nav quick-search on
  // other pages routes here). Read from window to keep this page static.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.trim();
    if (q) {
      setQuestion(q);
      run(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaders section (and any other widget) can request a search via a custom
  // event, so those components stay decoupled from this one's state.
  useEffect(() => {
    function onAsk(e: Event) {
      const q = (e as CustomEvent<string>).detail;
      if (!q) return;
      setQuestion(q);
      run(q);
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.addEventListener("yb:ask", onAsk as EventListener);
    return () => window.removeEventListener("yb:ask", onAsk as EventListener);
  }, []);

  async function run(q: string) {
    setActive(q);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await ask(q));
      const next = [q, ...loadRecents().filter((r) => r !== q)].slice(0, 4);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      setRecents(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Truly empty only when there is neither a narrated answer nor any rows.
  const empty =
    !loading && result !== null && result.rows.length === 0 && !result.narration?.trim();

  return (
    <div>
      <div className="relative" role="search">
        <SearchSuggest
          value={question}
          onValueChange={setQuestion}
          onSearch={(q) => run(q)}
          placeholder="Search NFL stats, players, teams…"
          inputClass="h-14 rounded-xl pr-12 text-lg"
          ariaLabel="Search NFL stats, players, and teams"
          autoFocus
          inputRef={inputRef}
        >
          <kbd
            className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 select-none items-center rounded border bg-muted px-1.5 font-mono text-sm text-muted-foreground sm:inline-flex"
            aria-hidden="true"
          >
            /
          </kbd>
        </SearchSuggest>
      </div>

      {recents.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs text-muted-foreground">Recent:</span>
          {recents.map((r) => (
            <Badge key={r} variant="secondary" asChild>
              <button
                onClick={() => {
                  setQuestion(r);
                  run(r);
                }}
              >
                {r}
              </button>
            </Badge>
          ))}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => {
              localStorage.removeItem(RECENTS_KEY);
              setRecents([]);
            }}
          >
            Clear
          </Button>
        </div>
      )}

      <div aria-live="polite" aria-busy={loading}>
        {loading && <AnswerSkeleton />}

        {error && (
          <div
            className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-10 text-center text-destructive"
            role="alert"
          >
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="max-w-prose">{friendlyError(error)}</p>
            <Button variant="outline" className="mt-2" onClick={() => active && run(active)}>
              Try again
            </Button>
          </div>
        )}

        {empty && (
          <div className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            <h2 className="text-lg font-semibold text-foreground">No data for that question yet</h2>
            <p className="max-w-prose">
              We couldn’t find stats matching your query. Try a different season, player, or phrasing.
            </p>
          </div>
        )}

        {!loading && !error && !empty && result && <AnswerCard result={result} />}
      </div>
    </div>
  );
}
