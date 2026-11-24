"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CheckIcon, InfoIcon, Loader2Icon, TriangleAlertIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// a result icon pops in when a promise settles, the tile tint has already crossfaded under it
const GLYPH = "size-4 animate-in zoom-in-50 fade-in-0 duration-300 ease-ios";

const TINT =
  "group-data-[type=success]/toast:bg-success/14 group-data-[type=success]/toast:text-success group-data-[type=error]/toast:bg-destructive/12 group-data-[type=error]/toast:text-destructive group-data-[type=warning]/toast:bg-warning/14 group-data-[type=warning]/toast:text-warning group-data-[type=info]/toast:bg-info/12 group-data-[type=info]/toast:text-info group-data-[type=loading]/toast:bg-surface group-data-[type=loading]/toast:text-glyph";

// on phones the stack clears the notch and the home bar
const MOBILE_OFFSET: ToasterProps["mobileOffset"] = {
  top: "max(16px, env(safe-area-inset-top))",
  bottom: "max(16px, env(safe-area-inset-bottom))",
  left: 16,
  right: 16,
};

const Toaster = ({ toastOptions, className, mobileOffset = MOBILE_OFFSET, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      // sonner pins phone stacks with both left and right plus width:100%, which pokes past the edge; let the insets size it
      className={cn("toaster group [@media(max-width:600px)]:w-auto!", className)}
      gap={10}
      icons={{
        success: <CheckIcon className={GLYPH} strokeWidth={3} />,
        info: <InfoIcon className={GLYPH} strokeWidth={2.5} />,
        warning: <TriangleAlertIcon className={GLYPH} strokeWidth={2.5} />,
        error: <XIcon className={GLYPH} strokeWidth={3} />,
        loading: <Loader2Icon className="size-4 animate-spin" strokeWidth={2.5} />,
        close: <XIcon className="size-2.5" strokeWidth={3} />,
      }}
      style={{ "--width": "360px" } as React.CSSProperties}
      mobileOffset={mobileOffset}
      {...props}
      toastOptions={{
        unstyled: true,
        ...toastOptions,
        classNames: {
          ...toastOptions?.classNames,
          toast: cn(
            "group/toast flex w-full items-center gap-3 [@media(max-width:600px)]:w-full! rounded-2xl bg-popover p-3 pr-3.5 font-sans text-popover-foreground shadow-float",
            // sonner squeezes the stacked toasts behind to the front one's height, so their content hides
            "*:transition-opacity *:duration-300 data-[expanded=false]:data-[front=false]:*:opacity-0",
            toastOptions?.classNames?.toast,
          ),
          icon: cn(
            "relative grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-300 ease-out-soft",
            TINT,
            toastOptions?.classNames?.icon,
          ),
          content: cn("flex min-w-0 flex-1 flex-col gap-px", toastOptions?.classNames?.content),
          title: cn("text-sm leading-5 font-medium tracking-[-0.01em]", toastOptions?.classNames?.title),
          description: cn("text-[13px] leading-[18px] text-muted-foreground!", toastOptions?.classNames?.description),
          actionButton: cn(
            "relative h-8 shrink-0 cursor-pointer rounded-full bg-primary px-3.5 after:absolute after:-inset-1.5 text-[13px] font-medium text-primary-foreground outline-hidden transition-[background-color,transform] duration-150 ease-ios hover:bg-primary/88 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
            toastOptions?.classNames?.actionButton,
          ),
          cancelButton: cn(
            "relative h-8 shrink-0 cursor-pointer rounded-full bg-surface px-3.5 after:absolute after:-inset-1.5 text-[13px] font-medium text-foreground outline-hidden transition-[background-color,transform] duration-150 ease-ios hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
            toastOptions?.classNames?.cancelButton,
          ),
          // sits on the corner, outside the content, so it never pushes the layout around
          closeButton: cn(
            "absolute -top-1.5 -left-1.5 grid size-5 cursor-pointer place-items-center rounded-full bg-popover text-glyph opacity-0 shadow-float outline-hidden transition-[opacity,color] duration-150 group-hover/toast:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:hidden",
            toastOptions?.classNames?.closeButton,
          ),
        },
      }}
    />
  );
};

export { Toaster };
