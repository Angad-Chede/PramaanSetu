"use client";

import * as React from "react";
import { Check, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-surface p-1.5 pl-3">
      <Link2 className="size-4 shrink-0 text-glyph" />
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground" title={path}>
        {path}
      </code>
      <Button
        type="button"
        size="sm"
        variant={copied ? "secondary" : "outline"}
        aria-live="polite"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.origin + path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          } catch {
            // clipboard blocked: the path stays visible to copy by hand
          }
        }}
      >
        {copied ? <Check /> : null}
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}
