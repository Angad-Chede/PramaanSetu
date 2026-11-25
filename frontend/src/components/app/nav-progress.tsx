"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar along the top that starts the moment an internal link is clicked and
 * finishes when the new page is on screen, so a navigation that waits on the server
 * still answers the click at once. Shown only after a short delay, so instant
 * navigations do not flash it.
 */
function Bar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [state, setState] = React.useState<"idle" | "running" | "done">("idle");
  const timers = React.useRef<number[]>([]);

  const clear = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor || !anchor.href || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      clear();
      timers.current.push(window.setTimeout(() => setState("running"), 120));
      // never stuck on screen if a navigation is abandoned
      timers.current.push(window.setTimeout(() => setState("idle"), 20000));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  React.useEffect(() => {
    clear();
    setState((current) => (current === "running" ? "done" : "idle"));
    timers.current.push(window.setTimeout(() => setState("idle"), 320));
  }, [pathname, search]);

  return (
    <div
      aria-hidden
      data-state={state}
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2px] origin-left bg-brand opacity-0 [transform:scaleX(0)] data-[state=done]:opacity-0 data-[state=done]:[transform:scaleX(1)] data-[state=done]:[transition:transform_160ms_ease-out,opacity_200ms_120ms] data-[state=running]:animate-[nav-progress_8s_cubic-bezier(0.1,0.7,0.2,1)_forwards] data-[state=running]:opacity-100"
    />
  );
}

export function NavProgress() {
  return (
    <React.Suspense fallback={null}>
      <Bar />
    </React.Suspense>
  );
}
