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
    <main className="wrap">
      <Nav />
      {result ? (
        <>
          <p className="shared-kicker">Shared answer</p>
          <h1 className="shared-q">{result.question}</h1>
          <AnswerCard result={result} />
        </>
      ) : (
        <>
          <h1 className="shared-q">Answer not found</h1>
          <p className="tagline" style={{ margin: "12px 0 0", textAlign: "left" }}>
            This shared answer has expired or never existed.{" "}
            <Link href="/">Ask a new question →</Link>
          </p>
        </>
      )}
    </main>
  );
}
