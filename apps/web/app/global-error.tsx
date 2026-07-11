"use client";

/** Root error boundary: catches errors thrown by the root layout itself (or
 * its top-level providers), which the per-route error.tsx sits below and
 * cannot catch. It replaces the whole document, so it renders its own
 * <html>/<body> and uses inline styles (global CSS may not have loaded). */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <main
          id="main"
          role="alert"
          style={{ maxWidth: "32rem", margin: "3rem auto", textAlign: "center" }}
        >
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
            Something broke
          </h2>
          <p style={{ marginTop: "0.5rem" }}>
            An unexpected error stopped the page from loading. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
