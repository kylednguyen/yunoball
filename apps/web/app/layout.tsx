import type { Metadata } from "next";
import { Barlow_Condensed, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";

import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-hanken",
  display: "swap",
});

const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-jb",
  display: "swap",
});

export const metadata: Metadata = {
  title: "YunoBall: NFL answers from real data",
  description: "Ask anything about NFL history. Answers backed by real data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${hanken.variable} ${barlow.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
