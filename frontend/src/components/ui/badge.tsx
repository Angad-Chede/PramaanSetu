import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums outline-none transition-[background-color,color,box-shadow] duration-200 ease-ios focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background has-[>svg:first-child]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/88",
        secondary: "bg-surface text-foreground [a&]:hover:bg-surface-hover",
        outline: "text-foreground inset-ring inset-ring-border [a&]:hover:bg-surface",
        brand: "bg-brand/12 text-brand-ink [--badge-dot:var(--color-brand)] [a&]:hover:bg-brand/18",
        success: "bg-success/12 text-success-ink [--badge-dot:var(--color-success)] [a&]:hover:bg-success/18",
        warning: "bg-warning/14 text-warning-ink [--badge-dot:var(--color-warning)] [a&]:hover:bg-warning/20",
        info: "bg-info/12 text-info-ink [--badge-dot:var(--color-info)] [a&]:hover:bg-info/18",
        destructive: "bg-destructive/12 text-destructive-ink [--badge-dot:var(--color-destructive)] [a&]:hover:bg-destructive/18",
      },
      dot: {
        true: "pl-1.5 before:size-1.5 before:shrink-0 before:rounded-full before:bg-[var(--badge-dot,currentColor)] before:content-['']",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  dot,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp data-slot="badge" data-variant={variant ?? "default"} className={cn(badgeVariants({ variant, dot }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
