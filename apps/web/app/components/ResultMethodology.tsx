"use client";

import type { AnswerResult } from "../lib/api";

function csvValue(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function ResultMethodology({ result }: { result: AnswerResult }) {
  function downloadCsv() {
    const csv = [
      result.columns.join(","),
      ...result.rows.map((row) => result.columns.map((column) => csvValue(row[column])).join(",")),
    ].join("\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = `yunoball-${result.question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <details className="yb-result-methodology" data-export-exclude="true">
      <summary>How this result was calculated</summary>
      <div>
        <p>
          YunoBall matched this question to the {result.query_context?.metric_label ?? "requested"} metric
          {result.query_context?.season ? ` for ${result.query_context.season}` : ""} and computed it from
          the NFL stats warehouse.
        </p>
        <dl>
          <div><dt>Scope</dt><dd>{result.query_context?.scope ?? "Query-defined"}</dd></div>
          <div><dt>Season type</dt><dd>{result.query_context?.season_type === "POST" ? "Postseason" : "Regular season"}</dd></div>
          <div><dt>Validation</dt><dd>{result.audit?.status ?? "Completed"}</dd></div>
          <div><dt>Cache</dt><dd>{result.cached ? "Cached result" : "Freshly computed"}</dd></div>
          <div><dt>Source</dt><dd>nflverse via the YunoBall warehouse</dd></div>
        </dl>
        {result.sql && <pre className="yb-sql">{result.sql}</pre>}
        {result.rows.length > 0 && (
          <button type="button" className="yb-link" onClick={downloadCsv}>Download source rows as CSV</button>
        )}
      </div>
    </details>
  );
}
