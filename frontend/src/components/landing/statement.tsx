"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A statement whose words light up one by one as it scrolls through the screen, so it
 * is read at the pace of the scroll. Without script, or under reduced motion, it shows
 * whole.
 */
export function Statement({ text, className }: { text: string; className?: string }) {
  const ref = React.useRef<HTMLParagraphElement>(null);
  const words = React.useMemo(() => text.split(" "), [text]);

  React.useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const spans = Array.from(root.querySelectorAll<HTMLSpanElement>("[data-word]"));
    let frame = 0;
    const paint = () => {
      const rect = root.getBoundingClientRect();
      const view = window.innerHeight;
      // lit from the moment the top passes 85% of the screen until the end passes 45%
      const progress = (view * 0.85 - rect.top) / (rect.height + view * 0.4);
      const lit = Math.round(Math.min(1, Math.max(0, progress)) * spans.length);
      spans.forEach((span, index) => span.toggleAttribute("data-lit", index < lit));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    };
    root.setAttribute("data-live", "");
    paint();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <p ref={ref} className={cn("group/st", className)}>
      {words.map((word, index) => (
        <span key={index} data-word className="transition-colors duration-300 group-data-[live]/st:text-white/25 group-data-[live]/st:data-[lit]:text-white">
          {word}{" "}
        </span>
      ))}
    </p>
  );
}
