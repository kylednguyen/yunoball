"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import type { AnswerResult } from "../lib/api";
import { headshotThumb } from "../lib/teams";
import { BarChart, type BarDatum } from "./BarChart";

function ask(q: string, onAsk?: (q: string) => void) {
  if (onAsk) onAsk(q);
  else window.location.href = `/?q=${encodeURIComponent(q)}`;
}

function numericColumns(result: AnswerResult): Set<string> {
  const cols = new Set<string>();
  for (const c of result.columns) {
    const vals = result.rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== "");
    if (vals.length > 0 && vals.every((v) => typeof v !== "boolean" && !isNaN(Number(v)))) cols.add(c);
  }
  return cols;
}

function fmt(value: unknown, numeric: boolean): string {
  if (value === null || value === undefined || value === "") return "-";
  if (numeric) return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(value);
}

const NON_CHART_COLS = /^(rank|season|week|year|games?|gp)$/i;

/** Leaderboard-shaped results (a label column + a stat column, a handful of
 *  rows) get a bar chart above the table. Anything else stays table-only. */
function chartData(result: AnswerResult, numeric: Set<string>): BarDatum[] | null {
  if (result.rows.length < 3 || result.rows.length > 15) return null;
  const labelCol = result.columns.find((c) => !numeric.has(c));
  const valueCol = result.columns.find((c) => numeric.has(c) && !NON_CHART_COLS.test(c));
  if (!labelCol || !valueCol) return null;
  const data = result.rows
    .map((r) => ({ label: String(r[labelCol] ?? ""), value: Number(r[valueCol]) }))
    .filter((d) => d.label !== "" && Number.isFinite(d.value) && d.value >= 0);
  if (data.length < 3) return null;
  return data;
}

export function AnswerCard({
  result,
  onAsk,
}: {
  result: AnswerResult;
  onAsk?: (q: string) => void;
}) {
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);

  const numeric = useMemo(() => numericColumns(result), [result]);
  const chart = useMemo(() => chartData(result, numeric), [result, numeric]);
  const primary = result.primary;
  const source = result.source;
  const isEmpty = result.rows.length === 0;
  // Only hosts allowed in next.config.ts — anything else would throw in next/image.
  const headshot =
    primary?.subject_type === "player" &&
    primary.headshot_url?.startsWith("https://static.www.nfl.com/")
      ? primary.headshot_url
      : null;

  const sortedRows = useMemo(() => {
    if (!sort) return result.rows;
    const isNum = numeric.has(sort.col);
    return [...result.rows].sort((a, b) => {
      const av = a[sort.col],
        bv = b[sort.col];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = isNum ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
      return cmp * sort.dir;
    });
  }, [result.rows, sort, numeric]);

  function toggleSort(col: string) {
    setSort((s) =>
      s && s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: -1 },
    );
  }

  async function copyShareLink() {
    if (!result.share_id) return;
    await navigator.clipboard.writeText(`${window.location.origin}/a/${result.share_id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="answer">
      {result.interpretation && (
        <div className="interp">
          <span>{result.interpretation}</span>
          {result.alternatives?.map((a) => (
            <button key={a.label} className="alt" onClick={() => ask(a.query, onAsk)}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {isEmpty ? (
        <EmptyState result={result} onAsk={onAsk} />
      ) : (
        <>
          <div className="stat-card">
            <p className="answer-lede" style={{ margin: "0 0 14px" }}>
              {result.narration}
            </p>

            {primary?.value && (
              <div className="stat-hero">
                <div className="stat-main">
                  <div className="stat-value">
                    {primary.value}
                    {primary.unit && <span className="unit">{primary.unit}</span>}
                  </div>
                  <div className="stat-sub">
                    {primary.subject}
                    {primary.context && <span className="ctx"> · {primary.context}</span>}
                  </div>
                </div>
                {headshot && (
                  <div className="headshot">
                    <Image
                      src={headshotThumb(headshot, 352)}
                      alt={primary.subject ?? "Player headshot"}
                      fill
                      sizes="(max-width: 600px) 124px, 176px"
                      unoptimized
                    />
                  </div>
                )}
              </div>
            )}

            {result.chips && result.chips.length > 0 && (
              <div className="statchips">
                {result.chips.map((c, i) => (
                  <span key={i} className={`statchip cat-${c.category}`}>
                    {c.label}
                  </span>
                ))}
              </div>
            )}

            {source && (
              <>
                <div className="source">
                  <span className="badge-final">{source.freshness}</span>
                  <span>
                    Source: {source.label}, {source.coverage}
                    {source.updated ? `, data through ${source.updated}` : ""}
                  </span>
                </div>
                {source.warnings.map((w, i) => (
                  <div key={i} className="warn">
                    {w}
                  </div>
                ))}
              </>
            )}
          </div>

          {result.comparisons && result.comparisons.length > 0 && (
            <>
              <div className="section-label">How it compares</div>
              <div className="compare">
                {result.comparisons.map((c) => (
                  <div key={c.label} className="compare-card">
                    <div className="cval">{c.value}</div>
                    <div className="clabel">{c.label}</div>
                    {c.note && <div className="cnote">{c.note}</div>}
                  </div>
                ))}
              </div>
            </>
          )}

          {chart && (
            <>
              <div className="section-label">At a glance</div>
              <div className="chart-wrap">
                <BarChart data={chart} />
              </div>
            </>
          )}

          <div className="section-label">Supporting data</div>
          <div className="table-wrap">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th
                        key={c}
                        className={`sortable${numeric.has(c) ? " num" : ""}`}
                        onClick={() => toggleSort(c)}
                      >
                        {c.replace(/_/g, " ")}
                        {sort?.col === c && <span className="arrow">{sort.dir === 1 ? "▲" : "▼"}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => (
                    <tr key={i}>
                      {result.columns.map((c) => (
                        <td key={c} className={numeric.has(c) ? "num" : undefined}>
                          {fmt(row[c], numeric.has(c))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="toolbar">
            <button className="linkbtn" onClick={() => setShowSql((s) => !s)}>
              {showSql ? "Hide" : "Show"} the query
            </button>
            {result.share_id && (
              <button className="linkbtn" onClick={copyShareLink}>
                {copied ? "Link copied ✓" : "Share"}
              </button>
            )}
            {result.cached && <span className="tag-cached">cached</span>}
          </div>
          {showSql && <pre className="sql">{result.sql}</pre>}
        </>
      )}

      {result.followups && result.followups.length > 0 && (
        <>
          <div className="section-label">Related questions</div>
          <div className="followups">
            {result.followups.map((q) => (
              <button key={q} className="followup" onClick={() => ask(q, onAsk)}>
                {q}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function EmptyState({ result, onAsk }: { result: AnswerResult; onAsk?: (q: string) => void }) {
  const examples = result.followups?.length
    ? result.followups
    : [
        "Who led the NFL in rushing yards in 2023?",
        "Most passing touchdowns in the 2023 season",
        "Which team scored the most points in 2023?",
      ];
  return (
    <div className="empty">
      <h3>No exact match for that</h3>
      <p>
        {result.source?.warnings?.[0] ??
          "I couldn’t find data for that query. Try one of these:"}
      </p>
      <div className="followups" style={{ justifyContent: "center" }}>
        {examples.map((q) => (
          <button key={q} className="followup" onClick={() => ask(q, onAsk)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
