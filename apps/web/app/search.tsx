"use client";

import { useEffect, useRef, useState } from "react";

import { AnswerCard } from "./components/AnswerCard";
import { SearchSuggest } from "./components/SearchSuggest";
import { AnswerSkeleton } from "./components/Skeleton";
import { ask, fetchExamples, friendlyError, type AnswerResult } from "./lib/api";

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
  const [examples, setExamples] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecents(loadRecents());
    let active = true;
    fetchExamples(4)
      .then((items) => active && setExamples(items))
      .catch(() => {
        if (active) {
          setExamples([
            "Who threw the most touchdowns in 2024?",
            "Most rushing yards in a season",
            "Patrick Mahomes passing yards in 2023",
            "Josh Allen versus Lamar Jackson",
          ]);
        }
      });
    return () => {
      active = false;
    };
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
      <div className="yb-search-wrap" role="search">
        <SearchSuggest
          value={question}
          onValueChange={setQuestion}
          onSearch={(q) => run(q)}
          placeholder="Search NFL stats, players, teams…"
          inputClass="yb-search"
          ariaLabel="Search NFL stats, players, and teams"
          autoFocus
          inputRef={inputRef}
        >
          <span className="yb-kbd-hint" aria-hidden="true">
            /
          </span>
        </SearchSuggest>
      </div>

      {examples.length > 0 && !result && !loading && (
        <div className="yb-query-prompt" aria-label="Supported sample queries">
          <span>Try a supported query</span>
          <div className="yb-query-prompt-list">
            {examples.map((example) => (
              <button
                key={example}
                className="yb-chip yb-sample-query"
                type="button"
                onClick={() => {
                  setQuestion(example);
                  run(example);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {recents.length > 0 && (
        <div className="yb-recent-searches">
          <span className="yb-muted">Recent:</span>
          {recents.map((r) => (
            <button
              key={r}
              className="yb-chip yb-recent-query"
              type="button"
              onClick={() => {
                setQuestion(r);
                run(r);
              }}
            >
              {r}
            </button>
          ))}
          <button
            className="yb-link"
            type="button"
            onClick={() => {
              localStorage.removeItem(RECENTS_KEY);
              setRecents([]);
            }}
          >
            Clear
          </button>
        </div>
      )}

      <div aria-live="polite" aria-busy={loading}>
        {loading && <AnswerSkeleton />}

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Something went wrong</h2>
            <p>{friendlyError(error)}</p>
            <button className="yb-btn" onClick={() => active && run(active)}>
              Try again
            </button>
          </div>
        )}

        {empty && (
          <div className="yb-state">
            <h2>No data for that question yet</h2>
            <p>We couldn’t find stats matching your query. Try a different season, player, or phrasing.</p>
          </div>
        )}

        {!loading && !error && !empty && result && <AnswerCard result={result} />}
      </div>
    </div>
  );
}
