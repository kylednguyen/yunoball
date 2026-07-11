"use client";

import { useTitle } from "../lib/hooks";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";

import { friendlyError, askAgent, type AgentStep, type ChatTurn } from "../lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
    <main id="main" className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6">
      <Card className="items-center text-center">
        <CardHeader className="items-center gap-3">
          <span
            className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <Lock className="size-6" strokeWidth={1.7} />
          </span>
          <Badge variant="secondary">Pro · Coming soon</Badge>
          <CardTitle className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            Fantasy Assistant
          </CardTitle>
          <CardDescription className="max-w-prose text-base">
            An AI teammate that makes the call, not just the lookup: start/sit verdicts that weigh
            production, PPR floor, offense environment and touchdown reliance — every number pulled
            live from the warehouse.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-5">
          <div className="flex flex-wrap justify-center gap-1.5">
            {SUGGESTIONS.slice(0, 4).map((s) => (
              <Badge key={s} variant="outline">
                {s}
              </Badge>
            ))}
          </div>
          <Button disabled>Coming soon</Button>
          <p className="max-w-prose text-sm text-muted-foreground">
            The assistant is still in development and will launch on a Pro plan. Meanwhile, every
            stat it draws on is already free in{" "}
            <Link href="/" className="text-primary hover:underline">
              Search
            </Link>
            .
          </p>
        </CardContent>
      </Card>
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
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
        Fantasy Assistant
      </h1>
      <p className="mt-1 mb-6 max-w-prose text-muted-foreground">
        Judgment calls, not just lookups: start/sit verdicts weigh production, PPR floor, offense
        environment and TD reliance. Every number comes from the warehouse. For basic stat
        questions, use{" "}
        <Link href="/" className="text-primary hover:underline">
          Search
        </Link>
        .
      </p>

      <div className="flex flex-col gap-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            <h2 className="text-lg font-semibold text-foreground">What do you want to know?</h2>
            <p>Try one of these to get going:</p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm",
              m.role === "user"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start bg-muted text-foreground",
            )}
          >
            {m.content}
            {m.steps && m.steps.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.steps.map((s, j) => (
                  <Badge key={j} variant="secondary" title={s.summary}>
                    {s.tool}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div
            className="flex max-w-[85%] items-center gap-1 self-start rounded-lg bg-muted px-3.5 py-3"
            aria-label="Assistant is thinking"
          >
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {friendlyError(error)} Try again.
        </p>
      )}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <Input
          placeholder="Ask the assistant…"
          aria-label="Message the assistant"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !input.trim()}>
          Send
        </Button>
      </form>
    </main>
  );
}
