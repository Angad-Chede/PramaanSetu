"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server log carries the full error; the digest ties this page to that entry.
    console.error("Page failed to render", error.digest);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6 border-b border-line pb-4">
        <h1>This page could not be loaded</h1>
        <p className="mt-1 max-w-prose text-ink-muted">
          Nothing you were working on has been lost. The most common cause is that the PramaanSetu
          service is not reachable from the web app.
        </p>
      </header>

      <section className="card card-pad">
        <h2>What to try</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-ink-soft">
          <li>Load the page again. A transient failure usually clears on the next attempt.</li>
          <li>
            Check that the API service is running and reachable. The web app proxies every request
            to it, so a stopped service shows up here.
          </li>
          <li>Go back to your task inbox and open the record from there.</li>
        </ol>

        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="btn btn-primary">
            Try again
          </button>
          <Link href="/home" className="btn btn-secondary">
            Go to my tasks
          </Link>
        </div>

        {error.digest ? (
          <p className="mt-5 text-sm text-ink-muted">
            Reference for the operations team: <span className="num">{error.digest}</span>
          </p>
        ) : null}
      </section>
    </div>
  );
}
