"use client";

import { useEffect, useState } from "react";

import { AnswerCard } from "./components/AnswerCard";
import { Leaders } from "./components/Leaders";
import { ask, type AnswerResult } from "./lib/api";

const EXAMPLES = [
  "Who threw the most touchdowns in 2023?",
  "Patrick Mahomes career passing yards",
  "Most rushing yards in a single game",
  "Did the Cowboys beat the Eagles in 2023?",
];

export function Search() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);

  async function run(q: string) {
    setQuestion(q);
    setLoading(true);
    setError(null);
    setResult(null);
    window.scrollTo({ top: 0 });
    try {
      setResult(await ask(q));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Auto-run a question passed via ?q= (e.g. a follow-up from a shared page).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) run(question.trim());
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask an NFL question…"
          aria-label="Ask an NFL question"
          autoFocus
        />
        <button className="go" type="submit" aria-label="Search" disabled={loading}>
          <ArrowIcon />
        </button>
      </form>

      <div className="chips">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            className="chip"
            onClick={() => {
              setQuestion(ex);
              run(ex);
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {loading && (
        <div className="skeletons" role="status" aria-live="polite">
          <span className="sr-only">Crunching the numbers</span>
          <div className="skeleton skeleton-lede" aria-hidden />
          <div className="skeleton skeleton-stat" aria-hidden />
          <div className="skeleton skeleton-table" aria-hidden />
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {result && <AnswerCard result={result} onAsk={run} />}

      {!loading && !result && <Leaders onAsk={run} />}
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
