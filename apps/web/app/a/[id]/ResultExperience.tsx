"use client";

import { toPng } from "html-to-image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AnswerCard } from "../../components/AnswerCard";
import { friendlyError, fetchSharedAnswer, type AnswerResult } from "../../lib/api";
import { useTitle } from "../../lib/hooks";

function filename(question: string): string {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return `yunoball-${slug || "result"}.png`;
}

export function ResultExperience({ shareId }: { shareId: string }) {
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  useTitle(result ? `${result.question} | Result` : "Search result");

  const load = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    setError(null);
    try {
      const next = await fetchSharedAnswer(shareId);
      if (next) setResult(next);
      else setMissing(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [shareId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function downloadPng() {
    if (!captureRef.current || !result) return;
    setExporting(true);
    setExportError(null);
    try {
      await document.fonts.ready;
      const backgroundColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim();
      const dataUrl = await toPng(captureRef.current, {
        backgroundColor,
        cacheBust: true,
        pixelRatio: 2,
        filter: (node) =>
          !(node instanceof HTMLElement && node.dataset.exportExclude === "true"),
      });
      const anchor = document.createElement("a");
      anchor.download = filename(result.question);
      anchor.href = dataUrl;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (err) {
      setExportError((err as Error).message || "Couldn’t create the PNG.");
    } finally {
      setExporting(false);
    }
  }

  async function shareResult() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main id="main" className="yb-page yb-result-page">
      {loading && (
        <div aria-live="polite" aria-busy="true">
          <div className="yb-skel" style={{ width: "55%", height: 46, marginBottom: 18 }} />
          <div className="yb-skel" style={{ height: 420, borderRadius: 14 }} />
        </div>
      )}

      {error && !loading && (
        <div className="yb-state error" role="alert">
          <h1>Couldn’t load this result</h1>
          <p>{friendlyError(error)}</p>
          <button className="yb-btn" type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {missing && !loading && (
        <div className="yb-state">
          <h1>Result not found</h1>
          <p>This result has expired or never existed.</p>
          <Link href="/" className="yb-btn">
            Ask a new question
          </Link>
        </div>
      )}

      {result && !loading && (
        <div ref={captureRef} className="yb-result-canvas">
          <header className={`yb-result-page-head${result.intent === "player_total" || result.intent === "compare" ? " is-focused" : ""}`}>
            <div>
              {result.intent !== "player_total" && result.intent !== "compare" && <span>YunoBall query result</span>}
              <h1>{result.question}</h1>
              {result.intent !== "player_total" && result.intent !== "compare" && <p>Computed from the NFL stats warehouse</p>}
            </div>
            <div className="yb-result-page-actions" data-export-exclude="true">
              <Link href="/" className="yb-btn ghost">
                New search
              </Link>
              {(result.intent === "player_total" || result.intent === "compare") && (
                <button className="yb-btn ghost" type="button" onClick={shareResult}>
                  {copied
                    ? result.intent === "compare" ? "Comparison link copied" : "Result link copied"
                    : result.intent === "compare" ? "Share comparison" : "Share"}
                </button>
              )}
              <button className="yb-btn" type="button" onClick={downloadPng} disabled={exporting}>
                {exporting
                  ? "Preparing PNG…"
                  : result.intent === "compare" ? "Download comparison image" : "Download PNG"}
              </button>
            </div>
          </header>
          {exportError && (
            <p className="yb-result-export-error" role="alert" data-export-exclude="true">
              {friendlyError(exportError)}
            </p>
          )}
          <AnswerCard result={result} />
        </div>
      )}
    </main>
  );
}
