import Link from "next/link";

import { AnswerCard } from "../../components/AnswerCard";
import { Nav } from "../../components/Nav";
import { fetchSharedAnswer } from "../../lib/api";

export default async function SharedAnswerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await fetchSharedAnswer(id).catch(() => null);

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "48px 20px 120px" }}>
      <Nav />
      {result ? (
        <>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 13 }}>Shared answer</p>
          <h1 style={{ fontSize: 28, marginTop: 4 }}>{result.question}</h1>
          <AnswerCard result={result} />
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 28 }}>Answer not found</h1>
          <p style={{ color: "var(--muted)" }}>
            This shared answer has expired or never existed.{" "}
            <Link href="/">Ask a new question →</Link>
          </p>
        </>
      )}
    </main>
  );
}
