"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// the paths draw with a dash offset, so the check traces in whether the state is controlled or not
const STROKE =
  "[stroke-dasharray:1] [stroke-dashoffset:1] opacity-0 transition-[stroke-dashoffset,opacity] duration-150 ease-out-soft motion-reduce:transition-none";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer group/checkbox relative grid size-4.5 shrink-0 place-items-center rounded-[6px] border border-glyph/50 bg-surface text-primary-foreground outline-none",
        // a touch gets a 44px target around the 18px box
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-[13px]",
        "transition-[background-color,border-color,box-shadow,scale] duration-200 ease-ios hover:border-glyph/80 active:scale-90 motion-reduce:active:scale-100",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
        "focus-visible:ring-[3px] focus-visible:ring-ring/30",
        "aria-invalid:border-destructive/70 aria-invalid:ring-[3px] aria-invalid:ring-destructive/15",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator forceMount data-slot="checkbox-indicator" className="pointer-events-none grid place-items-center">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="size-3.5"
        >
          <path
            d="M3.6 8.4 6.6 11.3 12.4 4.9"
            pathLength={1}
            className={cn(
              STROKE,
              "group-data-[state=checked]/checkbox:opacity-100 group-data-[state=checked]/checkbox:delay-[40ms] group-data-[state=checked]/checkbox:duration-300 group-data-[state=checked]/checkbox:[stroke-dashoffset:0]",
            )}
          />
          <path
            d="M4.25 8h7.5"
            pathLength={1}
            className={cn(
              STROKE,
              "group-data-[state=indeterminate]/checkbox:opacity-100 group-data-[state=indeterminate]/checkbox:duration-200 group-data-[state=indeterminate]/checkbox:[stroke-dashoffset:0]",
            )}
          />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
