"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The hero's halftone plate. On a fine pointer a lens follows the cursor and shows the
 * painting itself under the dots: look closer and the real thing is there.
 */
export function ArtLens({ dots, color, className }: { dots: string; color: string; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = ref.current;
    const host = root?.closest("section");
    if (!root || !host) return;
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = root.getBoundingClientRect();
        const inside = event.clientY > rect.top + rect.height * 0.35;
        root.style.setProperty("--lens-x", event.clientX - rect.left + "px");
        root.style.setProperty("--lens-y", event.clientY - rect.top + "px");
        root.style.setProperty("--lens-r", inside ? "170px" : "0px");
      });
    };
    const leave = () => root.style.setProperty("--lens-r", "0px");
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className={cn("hero-art pointer-events-none", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dots} alt="" width={2400} height={1664} fetchPriority="high" className="absolute inset-0 size-full object-cover object-bottom" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={color} alt="" width={1600} height={1110} loading="lazy" className="art-lens absolute inset-0 size-full object-cover object-bottom" />
    </div>
  );
}
