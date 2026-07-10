import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist } from "next/font/google";
import "./globals.css";

/* Display face for headlines, scores and big numbers. Exposed as
   --font-display for globals.css. */
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-display",
});

/* Body face — Geist, with the system sans stack as fallback (--font). */
const body = Geist({
  subsets: ["latin"],
  variable: "--font-body",
});

/* viewport-fit=cover exposes env(safe-area-inset-*) on notched phones;
   globals.css guards the sticky bar and page padding with them. */
export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "YunoBall - the all-in-one NFL platform",
  description:
    "Scores, standings, fantasy lineups, leaderboards and an AI assistant. Every number computed from real data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <a href="#main" className="yb-skip">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
