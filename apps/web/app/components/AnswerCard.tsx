"use client";

import { useState } from "react";

import type { AnswerResult } from "../lib/api";

/** A column is numeric if every non-empty cell parses as a number. */
function isNumericColumn(rows: AnswerResult["rows"], c: string): boolean {
  return rows.every((r) => r[c] === null || r[c] === undefined || r[c] === "" || !isNaN(Number(r[c])));
}

export function AnswerCard({ result }: { result: AnswerResult }) {
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const numericCols = new Set(result.columns.filter((c) => isNumericColumn(result.rows, c)));

  async function copyShareLink() {
    if (!result.share_id) return;
    const url = `${window.location.origin}/a/${result.share_id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="yb-card yb-enter" style={{ marginTop: 28 }}>
      <p className="yb-answer">{result.narration}</p>

      {result.entities && result.entities.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {result.entities.map((e) => (
            <span
              key={`${e.entity_type}-${e.display_name}`}
              className="yb-chip-static"
              title={`${e.entity_type} · confidence ${e.confidence}`}
            >
              {e.display_name}
            </span>
          ))}
        </div>
      )}

      {result.rows.length > 0 && (
        <div className="yb-table-scroll" style={{ marginTop: 16 }}>
          <table className="yb-table">
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c} className={numericCols.has(c) ? "num" : undefined} scope="col">
                    {c.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {result.columns.map((c) => (
                    <td key={c} className={numericCols.has(c) ? "num" : undefined}>
                      {String(row[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
          alignItems: "center",
        }}
      >
        <button onClick={() => setShowSql((s) => !s)} className="yb-link">
          {showSql ? "Hide" : "Show"} the query
        </button>
        {result.share_id && (
          <button onClick={copyShareLink} className="yb-link">
            {copied ? "Link copied ✓" : "Share"}
          </button>
        )}
        {result.cached && <span className="yb-muted" style={{ fontSize: 12 }}>cached</span>}
      </div>

      {showSql && <pre className="yb-sql" style={{ marginTop: 12 }}>{result.sql}</pre>}
    </section>
  );
}
