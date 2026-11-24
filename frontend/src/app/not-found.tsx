import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[80dvh] max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-surface text-glyph shadow-lift">
        <FileQuestion className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">That record was not found</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          The link may be out of date, the record may have been removed, or your role may not cover it. Your task inbox lists everything waiting for you.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/home">Go to my tasks</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/challenges-board">Open the challenge board</Link>
        </Button>
      </div>
    </div>
  );
}
