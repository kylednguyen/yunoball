import type { Metadata } from "next";

import { Nav } from "../components/Nav";
import { Glossary } from "./glossary";

export const metadata: Metadata = {
  title: "NFL glossary",
  description:
    "Every stat, fantasy term and league concept used across YunoBall, defined in plain language.",
};

export default function GlossaryPage() {
  return (
    <>
      <Nav />
      <main id="main" className="yb-page">
        <div className="yb-page-head">
          <h1 className="yb-page-title">NFL Glossary</h1>
        </div>
        <p className="yb-page-sub">
          Every stat, fantasy term and league concept used across YunoBall, in plain
          language, no jargon required.
        </p>
        <Glossary />
      </main>
    </>
  );
}
