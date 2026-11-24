import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-xl border border-input bg-surface px-3 py-1 text-base text-foreground tabular-nums outline-none md:text-sm",
        "transition-[background-color,border-color,box-shadow] duration-200 ease-ios",
        "selection:bg-brand/25 placeholder:text-muted-foreground hover:bg-surface-hover",
        "focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/20 dark:focus-visible:bg-surface",
        "aria-invalid:border-destructive/70 aria-invalid:ring-[3px] aria-invalid:ring-destructive/15 aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/20",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 read-only:hover:bg-surface",
        // autofill keeps the field's own fill instead of the browser's blue
        "autofill:shadow-[inset_0_0_0_100px_var(--surface)] autofill:[-webkit-text-fill-color:var(--foreground)]",
        "file:mr-3 file:inline-flex file:h-6 file:items-center file:rounded-full file:border-0 file:bg-card file:px-2.5 file:text-[13px] file:font-medium file:text-foreground file:shadow-lift",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
