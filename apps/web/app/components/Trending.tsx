"use client";

/** Question explorer — a StatMuse-style grid of things you can ask, grouped by
 *  the engine's five intents. Every chip routes into the live search. */

const GROUPS: { title: string; icon: string; questions: string[] }[] = [
  {
    title: "Leaders",
    icon: "🏆",
    questions: [
      "Who threw the most touchdowns in 2023?",
      "Highest passer rating in 2023",
      "Most receptions in 2023",
    ],
  },
  {
    title: "Players",
    icon: "🎯",
    questions: [
      "Patrick Mahomes career passing yards",
      "Tyreek Hill receiving yards in 2023",
      "Jalen Hurts rushing touchdowns in 2023",
    ],
  },
  {
    title: "Teams",
    icon: "🏟️",
    questions: [
      "Chiefs record in 2023",
      "Highest scoring offense in 2023",
      "Bills record in 2023",
    ],
  },
  {
    title: "Head to head",
    icon: "⚔️",
    questions: [
      "Patrick Mahomes vs Josh Allen",
      "Christian McCaffrey vs Derrick Henry rushing yards",
      "Tyreek Hill vs CeeDee Lamb receiving yards",
    ],
  },
  {
    title: "Single game",
    icon: "⚡",
    questions: [
      "Most rushing yards in a single game",
      "Most passing yards in a single game",
      "Most receptions in a single game",
    ],
  },
];

export function Trending() {
  function ask(q: string) {
    window.dispatchEvent(new CustomEvent("yb:ask", { detail: q }));
  }

  return (
    <section className="yb-dash-section" aria-label="Things to ask">
      <div className="yb-dash-head">
        <h2 className="yb-dash-title">Ask it anything</h2>
        <span className="yb-dash-more yb-faint">five question types, one engine</span>
      </div>
      <div className="yb-trend">
        {GROUPS.map((g) => (
          <div key={g.title} className="yb-card yb-trend-card">
            <h3 className="yb-trend-title">
              <span aria-hidden="true">{g.icon}</span> {g.title}
            </h3>
            <ul className="yb-trend-list">
              {g.questions.map((q) => (
                <li key={q}>
                  <button className="yb-trend-q" onClick={() => ask(q)}>
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
