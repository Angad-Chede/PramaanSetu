"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type Chapter = { number: string; title: string; body: string; visual: React.ReactNode };

/**
 * Five records, read in order. The list holds its place on the left while each record's
 * picture scrolls past on the right; the one in the middle of the screen is the one lit.
 */
export function Chapters({ chapters }: { chapters: Chapter[] }) {
  const [active, setActive] = React.useState(0);
  const panels = React.useRef<(HTMLDivElement | null)[]>([]);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    panels.current.forEach((panel) => panel && observer.observe(panel));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
      <ol className="hidden lg:sticky lg:top-28 lg:col-span-5 lg:flex lg:h-fit lg:flex-col">
        {chapters.map((chapter, index) => (
          <li key={chapter.number} className="border-t border-ink/12 last:border-b">
            <button
              type="button"
              onClick={() => panels.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" })}
              aria-current={active === index ? "step" : undefined}
              className="group flex w-full gap-6 py-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
            >
              <span className={cn("pt-1.5 font-mono text-[12px] tabular-nums transition-colors duration-300", active === index ? "text-vermilion" : "text-ink/35")}>{chapter.number}</span>
              <span className="flex flex-col gap-2">
                <span className={cn("font-serif text-[26px] leading-[1.1] tracking-[-0.02em] transition-colors duration-300", active === index ? "text-ink" : "text-ink/35 group-hover:text-ink/60")}>
                  {chapter.title}
                </span>
                <span
                  className={cn(
                    "grid max-w-[44ch] text-[15px] leading-relaxed text-ink/60 transition-[grid-template-rows,opacity] duration-500 ease-out-soft",
                    active === index ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <span className="overflow-hidden">{chapter.body}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-16 lg:col-span-7 lg:gap-[12svh] lg:py-[8svh]">
        {chapters.map((chapter, index) => (
          <div key={chapter.number} ref={(node) => void (panels.current[index] = node)} data-index={index} className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 lg:hidden">
              <span className="font-mono text-[12px] text-vermilion">{chapter.number}</span>
              <h3 className="font-serif text-[30px] leading-[1.08] tracking-[-0.02em] text-ink">{chapter.title}</h3>
              <p className="text-[16px] leading-relaxed text-ink/65">{chapter.body}</p>
            </div>
            {chapter.visual}
          </div>
        ))}
      </div>
    </div>
  );
}
