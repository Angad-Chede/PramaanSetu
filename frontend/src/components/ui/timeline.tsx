"use client";

import * as React from "react";
import { motion, useReducedMotion, type Transition } from "motion/react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const FILL: Transition = { duration: 0.5, ease: [0.32, 0.72, 0, 1] };
const STAGGER = 0.12;
const POP: Transition = { type: "spring", stiffness: 520, damping: 22, mass: 0.6 };
const INSTANT: Transition = { duration: 0 };

export type TimelineStatus = "complete" | "current" | "upcoming";

export type TimelineItem = {
  id: string;
  title: React.ReactNode;
  status: TimelineStatus;
  description?: React.ReactNode;
  date?: React.ReactNode;
  icon?: React.ReactNode;
  meta?: React.ReactNode;
};

export type TimelineProps = Omit<React.ComponentProps<"ol">, "children"> & {
  items: TimelineItem[];
  loading?: boolean;
};

const STATUS_LABEL = { complete: "Complete", current: "In progress", upcoming: "Upcoming" } as const;

function Marker({ status, icon, delay, reduced }: { status: TimelineStatus; icon?: React.ReactNode; delay: number; reduced: boolean }) {
  if (status === "complete") {
    return (
      <motion.span
        data-slot="timeline-marker"
        className="relative z-10 grid size-6 place-items-center rounded-full bg-success text-white [&_svg]:size-3.5"
        initial={reduced ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? INSTANT : { ...POP, delay }}
      >
        {icon ?? <Check strokeWidth={3} />}
      </motion.span>
    );
  }
  if (status === "current") {
    return (
      <span data-slot="timeline-marker" className="relative z-10 grid size-6 place-items-center rounded-full bg-card">
        <span aria-hidden className="absolute inset-0 rounded-full bg-brand/14" />
        {!reduced && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand/25 [animation-duration:2s]" />}
        <span className="relative size-2.5 rounded-full bg-brand" />
      </span>
    );
  }
  return (
    <span data-slot="timeline-marker" className="relative z-10 grid size-6 place-items-center rounded-full bg-card">
      {icon ? (
        <span className="text-glyph [&_svg]:size-3.5">{icon}</span>
      ) : (
        <span className="size-2.5 rounded-full border-[1.5px] border-glyph/70" />
      )}
    </span>
  );
}

function Timeline({ items, loading = false, className, ...props }: TimelineProps) {
  const reduced = useReducedMotion() ?? false;
  // the stagger is for the first paint only; later status changes animate right away
  const [staggered, setStaggered] = React.useState(true);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setStaggered(false), items.length * STAGGER * 1000 + 600);
    return () => window.clearTimeout(timer);
  }, [items.length]);

  if (loading) {
    return (
      <ol data-slot="timeline" aria-busy className={cn("flex flex-col gap-5", className)} {...props}>
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className="flex gap-3">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5 pt-1">
              <Skeleton className="h-3" style={{ width: `${56 - index * 8}%` }} />
              <Skeleton className="h-2.5 w-2/3" />
            </div>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol data-slot="timeline" className={cn("flex flex-col", className)} {...props}>
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const next = items[index + 1];
        const filled = item.status === "complete" && next != null && next.status !== "upcoming";
        const half = item.status === "complete" && next?.status === "upcoming";
        return (
          <li
            key={item.id}
            data-slot="timeline-item"
            data-status={item.status}
            aria-current={item.status === "current" ? "step" : undefined}
            className="relative flex gap-3"
          >
            {!last && (
              // the rail runs center to center behind the opaque markers, so it reads as one line
              <span aria-hidden data-slot="timeline-connector" className="absolute top-3 -bottom-3 left-[11px] w-0.5 overflow-hidden bg-foreground/10">
                <motion.span
                  className="absolute inset-0 block origin-top bg-success"
                  initial={reduced ? false : { scaleY: 0 }}
                  animate={{ scaleY: filled ? 1 : half ? 0.5 : 0 }}
                  transition={reduced ? INSTANT : { ...FILL, delay: staggered ? index * STAGGER + 0.1 : 0 }}
                />
              </span>
            )}
            <div className="relative flex w-6 shrink-0 flex-col items-center">
              <Marker status={item.status} icon={item.icon} delay={staggered ? index * STAGGER : 0} reduced={reduced} />
            </div>
            <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-5")}>
              <div className="flex min-h-6 items-center gap-2">
                <span
                  className={cn(
                    "min-w-0 truncate text-[13px] font-medium",
                    item.status === "upcoming" && "text-muted-foreground",
                  )}
                >
                  {item.title}
                </span>
                {item.status === "current" && (
                  <span className="shrink-0 rounded-full bg-brand/12 px-2 text-[11px] leading-5 font-medium text-brand-ink">{STATUS_LABEL.current}</span>
                )}
                <span className="sr-only">{item.status !== "current" ? STATUS_LABEL[item.status] : ""}</span>
                {item.date && <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{item.date}</span>}
              </div>
              {item.description && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.description}</p>}
              {item.meta && <div className="mt-2">{item.meta}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export { Timeline };
