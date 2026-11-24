"use client";

import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const avatarVariants = cva("group/avatar relative flex shrink-0 rounded-full bg-card select-none", {
  variants: {
    size: {
      sm: "size-6 text-[10px]",
      default: "size-8 text-xs",
      lg: "size-10 text-sm",
      xl: "size-12 text-[15px]",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

type AvatarSize = NonNullable<VariantProps<typeof avatarVariants>["size"]>;

// the ring that separates stacked or badged avatars matches whatever they sit on; set --avatar-ring on a parent
const RING = "ring-2 ring-[var(--avatar-ring,var(--color-card))]";

function Avatar({ className, size, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root> & VariantProps<typeof avatarVariants>) {
  return (
    <AvatarPrimitive.Root data-slot="avatar" data-size={size ?? "default"} className={cn(avatarVariants({ size }), className)} {...props} />
  );
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full rounded-[inherit] object-cover animate-in fade-in-0 duration-300 ease-out-soft", className)}
      {...props}
    />
  );
}

const fallbackVariants = cva("flex size-full items-center justify-center rounded-[inherit] font-medium tracking-tight", {
  variants: {
    tone: {
      neutral: "bg-surface text-glyph",
      brand: "bg-brand/12 text-brand-ink",
      info: "bg-info/12 text-info-ink",
      success: "bg-success/12 text-success-ink",
      warning: "bg-warning/14 text-warning-ink",
      violet: "bg-chart-4/12 text-chart-4-ink",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

function AvatarFallback({
  className,
  tone,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback> & VariantProps<typeof fallbackVariants>) {
  return <AvatarPrimitive.Fallback data-slot="avatar-fallback" className={cn(fallbackVariants({ tone }), className)} {...props} />;
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 block size-2.5 rounded-full bg-success select-none",
        RING,
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:ring-[1.5px] group-data-[size=lg]/avatar:size-3 group-data-[size=xl]/avatar:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

const COUNT_SIZES: Record<AvatarSize, string> = {
  sm: "size-6 text-[10px]",
  default: "size-8 text-[11px]",
  lg: "size-10 text-xs",
  xl: "size-12 text-sm",
};

// enough overlap to read as a stack without the next ring cutting into centered initials
const OVERLAP: Record<AvatarSize, string> = {
  sm: "-space-x-1",
  default: "-space-x-1",
  lg: "-space-x-1.5",
  xl: "-space-x-2",
};

function AvatarGroupCount({ className, size = "default", ...props }: React.ComponentProps<"span"> & { size?: AvatarSize }) {
  return (
    <span
      data-slot="avatar-group-count"
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full bg-surface font-medium tracking-tight text-glyph tabular-nums",
        RING,
        COUNT_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

function AvatarGroup({
  className,
  children,
  max,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { max?: number; size?: AvatarSize }) {
  const items = React.Children.toArray(children).filter(React.isValidElement);
  const shown = max != null && items.length > max ? items.slice(0, Math.max(0, max)) : items;
  const hidden = items.length - shown.length;

  return (
    <div
      data-slot="avatar-group"
      role="group"
      className={cn(
        "flex items-center [&>[data-slot=avatar]]:ring-2 [&>[data-slot=avatar]]:ring-[var(--avatar-ring,var(--color-card))] [&>[data-slot=avatar]]:transition-transform [&>[data-slot=avatar]]:duration-200 [&>[data-slot=avatar]]:ease-ios [&>[data-slot=avatar]:hover]:z-10 [&>[data-slot=avatar]:hover]:-translate-y-0.5",
        OVERLAP[size],
        className,
      )}
      {...props}
    >
      {shown.map((child) =>
        child.type === Avatar
          ? React.cloneElement(child as React.ReactElement<{ size?: AvatarSize }>, {
              size: (child.props as { size?: AvatarSize }).size ?? size,
            })
          : child,
      )}
      {hidden > 0 && (
        <AvatarGroupCount size={size} role="img" aria-label={`${hidden} more`} title={`${hidden} more`}>
          +{hidden}
        </AvatarGroupCount>
      )}
    </div>
  );
}

export { Avatar, AvatarImage, AvatarFallback, AvatarBadge, AvatarGroup, AvatarGroupCount, avatarVariants };
