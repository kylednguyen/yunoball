"use client";

import { useState } from "react";

import type { AnswerResult } from "../lib/api";
import { BarChart, type BarDatum } from "./BarChart";

const MAX_BARS = 15;

/** Pick a (label, value) pair from the result for charting, if one fits. */
function chartData(result: AnswerResult): { data: BarDatum[]; label: string } | null {
  const { rows, columns } = result;
  if (rows.length < 2 || columns.length < 2) return null;

  const isNum = (c: string) =>
    rows.every((r) => r[c] === null || r[c] === undefined || !isNaN(Number(r[c])));
  const valueCol = columns.find(isNum);
  if (!valueCol) return null;
  const labelCol = columns.find((c) => c !== valueCol && !isNum(c));
  if (!labelCol) return null;

  const data = rows
    .slice(0, MAX_BARS)
    .map((r) => ({ label: String(r[labelCol] ?? ""), value: Number(r[valueCol] ?? 0) }));
  return { data, label: valueCol };
}

export function AnswerCard({ result }: { result: AnswerResult }) {
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const chart = chartData(result);

  async function copyShareLink() {
    if (!result.share_id) return;
    const url = `${window.location.origin}/a/${result.share_id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section style={{ marginTop: 28 }}>
      <p style={{ fontSize: 20, lineHeight: 1.5 }}>{result.narration}</p>

      {result.entities && result.entities.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {result.entities.map((e) => (
            <span
              key={`${e.entity_type}-${e.display_name}`}
              title={`${e.entity_type} · confidence ${e.confidence}`}
              style={{
                fontSize: 12,
                color: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "2px 8px",
              }}
            >
              {e.display_name}
            </span>
          ))}
        </div>
      )}

      {chart && <BarChart data={chart.data} />}

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
                      style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}
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

      <div style={{ display: "flex", gap: 16, marginTop: 16, alignItems: "center" }}>
        <button onClick={() => setShowSql((s) => !s)} style={linkBtn}>
          {showSql ? "Hide" : "Show"} the query behind this answer
        </button>
        {result.share_id && (
          <button onClick={copyShareLink} style={linkBtn}>
            {copied ? "Link copied ✓" : "Share"}
          </button>
        )}
        {result.cached && <span style={{ fontSize: 12, color: "var(--muted)" }}>cached</span>}
      </div>

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
  );
}

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--accent)",
  cursor: "pointer",
  padding: 0,
  fontSize: 13,
};
