"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Nav } from "../components/Nav";
import { askAgent, type AgentStep, type ChatTurn } from "../lib/api";

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

export default function AssistantPage() {
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
    <>
      <Nav />
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
            {error}. Try again.
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
    </>
  );
}
