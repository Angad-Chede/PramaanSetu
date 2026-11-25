"use client";

import * as React from "react";

/** Marks its seals as landed when they come into view, once. */
export function SealRow({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const seals = root.querySelectorAll<HTMLElement>(".seal");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          seals.forEach((seal) => seal.setAttribute("data-in", ""));
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
      <noscript>
        <style>{".seal{opacity:1}"}</style>
      </noscript>
    </div>
  );
}
