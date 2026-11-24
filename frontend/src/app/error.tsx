"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCcw, ServerCrash } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // the server log carries the full error; the digest ties this page to that entry
    console.error("Page failed to render", error.digest);
  }, [error]);

  const unreachable = /not responding|could not be reached/i.test(error.message);

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <ServerCrash className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {unreachable ? "The service is not responding" : "This page could not load"}
        </h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {unreachable
            ? "The PramaanSetu API did not answer. Check that it is running, then try again."
            : "Nothing you entered was lost. Try again, and if it keeps happening, share the reference below with the platform team."}
        </p>
        {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference {error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RotateCcw />
          Try again
        </Button>
        <Button asChild variant="secondary">
          <Link href="/home">Go to my tasks</Link>
        </Button>
      </div>
    </div>
  );
}
