"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({
  className,
  autoGrow = false,
  maxRows,
  ref,
  ...props
}: React.ComponentProps<"textarea"> & {
  autoGrow?: boolean;
  maxRows?: number;
}) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null);

  const setRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      inner.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const fit = React.useCallback(() => {
    const el = inner.current;
    if (!el || !autoGrow) return;
    const style = getComputedStyle(el);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    const ceiling = maxRows ? line * maxRows + padding + border : Infinity;
    el.style.height = "auto";
    const natural = el.scrollHeight + border;
    el.style.height = `${Math.min(natural, ceiling)}px`;
    el.style.overflowY = natural > ceiling ? "auto" : "hidden";
  }, [autoGrow, maxRows]);

  React.useLayoutEffect(fit, [fit, props.value]);

  React.useEffect(() => {
    const el = inner.current;
    if (!el || !autoGrow) return;
    // a narrower box wraps more lines, so refit when the width changes
    let width = el.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoGrow, fit]);

  return (
    <textarea
      ref={setRef}
      data-slot="textarea"
      data-auto-grow={autoGrow || undefined}
      onInput={autoGrow ? fit : undefined}
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-xl border border-input bg-surface px-3 py-2 text-base leading-6 text-foreground outline-none md:text-sm md:leading-5",
        "transition-[background-color,border-color,box-shadow] duration-200 ease-ios",
        "selection:bg-brand/25 placeholder:text-muted-foreground hover:bg-surface-hover",
        "focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/20 dark:focus-visible:bg-surface",
        "aria-invalid:border-destructive/70 aria-invalid:ring-[3px] aria-invalid:ring-destructive/15",
        "disabled:cursor-not-allowed disabled:opacity-50 read-only:hover:bg-surface [scrollbar-width:thin]",
        autoGrow && "field-sizing-fixed resize-none",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
