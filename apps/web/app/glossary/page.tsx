import type { Metadata } from "next";

import { Glossary } from "./glossary";

export const metadata: Metadata = {
  title: "NFL glossary",
  description:
    "Every stat, fantasy term and league concept used across YunoBall, defined in plain language.",
};

export default function GlossaryPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
        NFL Glossary
      </h1>
      <p className="mt-1 mb-6 max-w-prose text-muted-foreground">
        Every stat, fantasy term and league concept used across YunoBall, in plain
        language, no jargon required.
      </p>
      <Glossary />
    </main>
  );
}
