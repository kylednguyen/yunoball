"use client";

import { useState } from "react";

import { AnswerCard } from "./components/AnswerCard";
import { ask, type AnswerResult } from "./lib/api";

const EXAMPLES = [
  "Who threw the most touchdowns in 2023?",
  "Patrick Mahomes career passing yards",
  "Most rushing yards in a single playoff game",
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
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask an NFL question…"
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 18,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            color: "var(--text)",
          }}
        />
      </form>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setQuestion(ex);
              run(ex);
            }}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>Thinking…</p>}
      {error && <p style={{ color: "#f87171" }}>{error}</p>}

      {result && <AnswerCard result={result} />}
    </div>
  );
}
