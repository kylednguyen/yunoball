"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface AnswerResult {
  narration: string;
  sql: string;
  rows: Record<string, unknown>[];
  columns: string[];
  cached: boolean;
}

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
  const [showSql, setShowSql] = useState(false);

  async function ask(q: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setResult((await res.json()) as AnswerResult);
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
          if (question.trim()) ask(question.trim());
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
              ask(ex);
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

      {result && (
        <section style={{ marginTop: 28 }}>
          <p style={{ fontSize: 20, lineHeight: 1.5 }}>{result.narration}</p>

          {result.rows.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th
                        key={c}
                        style={{
                          textAlign: "left",
                          padding: "8px 12px",
                          borderBottom: "1px solid var(--border)",
                          color: "var(--muted)",
                          fontWeight: 600,
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {result.columns.map((c) => (
                        <td
                          key={c}
                          style={{
                            padding: "8px 12px",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          {String(row[c] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            onClick={() => setShowSql((s) => !s)}
            style={{
              marginTop: 16,
              background: "transparent",
              border: "none",
              color: "var(--accent)",
              cursor: "pointer",
              padding: 0,
              fontSize: 13,
            }}
          >
            {showSql ? "Hide" : "Show"} the query behind this answer
          </button>
          {showSql && (
            <pre
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 16,
                overflowX: "auto",
                fontSize: 13,
              }}
            >
              {result.sql}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
