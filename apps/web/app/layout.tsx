import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YunoBall — NFL answers",
  description: "Ask anything about NFL history. Answers backed by real data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
