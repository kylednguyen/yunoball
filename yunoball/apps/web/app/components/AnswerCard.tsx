"use client";

import { useState } from "react";

import type { AnswerResult } from "../lib/api";
import { BarChart, type BarDatum } from "./BarChart";

const MAX_BARS = 15;

/** A column is numeric if every non-empty cell parses as a number. */
function isNumericColumn(rows: AnswerResult["rows"], c: string): boolean {
  return rows.every((r) => r[c] === null || r[c] === undefined || r[c] === "" || !isNaN(Number(r[c])));
}

/** Pick a (label, value) pair from the result for charting, if one fits. */
function chartData(result: AnswerResult): { data: BarDatum[]; label: string } | null {
  const { rows, columns } = result;
  if (rows.length < 2 || columns.length < 2) return null;

  const isNum = (c: string) => isNumericColumn(rows, c);
  const numeric = columns.filter(isNum);
  const labelCol = columns.find((c) => !numeric.includes(c));
  if (!labelCol) return null;

  // Chart the metric column — the numeric column with the widest spread — so a
  // constant dimension like `season` (all 2023) is never mistaken for the value.
  let valueCol: string | null = null;
  let bestSpread = 0;
  for (const c of numeric) {
    const vals = rows.map((r) => Number(r[c] ?? 0));
    const spread = Math.max(...vals) - Math.min(...vals);
    if (spread > bestSpread) {
      bestSpread = spread;
      valueCol = c;
    }
  }
  if (!valueCol) return null; // nothing varies → a bar chart would be meaningless

  const vc = valueCol;
  const data = rows
    .slice(0, MAX_BARS)
    .map((r) => ({ label: String(r[labelCol] ?? ""), value: Number(r[vc] ?? 0) }));
  return { data, label: vc };
}

export function AnswerCard({ result }: { result: AnswerResult }) {
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const chart = chartData(result);
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

      {chart && <BarChart data={chart.data} />}

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
