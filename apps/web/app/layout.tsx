import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "./components/Nav";

/* One variable face across copy, headings, controls and data keeps the
   information-dense interface coherent while retaining distinct weights. */
/* viewport-fit=cover exposes env(safe-area-inset-*) on notched phones;
   globals.css guards the sticky bar and page padding with them. */
export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "YunoBall, the all-in-one NFL platform",
    template: "%s · YunoBall",
  },
  description:
    "Scores, standings, fantasy lineups, leaderboards and an AI assistant. Every number computed from real data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return (
    <html lang="en">
      <head>
        {/* Every page pulls headshots/logos from ESPN and data from the API —
            warm both connections before first use. */}
        <link rel="preconnect" href="https://a.espncdn.com" />
        <link rel="preconnect" href={api} crossOrigin="anonymous" />
        {/* The one interface font — preload so the swap window is a frame,
            not a flash (Geist carries every glyph on screen). */}
        <link
          rel="preload"
          href="/fonts/Geist-Variable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <a href="#main" className="yb-skip">
          Skip to content
        </a>
        {/* Nav is persistent (outside the per-route transition wrapper) so the
            fixed sidebar keeps a viewport containing block and never re-animates
            on navigation. */}
        <Nav />
        {children}
      </body>
    </html>
  );
}
