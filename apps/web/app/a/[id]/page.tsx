import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AnswerCard } from "../../components/AnswerCard";
import { fetchSharedAnswer } from "../../lib/api";

export default async function SharedAnswerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await fetchSharedAnswer(id).catch(() => null);

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      {result ? (
        <>
          <p className="text-xs text-muted-foreground">Shared answer</p>
          <h1 className="mt-1 font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            {result.question}
          </h1>
          <AnswerCard result={result} />
        </>
      ) : (
        <div className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">Answer not found</h2>
          <p className="max-w-prose">This shared answer has expired or never existed.</p>
          <Button asChild variant="secondary" className="mt-2">
            <Link href="/">Ask a new question</Link>
          </Button>
        </div>
      )}
    </main>
  );
}
