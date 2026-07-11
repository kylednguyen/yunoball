"use client";

import { useTitle } from "../lib/hooks";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { friendlyError, askAgent, type AgentStep, type ChatTurn } from "../lib/api";

interface Message extends ChatTurn {
  steps?: AgentStep[];
}

const SUGGESTIONS = [
  "Should I start Tyreek Hill or Mike Evans?",
  "Kyren Williams or Breece Hall at RB?",
  "Top fantasy TEs this season",
  "Compare CeeDee Lamb and Justin Jefferson",
  "Who's the safest WR start?",
];

// Feature flag: the agent isn't production-ready, so the page is gated behind a
// Pro paywall by default. Set NEXT_PUBLIC_ASSISTANT_ENABLED=true to unlock the
// chat once it ships.
const ASSISTANT_ENABLED = process.env.NEXT_PUBLIC_ASSISTANT_ENABLED === "true";

export default function AssistantPage() {
  useTitle("Fantasy Assistant");
  return ASSISTANT_ENABLED ? <AssistantChat /> : <AssistantLocked />;
}

/** Pro paywall shown while the assistant is in development. */
function AssistantLocked() {
  return (
    <main id="main" className="yb-page" style={{ maxWidth: 620 }}>
      <div className="yb-paywall">
        <span className="yb-paywall-icon" aria-hidden="true">
          <svg
            width={26}
            height={26}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        <span className="yb-paywall-tag">Pro · Coming soon</span>
        <h1 className="yb-page-title">Fantasy Assistant</h1>
        <p className="yb-paywall-lede">
          An AI teammate that makes the call, not just the lookup: start/sit verdicts that weigh
          production, PPR floor, offense environment and touchdown reliance — every number pulled
          live from the warehouse.
        </p>
        <ul className="yb-paywall-list">
          {SUGGESTIONS.slice(0, 4).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <button className="yb-btn" disabled>
          Coming soon
        </button>
        <p className="yb-paywall-note">
          The assistant is still in development and will launch on a Pro plan. Meanwhile, every stat
          it draws on is already free in <Link href="/">Search</Link>.
        </p>
      </div>
    </main>
  );
}

/** The live chat experience — rendered only when the feature flag is on. */
function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setError(null);
    setInput("");
    const history: Message[] = [...messages, { role: "user", content: question }];
    setMessages(history);
    setBusy(true);
    try {
      const res = await askAgent(history.map(({ role, content }) => ({ role, content })));
      setMessages([...history, { role: "assistant", content: res.reply, steps: res.steps }]);
    } catch (e) {
      setError((e as Error).message);
      setMessages(history);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main" className="yb-page" style={{ maxWidth: 780 }}>
      <div className="yb-page-head">
        <h1 className="yb-page-title">Fantasy Assistant</h1>
      </div>
      <p className="yb-page-sub">
        Judgment calls, not just lookups: start/sit verdicts weigh production, PPR floor, offense
        environment and TD reliance. Every number comes from the warehouse. For basic stat questions,
        use <Link href="/">Search</Link>.
      </p>

      <div className="yb-chat" aria-live="polite">
        {messages.length === 0 && (
          <div className="yb-state" style={{ marginTop: 0 }}>
            <h2>What do you want to know?</h2>
            <p>Try one of these to get going:</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="yb-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`yb-msg ${m.role} yb-enter`}>
            {m.content}
            {m.steps && m.steps.length > 0 && (
              <div className="yb-msg-tools">
                {m.steps.map((s, j) => (
                  <span key={j} className="yb-chip-static" title={s.summary}>
                    {s.tool}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="yb-msg assistant yb-typing" aria-label="Assistant is thinking">
            <i /> <i /> <i />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 14 }}>
          {friendlyError(error)} Try again.
        </p>
      )}

      <form
        className="yb-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          className="yb-input"
          placeholder="Ask the assistant…"
          aria-label="Message the assistant"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="yb-btn" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </main>
  );
}
