import type { Metadata } from "next";

import { PageHeader } from "../components/ui";
import { Glossary } from "./glossary";

export const metadata: Metadata = {
  title: "NFL glossary",
  description:
    "Every stat, fantasy term and league concept used across YunoBall, defined in plain language.",
};

export default function GlossaryPage() {
  return (
    <>
      <main id="main" className="yb-page">
        <PageHeader title="NFL Glossary" />
        <Glossary />
      </main>
    </>
  );
}
