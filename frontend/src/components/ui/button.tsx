import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium outline-none select-none",
    "transition-[background-color,color,box-shadow,scale,opacity] duration-200 ease-ios active:scale-[0.97] motion-reduce:active:scale-100",
    "disabled:pointer-events-none disabled:not-data-loading:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-2 aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    // on touch screens the hit area grows to 44px without changing the layout
    "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0",
  ],
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-primary/88",
        brand:
          "bg-brand text-brand-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--brand)_30%,transparent),inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-brand/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--destructive)_30%,transparent),inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-destructive/90",
        secondary: "bg-surface text-foreground shadow-lift hover:bg-surface-hover",
        outline: "border bg-card text-foreground shadow-card hover:bg-surface",
        ghost: "text-glyph hover:bg-surface hover:text-foreground aria-expanded:bg-surface aria-expanded:text-foreground",
        link: "rounded-md text-foreground underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4 has-[>svg]:px-3.5 has-[>[data-slot=button-label]>svg]:px-3.5 pointer-coarse:after:-inset-y-1",
        sm: "h-8 gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5 has-[>[data-slot=button-label]>svg]:px-2.5 pointer-coarse:after:-inset-y-1.5",
        lg: "h-11 px-6 text-[15px] has-[>svg]:px-5 has-[>[data-slot=button-label]>svg]:px-5",
        icon: "size-9 pointer-coarse:after:-inset-1",
        "icon-sm": "size-8 pointer-coarse:after:-inset-1.5",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-4 animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "default"}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {/* the label fades out but keeps its width and accessible name, so the button never jumps */}
          <span
            data-slot="button-label"
            className={cn("inline-flex items-center gap-[inherit] transition-opacity duration-200 ease-ios", loading && "opacity-0")}
          >
            {children}
          </span>
          {loading && (
            <span className="absolute inset-0 grid place-items-center animate-in fade-in-0 zoom-in-75 duration-200">
              <Spinner />
            </span>
          )}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
