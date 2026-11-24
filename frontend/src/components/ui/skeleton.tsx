import * as React from "react";

import { cn } from "@/lib/utils";

// fixed attachment puts every skeleton on one shared gradient, so the sheen sweeps the page as a single wave
const SHIMMER_CSS = `@keyframes dashkit-skeleton-sheen{from{background-position:100vw 0}to{background-position:-100vw 0}}
[data-slot=skeleton]{background-image:linear-gradient(100deg,transparent 40%,var(--skeleton-sheen) 50%,transparent 60%);background-size:200vw 100%;background-attachment:fixed;background-repeat:no-repeat;animation:dashkit-skeleton-sheen 2.2s cubic-bezier(0.4,0,0.2,1) infinite}
@media (prefers-reduced-motion:reduce){[data-slot=skeleton]{animation:none;background-image:none}}`;

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <>
      <style href="dashkit-skeleton" precedence="default">
        {SHIMMER_CSS}
      </style>
      <div
        data-slot="skeleton"
        aria-hidden
        className={cn(
          // a foreground tint instead of a fixed fill keeps the block visible on cards, wells and sidebars alike
          "rounded-md bg-foreground/[0.06] [--skeleton-sheen:rgba(255,255,255,0.7)] dark:bg-foreground/[0.07] dark:[--skeleton-sheen:rgba(255,255,255,0.05)]",
          className,
        )}
        {...props}
      />
    </>
  );
}

export { Skeleton };
