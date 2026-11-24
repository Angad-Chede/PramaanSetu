"use client";

import * as React from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform, type Transition } from "motion/react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Skeleton } from "@/components/ui/skeleton";

const GROW: Transition = { type: "spring", visualDuration: 0.6, bounce: 0.12 };
const STAGGER = 0.045;
const LAYOUT: Transition = { type: "spring", visualDuration: 0.4, bounce: 0.18 };
const FADE: Transition = { duration: 0.2, ease: [0.22, 1, 0.36, 1] };
const INSTANT: Transition = { duration: 0 };
const BAR_RADIUS = 8;
const MIN_BAR = 1.2;
const SKELETON_WIDTHS = [92, 71, 58, 44, 33, 24];

const keepSpaces = (text?: string) => text?.replace(/^ +| +$/g, " ");

export type BarListItem = {
  id?: string;
  name: string;
  value: number;
  icon?: React.ReactNode;
  href?: string;
  meta?: React.ReactNode;
  color?: string;
};

export type BarListProps = Omit<React.ComponentProps<"div">, "children" | "prefix" | "onSelect"> & {
  data: BarListItem[];
  prefix?: string;
  suffix?: string;
  decimals?: number;
  sort?: "descending" | "ascending" | "none";
  limit?: number;
  showShare?: boolean;
  color?: string;
  header?: { name: React.ReactNode; value: React.ReactNode };
  onSelect?: (item: BarListItem) => void;
  loading?: boolean;
  emptyState?: React.ReactNode;
};

// the bar is always full width and clipped, so growing it never triggers layout
function BarFill({ pct, delay, reduced, className, style }: { pct: number; delay: number; reduced: boolean; className?: string; style?: React.CSSProperties }) {
  const reveal = useMotionValue(reduced ? pct : 0);
  const clipPath = useTransform(reveal, (value) => `inset(0 ${100 - value}% 0 0 round ${BAR_RADIUS}px)`);
  const mounted = React.useRef(false);

  React.useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (reduced) {
      reveal.set(pct);
      return;
    }
    const controls = animate(reveal, pct, { ...GROW, delay: first ? delay : 0 });
    return () => controls.stop();
  }, [pct, delay, reduced, reveal]);

  return <motion.span aria-hidden className={cn("absolute inset-0 rounded-lg", className)} style={{ ...style, clipPath }} />;
}

function BarList({
  data,
  prefix,
  suffix,
  decimals = 0,
  sort = "descending",
  limit,
  showShare = false,
  color = "var(--chart-2)",
  header,
  onSelect,
  loading = false,
  emptyState,
  className,
  ...props
}: BarListProps) {
  const reduced = useReducedMotion() ?? false;
  const [expanded, setExpanded] = React.useState(false);
  const listId = React.useId();

  const sorted = React.useMemo(() => {
    if (sort === "none") return data;
    return [...data].sort((a, b) => (sort === "descending" ? b.value - a.value : a.value - b.value));
  }, [data, sort]);
  const max = Math.max(0, ...sorted.map((item) => item.value));
  const total = sorted.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const visible = limit && !expanded ? sorted.slice(0, limit) : sorted;
  const hidden = sorted.length - visible.length;
  const format = (value: number) =>
    `${prefix ?? ""}${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix ?? ""}`;

  return (
    <div data-slot="bar-list" aria-busy={loading || undefined} className={cn("flex w-full flex-col", className)} {...props}>
      {header && (
        <div data-slot="bar-list-header" className="mb-1.5 flex items-center justify-between px-2.5 text-xs font-medium text-muted-foreground">
          <span>{header.name}</span>
          <span>{header.value}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-1.5">
          {SKELETON_WIDTHS.slice(0, limit ?? 5).map((width, index) => (
            <div key={index} className="flex h-8 items-center gap-3">
              <Skeleton className="h-full rounded-lg" style={{ width: `${width}%` }} />
              <Skeleton className="ml-auto h-3 w-10 shrink-0" />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div data-slot="bar-list-empty" className="grid min-h-32 place-items-center rounded-2xl bg-surface/60 px-4 text-center text-sm text-muted-foreground">
          {emptyState ?? "Nothing to rank yet"}
        </div>
      ) : (
        <ul id={listId} className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {visible.map((item, index) => {
              const pct = max > 0 ? Math.max(MIN_BAR, (Math.max(0, item.value) / max) * 100) : 0;
              const share = total > 0 ? (Math.max(0, item.value) / total) * 100 : 0;
              const shareText = `${share.toFixed(share > 0 && share < 10 ? 1 : 0)}%`;
              const fill = item.color ?? color;
              const interactive = Boolean(onSelect || item.href);
              const Row = item.href ? "a" : onSelect ? "button" : "div";
              return (
                <motion.li
                  key={item.id ?? item.name}
                  layout={reduced ? false : "position"}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: reduced ? INSTANT : FADE }}
                  transition={reduced ? INSTANT : LAYOUT}
                  data-slot="bar-list-item"
                >
                  <Row
                    {...(item.href ? { href: item.href } : {})}
                    {...(Row === "button" ? { type: "button" as const } : {})}
                    onClick={onSelect ? () => onSelect(item) : undefined}
                    aria-label={interactive ? `${item.name}: ${format(item.value)}${showShare ? `, ${shareText}` : ""}` : undefined}
                    className={cn(
                      "group/row relative flex h-8 w-full items-center gap-3 rounded-lg text-left text-[13px] outline-none",
                      interactive &&
                        "cursor-pointer transition-transform duration-150 ease-ios focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] pointer-coarse:h-11",
                    )}
                  >
                    <div className="relative flex h-full min-w-0 flex-1 items-center">
                      {pct > 0 && (
                        <BarFill
                          pct={pct}
                          delay={index * STAGGER}
                          reduced={reduced}
                          className={cn(
                            "transition-[background-color] duration-200 [--bar-mix:15%] dark:[--bar-mix:24%]",
                            interactive && "group-hover/row:[--bar-mix:22%] dark:group-hover/row:[--bar-mix:32%]",
                          )}
                          style={{ backgroundColor: `color-mix(in oklab, ${fill} var(--bar-mix), transparent)` }}
                        />
                      )}
                      <span data-slot="bar-list-label" className="relative flex min-w-0 items-center gap-2 px-2.5">
                        {item.icon && <span className="flex shrink-0 text-glyph [&_svg]:size-3.5">{item.icon}</span>}
                        <span className="truncate text-foreground">{item.name}</span>
                        {item.meta && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{item.meta}</span>}
                      </span>
                    </div>
                    <span data-slot="bar-list-value" className="flex shrink-0 items-center gap-2 pr-1 tabular-nums">
                      <AnimatedCounter
                        value={item.value}
                        prefix={keepSpaces(prefix)}
                        suffix={keepSpaces(suffix)}
                        decimals={decimals}
                        className="font-medium tracking-tight"
                      />
                      {showShare && <span className="w-10 text-right text-xs text-muted-foreground">{shareText}</span>}
                    </span>
                  </Row>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {!loading && limit != null && sorted.length > limit && (
        <button
          type="button"
          data-slot="bar-list-toggle"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={listId}
          className="relative mt-2 inline-flex h-7 items-center gap-1 self-start rounded-full px-2.5 text-xs font-medium text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 ease-ios after:absolute after:-inset-x-1 after:-inset-y-2 hover:bg-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
        >
          {expanded ? "Show less" : `Show ${hidden} more`}
          <ChevronDown className={cn("size-3.5 transition-transform duration-300 ease-ios", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

export { BarList };
