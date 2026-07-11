import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Nav } from "./components/Nav";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

/* Display face for headlines, scores and big numbers. Exposed as
   --font-display for the Tailwind `font-heading` utility. */
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-display",
});

/* Body face — Geist, exposed as --font-body (the Tailwind `font-sans`). */
const body = Geist({
  subsets: ["latin"],
  variable: "--font-body",
});

/* viewport-fit=cover exposes env(safe-area-inset-*) on notched phones. */
export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "YunoBall — the all-in-one NFL platform",
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
  // Trailing-slash-proof so NEXT_PUBLIC_API_URL="…onrender.com/" can't produce
  // a double-slashed "//api/…" request.
  const api = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
  return (
    <html lang="en" className={`dark ${display.variable} ${body.variable}`}>
      <head>
        {/* Every page pulls headshots/logos from ESPN and data from the API —
            warm both connections before first use. */}
        <link rel="preconnect" href="https://a.espncdn.com" />
        <link rel="preconnect" href={api} crossOrigin="anonymous" />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:font-semibold focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <TooltipProvider delayDuration={0}>
          <SidebarProvider>
            <Nav />
            <SidebarInset>
              {/* Mobile-only bar: the sidebar collapses to an off-canvas sheet
                  below the shadcn 768px breakpoint, so surface a trigger. */}
              <header className="flex h-14 items-center gap-2 border-b px-4 md:hidden">
                <SidebarTrigger />
                <Link
                  href="/"
                  className="font-heading text-lg font-extrabold tracking-tight"
                >
                  Yuno<span className="text-primary">Ball</span>
                </Link>
              </header>
              {children}
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
