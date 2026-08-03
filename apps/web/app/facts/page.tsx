"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "../components/ui";
import { fetchFacts, friendlyError, type StatFact } from "../lib/api";
import { useTitle } from "../lib/hooks";

/** The fact archive: everything the nightly miner has surfaced, most
 *  surprising first. Each row carries the same provenance the home card shows
 *  — how often it has happened and how far back the record actually runs —
 *  because a rarity claim without its window is not a claim. */
export default function FactsPage() {
  useTitle("Notable Facts");
  const [facts, setFacts] = useState<StatFact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchFacts(undefined, 50)
      .then((r) => active && setFacts(r.facts))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, []);

  return (
    <main id="main" className="yb-page" style={{ maxWidth: 900 }}>
      <PageHeader crumbs={[{ label: "Facts" }]} title="Notable Facts" />
      <p className="yb-muted">
        Rare statistical lines, mined from the warehouse and ranked by how surprising they are.
      </p>

      {error && (
        <div className="yb-state error" role="alert">
          <h2>Couldn’t load facts</h2>
          <p>{friendlyError(error)}</p>
        </div>
      )}

      {!error && facts === null && <div className="yb-skel" style={{ height: 320 }} />}

      {facts !== null && facts.length === 0 && (
        <p className="yb-muted">
          No facts yet. They appear once the mining job has run against a loaded season.
        </p>
      )}

      {facts !== null && facts.length > 0 && (
        <section className="yb-card">
          <div className="yb-fact-list">
            {facts.map((f) => (
              <FactRow key={f.fact_id} fact={f} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function FactRow({ fact }: { fact: StatFact }) {
  const era =
    fact.prior_season !== null && fact.prior_season > fact.coverage_floor
      ? `Last done in ${fact.prior_season}`
      : `Nothing like it back to ${fact.coverage_floor}`;
  return (
    <article className="yb-fact yb-fact-row">
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
    </article>
  );
}
