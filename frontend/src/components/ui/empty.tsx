import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "group/empty flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-3xl border-dashed p-6 text-center text-balance md:p-12",
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="empty-header" className={cn("flex max-w-sm flex-col items-center gap-2 text-center", className)} {...props} />
  );
}

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        // two ghost tiles fan out behind the icon, like a stack of cards with nothing on them, and spread a little more on hover
        icon: "relative isolate size-12 text-glyph before:absolute before:inset-0 before:-z-10 before:-translate-x-3 before:translate-y-0.5 before:-rotate-12 before:rounded-2xl before:bg-surface before:shadow-card before:transition-transform before:duration-500 before:ease-ios before:content-[''] after:absolute after:inset-0 after:-z-10 after:translate-x-3 after:translate-y-0.5 after:rotate-12 after:rounded-2xl after:bg-surface after:shadow-card after:transition-transform after:duration-500 after:ease-ios after:content-[''] group-hover/empty:before:-translate-x-4 group-hover/empty:before:-rotate-[16deg] group-hover/empty:after:translate-x-4 group-hover/empty:after:rotate-[16deg] motion-reduce:before:transition-none motion-reduce:after:transition-none [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function EmptyMedia({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    >
      {variant === "icon" ? (
        <span className="grid size-full place-items-center rounded-2xl bg-card shadow-lift dark:bg-surface-hover">{children}</span>
      ) : (
        children
      )}
    </div>
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-title" className={cn("text-[15px] font-semibold tracking-tight", className)} {...props} />;
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-sm/relaxed text-pretty text-muted-foreground [&>a]:rounded-sm [&>a]:underline [&>a]:decoration-current/40 [&>a]:underline-offset-4 [&>a]:outline-none [&>a]:transition-colors [&>a:hover]:text-foreground [&>a:hover]:decoration-current [&>a:focus-visible]:ring-2 [&>a:focus-visible]:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn("flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance", className)}
      {...props}
    />
  );
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia };
