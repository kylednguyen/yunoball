/** Documentation site builder.
 *
 *    node docs/build.mjs          # regenerate every docs/*.html
 *    pnpm docs:build
 *
 * Every tracked `docs/*.md` becomes a self-contained HTML page plus an index.
 * Self-contained matters: these pages are opened straight off disk and from
 * static hosting with no build step, so there is no CDN, no runtime font
 * request and no external stylesheet — the Geist face already bundled in
 * docs/fonts is the only asset, referenced relatively.
 *
 * The pages are generated rather than hand-written because the previous
 * hand-written set drifted: each carried its own copy of an older emerald
 * palette while the app had moved to lime, and the cross-links at the top of
 * each page never learned about docs added later. Both are now derived — the
 * tokens from one place below, the nav from the file list.
 *
 * Figures: a line `<!-- figure: name -->` in a markdown file is replaced by
 * docs/figures/name.html. Diagrams therefore live as real, reviewable HTML
 * next to the prose that references them, and the markdown stays readable as
 * markdown (an HTML comment renders as nothing).
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const DOCS = path.dirname(fileURLToPath(import.meta.url));
const FIGURES = path.join(DOCS, "figures");

/** Reading order for the nav — the docs a newcomer should meet in sequence,
 * then the reference material. Anything not listed is appended alphabetically,
 * so a new doc appears in the nav the moment it exists. */
const ORDER = [
  "README", "PRD", "ARCHITECTURE", "TDD", "BACKEND_SCHEMA", "FACTS",
  "ENGINEERING_PLAN", "APP_FLOW", "DESIGN_BRIEF", "FRONTEND_SPEC",
  "DEPLOYMENT", "search-results-audit",
];

/** Short labels for the nav; the file stem is the fallback. */
const LABELS = {
  PRD: "Product",
  ARCHITECTURE: "Architecture",
  TDD: "Technical design",
  BACKEND_SCHEMA: "Schema",
  FACTS: "Facts",
  ENGINEERING_PLAN: "Plan",
  APP_FLOW: "App flow",
  DESIGN_BRIEF: "Design",
  FRONTEND_SPEC: "Frontend spec",
  DEPLOYMENT: "Deploy",
  "search-results-audit": "Search audit",
};

/** One-line descriptions for the index cards. */
const BLURBS = {
  PRD: "What the product is, who it serves, and what ships.",
  ARCHITECTURE: "The system map: stack, query pipeline, ingestion, and why each choice was made.",
  TDD: "Technical design — the engine's intents, executors and guarantees.",
  BACKEND_SCHEMA: "Every warehouse table, column and index, and the questions each one answers.",
  FACTS: "How the fact of the day is mined: probes, coverage floors, scoring and the cron.",
  ENGINEERING_PLAN: "The four delivery tracks and what sits on each.",
  APP_FLOW: "Screen-by-screen journeys through the app.",
  DESIGN_BRIEF: "The design language — surfaces, ink, accent, motion.",
  FRONTEND_SPEC: "Element-by-element frontend spec, rendered with the app's own stylesheet.",
  DEPLOYMENT: "How the API, web app and warehouse get to production.",
  "search-results-audit": "Findings from the search-results audit harness.",
};

// FRONTEND_SPEC.html embeds the app stylesheet and renders live component
// demos against it — regenerating it from markdown would throw that away, so
// it is listed and linked but never overwritten.
const HAND_MAINTAINED = new Set(["FRONTEND_SPEC", "frontend-spec"]);

// Superseded by FRONTEND_SPEC.html. Kept on disk (it is still linked from old
// commits and notes) but not advertised, so the nav doesn't offer a reader two
// frontend specs and no way to tell which one is current.
const UNLISTED = new Set(["frontend-spec"]);

// ---------------------------------------------------------------- syntax --

const KEYWORDS = {
  sql: /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|LATERAL|ON|GROUP|ORDER|BY|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|IF|NOT|EXISTS|ALTER|ADD|COLUMN|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|DEFAULT|NULL|AND|OR|AS|CASE|WHEN|THEN|ELSE|END|WITH|OVER|PARTITION|WINDOW|UNION|ALL|DISTINCT|CONFLICT|DO|NOTHING|RETURNING|ASC|DESC|BETWEEN|IN|IS|CASCADE)\b/gi,
  ts: /\b(import|export|from|const|let|var|function|return|async|await|if|else|for|of|in|while|try|catch|finally|throw|new|class|extends|implements|interface|type|enum|as|typeof|instanceof|null|undefined|true|false|this|void|never|readonly|public|private|satisfies)\b/g,
  bash: /\b(pnpm|npm|npx|node|git|docker|psql|cd|export|echo|curl|set|sudo|tsx)\b/g,
};
KEYWORDS.js = KEYWORDS.ts;
KEYWORDS.tsx = KEYWORDS.ts;
KEYWORDS.javascript = KEYWORDS.ts;
KEYWORDS.typescript = KEYWORDS.ts;
KEYWORDS.sh = KEYWORDS.bash;
KEYWORDS.shell = KEYWORDS.bash;
KEYWORDS.console = KEYWORDS.bash;

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Conservative highlighter.
 *
 * Tokenizes the RAW source into comment / string / other runs first, then
 * escapes each run as it is emitted. Escaping first and pattern-matching
 * second is the version that corrupts output — `&quot;` looks like a string
 * delimiter to a naive regex — so the order here is deliberate. Anything it
 * does not recognise falls through as plain escaped text. */
function highlight(code, lang) {
  const keywords = KEYWORDS[(lang ?? "").toLowerCase()];
  if (!keywords) return esc(code);

  // Comments and strings win over everything; keywords only apply to the rest.
  const spans = /(--[^\n]*|\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  let out = "";
  let last = 0;
  for (const m of code.matchAll(spans)) {
    out += plain(code.slice(last, m.index), keywords);
    out += m[1]
      ? `<span class="c">${esc(m[1])}</span>`
      : `<span class="s">${esc(m[2])}</span>`;
    last = m.index + m[0].length;
  }
  return out + plain(code.slice(last), keywords);
}

function plain(text, keywords) {
  keywords.lastIndex = 0;
  return esc(text)
    .replace(keywords, (w) => `<span class="k">${w}</span>`)
    .replace(/\b(\d[\d_]*(?:\.\d+)?)\b/g, '<span class="n">$1</span>');
}

// ------------------------------------------------------------- rendering --

const slug = (text) =>
  text.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

function renderer(headings) {
  const r = {
    code({ text, lang }) {
      const label = lang ? `<span class="lang">${esc(lang)}</span>` : "";
      return `<figure class="code">${label}<pre><code>${highlight(text, lang)}</code></pre></figure>\n`;
    },
    heading({ text, depth, tokens }) {
      const plainText = tokens.map((t) => t.raw).join("").replace(/[*`_[\]]/g, "");
      const id = slug(plainText);
      if (depth === 2 || depth === 3) headings.push({ id, depth, text: plainText });
      const inner = this.parser.parseInline(tokens);
      // Anchor links make a long reference doc linkable section by section.
      return `<h${depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
    },
    table({ header, rows }) {
      const cell = (c, tag) => `<${tag}>${this.parser.parseInline(c.tokens)}</${tag}>`;
      const head = header.map((c) => cell(c, "th")).join("");
      const body = rows.map((r2) => `<tr>${r2.map((c) => cell(c, "td")).join("")}</tr>`).join("\n");
      // Wrapped so a wide table scrolls inside its own box rather than making
      // the whole page scroll sideways.
      return `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
    },
    link({ href, title, tokens }) {
      // Cross-doc links are written as .md in the markdown; point them at the
      // generated page instead, unless the target has no page of its own.
      let target = href;
      const m = /^([\w-]+)\.md(#.*)?$/.exec(href);
      if (m) target = `${m[1]}.html${m[2] ?? ""}`;
      const ext = /^https?:/.test(target) ? ' target="_blank" rel="noopener"' : "";
      const t = title ? ` title="${esc(title)}"` : "";
      return `<a href="${esc(target)}"${t}${ext}>${this.parser.parseInline(tokens)}</a>`;
    },
  };
  return r;
}

function figures(html) {
  return html.replace(/<!--\s*figure:\s*([\w-]+)\s*-->/g, (whole, name) => {
    const file = path.join(FIGURES, `${name}.html`);
    if (!existsSync(file)) {
      console.warn(`  ! missing figure: ${name} (referenced but docs/figures/${name}.html absent)`);
      return whole;
    }
    return `<figure class="diagram">\n${readFileSync(file, "utf8").trim()}\n</figure>`;
  });
}

// --------------------------------------------------------------- styling --

/** The doc theme. Tokens are copied from apps/web/app/globals.css so the
 * documentation reads as the same product as the app — lime accent on a cool
 * slate ramp, Geist throughout, borders used sparingly. Kept as a literal
 * rather than parsed out of the stylesheet: these pages must keep rendering
 * from a plain `node docs/build.mjs` with no app build in the picture. */
const CSS = `
@font-face {
  font-family: "Geist";
  src: url("fonts/Geist-Variable.woff2") format("woff2");
  font-style: normal; font-weight: 100 900; font-display: swap;
}
:root {
  color-scheme: dark;
  --bg: #0a0c11;
  --panel: #13161e;
  --elevated: #1b1f29;
  --bg-soft: #222835;
  --border: rgba(255,255,255,0.05);
  --border-strong: rgba(255,255,255,0.1);
  --text: #f5f5f5;
  --muted: #f2f2f4;
  --faint: #e7e7ec;
  --accent: #89f336;
  --accent-ink: #9df84f;
  --accent-soft: rgba(137,243,54,0.16);
  --accent-border: rgba(137,243,54,0.42);
  --success: #4ade80;
  --danger: #f87171;
  --r-sm: 6px; --r-md: 8px; --r-lg: 12px; --r-xl: 14px; --r-pill: 999px;
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 20px;
  --s-6: 24px; --s-8: 32px; --s-10: 40px;
  --font: "Geist", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: var(--s-8); }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: var(--font); font-size: 15px; line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}

/* Top bar: every doc, always reachable, current one marked. */
.docnav {
  position: sticky; top: 0; z-index: 10;
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1);
  padding: var(--s-3) var(--s-6);
  background: rgba(10,12,17,0.85); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.docnav .brand { font-weight: 800; letter-spacing: -0.02em; margin-right: var(--s-4); }
.docnav .brand span { color: var(--accent-ink); }
.docnav a {
  padding: var(--s-1) var(--s-3); border-radius: var(--r-pill);
  color: var(--faint); text-decoration: none; font-weight: 550;
}
.docnav a:hover { background: var(--bg-soft); color: var(--text); }
.docnav a[aria-current="page"] {
  background: var(--accent-soft); color: var(--accent-ink);
  box-shadow: inset 0 0 0 1px var(--accent-border);
}

.shell { display: grid; grid-template-columns: minmax(0,1fr) 220px; gap: var(--s-10);
  max-width: 1180px; margin: 0 auto; padding: var(--s-10) var(--s-6) 96px; }
main { min-width: 0; max-width: 860px; }

/* Section index, derived from the h2/h3 tree. */
.toc { position: sticky; top: 72px; align-self: start; font-size: 13px; }
.toc h2 {
  margin: 0 0 var(--s-3); padding: 0; border: 0;
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--faint); opacity: 0.7;
}
.toc a { display: block; padding: 3px 0; color: var(--faint); text-decoration: none; }
.toc a:hover { color: var(--accent-ink); }
.toc .d3 { padding-left: var(--s-3); opacity: 0.75; }

h1, h2, h3, h4 { line-height: 1.2; letter-spacing: -0.02em; font-weight: 700; }
h1 { font-size: 34px; margin: 0 0 var(--s-4); }
h2 { font-size: 22px; margin: var(--s-10) 0 var(--s-4); padding-top: var(--s-6);
  border-top: 1px solid var(--border); }
h3 { font-size: 17px; margin: var(--s-8) 0 var(--s-3); }
h4 { font-size: 15px; margin: var(--s-6) 0 var(--s-2); color: var(--faint); }
.anchor {
  margin-left: var(--s-2); color: var(--accent-ink); opacity: 0;
  text-decoration: none; font-weight: 500;
}
h2:hover .anchor, h3:hover .anchor { opacity: 0.6; }

p, ul, ol { margin: var(--s-4) 0; }
li { margin: var(--s-1) 0; }
li > ul, li > ol { margin: var(--s-1) 0; }
a { color: var(--accent-ink); text-decoration: none; }
a:hover { text-decoration: underline; }
strong { font-weight: 700; color: #fff; }
hr { border: 0; border-top: 1px solid var(--border); margin: var(--s-8) 0; }

blockquote {
  margin: var(--s-5) 0; padding: var(--s-3) var(--s-5);
  background: var(--panel); border-left: 3px solid var(--accent-border);
  border-radius: 0 var(--r-lg) var(--r-lg) 0; color: var(--faint);
}
blockquote p { margin: var(--s-1) 0; }

code {
  font-family: var(--mono); font-size: 0.87em;
  background: var(--bg-soft); padding: 1px 5px; border-radius: var(--r-sm);
}
figure.code { position: relative; margin: var(--s-5) 0; }
figure.code .lang {
  position: absolute; top: 10px; right: 12px;
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--faint); opacity: 0.5;
}
pre {
  margin: 0; padding: var(--s-4) var(--s-5); overflow-x: auto;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-lg);
}
pre code { background: none; padding: 0; font-size: 12.5px; line-height: 1.6; }
pre .k { color: var(--accent-ink); font-weight: 600; }
pre .s { color: #ffd479; }
pre .c { color: var(--faint); opacity: 0.45; font-style: italic; }
pre .n { color: #7fd4ff; }

.tablewrap { overflow-x: auto; margin: var(--s-5) 0; border-radius: var(--r-lg); }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; padding: var(--s-2) var(--s-4);
  border-bottom: 1px solid var(--border); vertical-align: top; }
th {
  position: sticky; top: 0; background: var(--elevated); color: var(--faint);
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
}
tbody tr:hover td { background: var(--panel); }
td code { white-space: nowrap; }

figure.diagram {
  margin: var(--s-6) 0; padding: var(--s-5); overflow-x: auto;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-xl);
}
figure.diagram svg { display: block; max-width: 100%; height: auto; }
figure.diagram figcaption {
  margin-top: var(--s-3); color: var(--faint); font-size: 12.5px; opacity: 0.75;
}

/* Index page cards. */
.cards { display: grid; gap: var(--s-4); grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); margin: var(--s-6) 0; }
.card {
  display: block; padding: var(--s-5); background: var(--panel);
  border: 1px solid var(--border); border-radius: var(--r-xl);
  color: var(--text); text-decoration: none;
}
.card:hover { background: var(--elevated); border-color: var(--accent-border); text-decoration: none; }
.card h3 { margin: 0 0 var(--s-2); font-size: 16px; }
.card p { margin: 0; color: var(--faint); font-size: 13.5px; line-height: 1.5; }
.lede { font-size: 17px; color: var(--faint); max-width: 62ch; }

@media (max-width: 940px) {
  .shell { grid-template-columns: minmax(0,1fr); gap: var(--s-6); padding: var(--s-6) var(--s-4) 64px; }
  .toc { display: none; }
  h1 { font-size: 27px; }
}
`;

// ----------------------------------------------------------------- build --

function navHtml(pages, current) {
  const links = pages
    .map(
      (p) =>
        `<a href="${p.stem}.html"${p.stem === current ? ' aria-current="page"' : ""}>${esc(p.label)}</a>`,
    )
    .join("");
  const home = current === "index" ? ' aria-current="page"' : "";
  return `<nav class="docnav"><a class="brand" href="index.html"${home}>Yuno<span>Ball</span> docs</a>${links}</nav>`;
}

function page({ title, nav, body, toc }) {
  const aside = toc.length
    ? `<aside class="toc"><h2>On this page</h2>${toc
        .map((h) => `<a class="d${h.depth}" href="#${h.id}">${esc(h.text)}</a>`)
        .join("")}</aside>`
    : "<aside></aside>";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${nav}
<div class="shell">
<main>
${body}
</main>
${aside}
</div>
</body>
</html>
`;
}

const stems = readdirSync(DOCS)
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""));
for (const extra of HAND_MAINTAINED) {
  if (existsSync(path.join(DOCS, `${extra}.html`)) && !stems.includes(extra)) stems.push(extra);
}

const pages = stems
  .filter((s) => !UNLISTED.has(s))
  .sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  })
  .map((stem) => ({ stem, label: LABELS[stem] ?? stem.replace(/_/g, " ") }));

let written = 0;
for (const { stem } of pages) {
  if (HAND_MAINTAINED.has(stem)) {
    console.log(`  = ${stem}.html (hand-maintained, left alone)`);
    continue;
  }
  const md = readFileSync(path.join(DOCS, `${stem}.md`), "utf8");
  const headings = [];
  const marked = new Marked({ gfm: true });
  marked.use({ renderer: renderer(headings) });
  const body = figures(marked.parse(md));
  const h1 = /<h1[^>]*>(.*?)(?:<a class="anchor".*?)?<\/h1>/s.exec(body);
  const title = h1 ? `${h1[1].replace(/<[^>]+>/g, "").trim()} · YunoBall docs` : `${stem} · YunoBall docs`;
  writeFileSync(
    path.join(DOCS, `${stem}.html`),
    page({ title, nav: navHtml(pages, stem), body, toc: headings }),
  );
  written++;
  console.log(`  + ${stem}.html`);
}

const cards = pages
  .map(
    (p) =>
      `<a class="card" href="${p.stem}.html"><h3>${esc(p.label)}</h3><p>${esc(
        BLURBS[p.stem] ?? "",
      )}</p></a>`,
  )
  .join("\n");
writeFileSync(
  path.join(DOCS, "index.html"),
  page({
    title: "YunoBall documentation",
    nav: navHtml(pages, "index"),
    body: `<h1>YunoBall documentation</h1>
<p class="lede">Natural-language search over NFL historical data — StatMuse, but more advanced. Every number is computed from an nflverse warehouse; nothing is generated.</p>
<div class="cards">
${cards}
</div>
<p style="color:var(--faint);font-size:13px;opacity:0.7">Generated by <code>pnpm docs:build</code> from the markdown in <code>docs/</code>. Edit the markdown, not the HTML.</p>`,
    toc: [],
  }),
);
console.log(`  + index.html\n${written + 1} pages written.`);
