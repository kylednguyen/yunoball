import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YunoBall — the all-in-one NFL platform",
  description:
    "Scores, standings, fantasy lineups, leaderboards and an AI assistant — every number computed from real data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="yb-skip">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
