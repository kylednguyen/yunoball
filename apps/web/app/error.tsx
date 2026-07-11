"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

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
    <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div
        role="alert"
        className="mt-7 flex flex-col items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-10 text-center text-destructive"
      >
        <h2 className="text-lg font-semibold">Something broke on this page</h2>
        <p className="max-w-prose">
          The rest of the app is fine — you can retry this view or head home.
        </p>
        <div className="mt-2 flex justify-center gap-2.5">
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
          <Button asChild variant="outline">
            <a href="/">Go home</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
