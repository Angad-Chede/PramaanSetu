"use client";

import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn("grid gap-3", className)} {...props} />;
}

function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "group/radio relative grid aspect-square size-4.5 shrink-0 cursor-pointer place-items-center rounded-full border border-glyph/50 bg-surface outline-none",
        "transition-[background-color,border-color,box-shadow,scale] duration-200 ease-ios hover:border-glyph/80 active:scale-90 motion-reduce:active:scale-100",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        "focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "aria-invalid:border-destructive/70 aria-invalid:ring-[3px] aria-invalid:ring-destructive/15",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        // a 44px hit area for thumbs without changing the drawn size
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5 pointer-coarse:after:rounded-full",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator forceMount data-slot="radio-group-indicator" className="pointer-events-none grid place-items-center">
        <span
          className={cn(
            "size-1.5 scale-0 rounded-full bg-primary-foreground transition-transform duration-150 ease-ios motion-reduce:transition-none",
            "group-data-[state=checked]/radio:scale-100 group-data-[state=checked]/radio:duration-300 group-data-[state=checked]/radio:ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          )}
        />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
