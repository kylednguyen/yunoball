"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Route-level error boundary: an unexpected render/runtime error shows a
 * recoverable state instead of a blank screen. Next scopes this per route
 * segment, so the nav and other pages keep working. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error); // surfaced for debugging; users see the copy below
  }, [error]);

  return (
    <main id="main" className="yb-page">
      <div className="yb-state error" role="alert">
        <h2>Something broke on this page</h2>
        <p>The rest of the app is fine — you can retry this view or head home.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button className="yb-btn" onClick={reset}>
            Try again
          </button>
          <Link className="yb-btn ghost" href="/">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
