"use client";

// liquid-type and marquee-row, ported from taste-skill (https://github.com/Leonxlnx/taste-skill), MIT, Copyright (c) 2026 Leonxlnx.

import * as React from "react";
import { Pause, Play } from "lucide-react";

import { cn } from "@/lib/utils";

const LIQUID_DECAY = 0.93;
const LIQUID_MAX = 44;

function stillMotion() {
  if (typeof window === "undefined") return true;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    window.matchMedia("(pointer: coarse)").matches ||
    window.innerWidth < 640
  );
}

/** A headline that ripples like type seen through water under the pointer, then settles back to crisp. */
export function LiquidType({ children, className, strength = 1, reach = 0.3 }: { children: React.ReactNode; className?: string; strength?: number; reach?: number }) {
  const ref = React.useRef<HTMLHeadingElement>(null);
  const id = React.useId().replace(/:/g, "");

  React.useEffect(() => {
    const type = ref.current;
    if (!type || stillMotion() || typeof SVGFEDisplacementMapElement === "undefined") return;
    const host = type.parentElement ?? type;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;pointer-events:none";
    svg.innerHTML = `<filter id="lt-${id}" x="-5%" y="-20%" width="110%" height="140%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.013" numOctaves="1" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter>`;
    document.body.append(svg);
    const turb = svg.querySelector("feTurbulence")!;
    const disp = svg.querySelector("feDisplacementMap")!;
    let energy = 0;
    let raf = 0;
    let on = false;
    let lastX = 0;
    let lastY = 0;
    let hasLast = false;
    let clock = 0;
    let px = 0.5;

    const apply = () => {
      const scale = Math.min(LIQUID_MAX, energy) * strength;
      if (scale < 0.6) {
        if (on) {
          type.style.filter = "";
          on = false;
        }
        return false;
      }
      disp.setAttribute("scale", scale.toFixed(1));
      // the map drifts with the pointer and the clock, so the ripple flows rather than sits
      const dx = 0.006 + (px - 0.5) * 0.002;
      const dy = 0.013 + Math.sin(clock / 700) * 0.003;
      turb.setAttribute("baseFrequency", `${dx.toFixed(4)} ${dy.toFixed(4)}`);
      if (!on) {
        type.style.filter = `url(#lt-${id})`;
        on = true;
      }
      return true;
    };
    const tick = (now: number) => {
      raf = 0;
      clock = now;
      energy *= LIQUID_DECAY;
      if (apply()) raf = requestAnimationFrame(tick);
      else energy = 0;
    };
    const move = (event: PointerEvent) => {
      const rect = type.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inside = x > -rect.width * 0.04 && x < rect.width * 1.04 && y > -rect.height * 0.2 && y < rect.height * 1.2;
      if (!inside) {
        hasLast = false;
        return;
      }
      px = Math.min(1, Math.max(0, x / rect.width));
      if (hasLast) {
        const velocity = Math.hypot(event.clientX - lastX, event.clientY - lastY);
        energy = Math.min(LIQUID_MAX, energy + Math.min(9, velocity * 0.3) * (0.5 + reach));
      }
      lastX = event.clientX;
      lastY = event.clientY;
      hasLast = true;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const leave = () => {
      hasLast = false;
    };
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
      type.style.filter = "";
      svg.remove();
    };
  }, [id, strength, reach]);

  return (
    <h2 ref={ref} data-moment="liquid-type" data-moment-mounted className={cn("cursor-default", className)}>
      {children}
    </h2>
  );
}

/** One row of real words moving slowly sideways, fading at both edges, with a pause button. */
export function MarqueeRow({ items, speed = 36, className }: { items: string[]; speed?: number; className?: string }) {
  const trackRef = React.useRef<HTMLUListElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [live, setLive] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [width, setWidth] = React.useState(1000);

  React.useEffect(() => {
    if (items.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setLive(true);
    const track = trackRef.current;
    const root = rootRef.current;
    if (!track || !root) return;
    const fit = () => setWidth(track.scrollWidth);
    fit();
    void document.fonts?.ready.then(fit);
    const resize = new ResizeObserver(fit);
    resize.observe(track);
    const seen = new IntersectionObserver((entries) => setVisible(entries[entries.length - 1].isIntersecting));
    seen.observe(root);
    return () => {
      resize.disconnect();
      seen.disconnect();
    };
  }, [items.length]);

  const gap = 56;
  const running = live && visible && !paused;
  const style = {
    "--mq-w": `${width}px`,
    "--mq-gap": `${gap}px`,
    "--mq-dur": `${(width / speed).toFixed(2)}s`,
    animationPlayState: running ? "running" : "paused",
  } as React.CSSProperties;

  const list = (hidden: boolean) => (
    <ul
      ref={hidden ? undefined : trackRef}
      aria-hidden={hidden || undefined}
      style={live ? style : undefined}
      className={cn(
        "m-0 flex shrink-0 list-none items-center gap-(--mq-gap) p-0 font-display text-xl font-medium tracking-tight whitespace-nowrap text-muted-foreground md:text-2xl",
        live ? "animate-[marquee_var(--mq-dur)_linear_infinite] group-hover/mq:[animation-play-state:paused]!" : "flex-wrap gap-x-8 gap-y-3 whitespace-normal",
      )}
    >
      {items.map((item, index) => (
        <li key={item + index} className="flex items-center gap-(--mq-gap)">
          <span>{item}</span>
          <span aria-hidden className="size-1.5 rounded-full bg-brand/70" />
        </li>
      ))}
    </ul>
  );

  return (
    <div ref={rootRef} data-moment="marquee-row" data-moment-mounted={live || undefined} data-edge-free className={cn("group/mq relative py-4", className)} style={{ "--mq-gap": `${gap}px` } as React.CSSProperties}>
      <div
        className={cn(
          "flex min-w-0 gap-(--mq-gap)",
          live && "overflow-hidden pr-14 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_86%,transparent_94%)]",
        )}
      >
        {list(false)}
        {live && list(true)}
      </div>
      {live && (
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-label={paused ? "Play the moving row" : "Pause the moving row"}
          className="absolute top-1/2 right-0 grid size-11 outline-none focus-visible:ring-2 focus-visible:ring-brand -translate-y-1/2 place-items-center rounded-full bg-surface text-glyph shadow-lift transition-[background-color,scale] duration-150 hover:bg-surface-hover hover:text-foreground active:scale-95"
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
