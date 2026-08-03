"use client";

import Link from "next/link";

import type { StatFact } from "../lib/api";

/** The day's mined fact, as one readable line plus the provenance that makes
 *  it trustworthy: how many times it has happened and how far back we can
 *  actually see. The coverage note is deliberately visible rather than
 *  footnoted — "since 1999" means something different from "ever", and the
 *  card says which one it is. */
export function FactOfTheDay({ fact }: { fact: StatFact }) {
  const era =
    fact.prior_season !== null && fact.prior_season > fact.coverage_floor
      ? `Last done in ${fact.prior_season}`
      : `Nothing like it back to ${fact.coverage_floor}`;

  return (
    <div className="yb-fact">
      <p className="yb-fact-line">{fact.headline}</p>
      <div className="yb-fact-meta">
        <span>
          {fact.population === 1 ? "Only occurrence" : `${fact.population} times`} on record
        </span>
        <span aria-hidden="true">·</span>
        <span>{era}</span>
        {fact.question && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className="yb-fact-ask"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("yb:ask", { detail: fact.question }))
              }
            >
              Check the numbers
            </button>
          </>
        )}
      </div>
      {fact.subject_kind === "player" && fact.subject_id && (
        <Link className="yb-fact-subject" href={`/players/${encodeURIComponent(fact.subject_id)}`}>
          {fact.subject_name} →
        </Link>
      )}
    </div>
  );
}
