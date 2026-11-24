import * as React from "react";

import { cn } from "@/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-[5px] bg-surface px-1 font-sans text-[11px] leading-none font-medium text-glyph tabular-nums select-none dark:bg-surface-hover",
        // a keycap: hairline edge with a deeper bottom lip
        "shadow-[inset_0_-1px_0_var(--border),0_0_0_0.5px_var(--border)] dark:shadow-[inset_0_-1px_0_rgba(0,0,0,0.45),0_0_0_0.5px_rgba(255,255,255,0.08)]",
        "[&_svg:not([class*='size-'])]:size-3",
        "[[data-slot=tooltip-content]_&]:bg-background/15 [[data-slot=tooltip-content]_&]:text-background [[data-slot=tooltip-content]_&]:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <kbd data-slot="kbd-group" className={cn("inline-flex items-center gap-1 font-sans", className)} {...props} />;
}

export { Kbd, KbdGroup };
