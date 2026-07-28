"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AnswerCard } from "../../components/AnswerCard";
import { friendlyError, fetchSharedAnswer, type AnswerResult } from "../../lib/api";
import { useTitle } from "../../lib/hooks";

export function ResultExperience({ shareId }: { shareId: string }) {
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
          <div className="yb-skel" style={{ height: 420, borderRadius: "var(--r-xl)" }} />
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
        <div className="yb-result-canvas">
          <header className={`yb-result-page-head${result.intent === "player_total" || result.intent === "compare" ? " is-focused" : ""}`}>
            <div>
              {result.intent !== "player_total" && result.intent !== "compare" && <span>YunoBall query result</span>}
              <h1>{result.question}</h1>
            </div>
            <div className="yb-result-page-actions">
              <Link href="/" className="yb-btn">
                New search
              </Link>
              {result.share_id && (
                <button className="yb-btn" type="button" onClick={shareResult}>
                  {copied ? "Link copied" : "Share"}
                </button>
              )}
            </div>
          </header>
          <AnswerCard result={result} />
        </div>
      )}
    </main>
  );
}
