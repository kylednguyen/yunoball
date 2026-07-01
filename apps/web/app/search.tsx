"use client";

import { useState } from "react";

import { AnswerCard } from "./components/AnswerCard";
import { AnswerSkeleton } from "./components/Skeleton";
import { ask, type AnswerResult } from "./lib/api";

const EXAMPLES = [
  "Who threw the most touchdowns in 2023?",
  "Patrick Mahomes career passing yards",
  "Most rushing yards in a single game",
];

export function Search() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);

  async function run(q: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await ask(q));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) run(question.trim());
        }}
      >
        <input
          className="yb-search"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Search NFL stats, players, teams…"
          autoFocus
        />
      </form>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, justifyContent: "center" }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="yb-chip" onClick={() => { setQuestion(ex); run(ex); }}>
            {ex}
          </button>
        ))}
      </div>

      {loading && <AnswerSkeleton />}
      {error && (
        <p style={{ color: "#dc2626", marginTop: 24 }}>{error}</p>
      )}
      {!loading && result && <AnswerCard result={result} />}
    </div>
  );
}
