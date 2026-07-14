"use client";

import { useRouter } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SearchSuggest } from "./components/SearchSuggest";
import { ask, fetchExamples, friendlyError, type AnswerResult } from "./lib/api";

const RECENTS_KEY = "yb:recent-searches";
const FALLBACK_EXAMPLES = [
  "Who threw the most touchdowns in 2024?",
  "Most rushing yards in a season",
  "Patrick Mahomes passing yards in 2023",
  "Josh Allen versus Lamar Jackson",
];

function loadRecents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function Search() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [examples, setExamples] = useState<string[]>(FALLBACK_EXAMPLES);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (q: string) => {
    setActive(q);
    setLoading(true);
    setError(null);
    try {
      const result: AnswerResult = await ask(q);
      const next = [q, ...loadRecents().filter((r) => r !== q)].slice(0, 4);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      setRecents(next);
      if (!result.share_id) throw new Error("This result did not receive a share ID.");
      router.push(`/a/${result.share_id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    setRecents(loadRecents());
    let active = true;
    fetchExamples(8)
      .then((items) => active && setExamples(items))
      .catch(() => {
        if (active) {
          setExamples(FALLBACK_EXAMPLES);
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
  }, [run]);

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
  }, [run]);

  return (
    <div className="yb-search-controller">
      <div className="yb-search-wrap" role="search">
        <SearchSuggest
          value={question}
          onValueChange={setQuestion}
          onSearch={(q) => run(q)}
          placeholder="Search NFL stats, players, teams…"
          inputClass="yb-search"
          ariaLabel="Search NFL stats, players, and teams"
          inputRef={inputRef}
          suggestions={[...recents, ...examples]}
        >
          <SearchIcon className="yb-search-icon" size={18} strokeWidth={2} aria-hidden="true" />
          <span className="yb-kbd-hint" aria-hidden="true">
            /
          </span>
        </SearchSuggest>
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {loading && <p className="yb-search-feedback">Computing answer…</p>}

        {error && (
          <div className="yb-search-inline-error" role="alert">
            <span>{friendlyError(error)}</span>
            <button className="yb-btn" onClick={() => active && run(active)}>
              Try again
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
