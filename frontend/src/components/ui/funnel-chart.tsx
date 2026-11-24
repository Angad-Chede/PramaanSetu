"use client";

import * as React from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type Transition } from "motion/react";

import { cn } from "@/lib/utils";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Skeleton } from "@/components/ui/skeleton";

const GROW: Transition = { type: "spring", visualDuration: 0.6, bounce: 0.1 };
const STAGGER = 0.08;
const BAR_HEIGHT = 32;
const NECK_HEIGHT = 18;
const BAR_RADIUS = 8;
const MIN_BAR = 1.5;
const NECK_TINT = 12;

const keepSpaces = (text?: string) => text?.replace(/^ +| +$/g, " ");

const GRID = "grid grid-cols-[minmax(0,6.5rem)_1fr_3.25rem] items-center gap-3 @md/funnel:grid-cols-[minmax(0,9rem)_1fr_4rem]";

export type FunnelStage = { id?: string; label: string; value: number };

export type FunnelChartProps = Omit<React.ComponentProps<"div">, "children" | "prefix"> & {
  stages: FunnelStage[];
  prefix?: string;
  suffix?: string;
  decimals?: number;
  color?: string;
  formatValue?: (value: number) => string;
  loading?: boolean;
  emptyState?: React.ReactNode;
};

const pct = (n: number) => `${n.toFixed(n < 10 && n > 0 ? 1 : 0)}%`;

// drives a 0 to 100 reveal through a motion value, so width changes never touch layout
function useReveal(target: number, delay: number, reduced: boolean) {
  const value = useMotionValue(reduced ? target : 0);
  const mounted = React.useRef(false);
  React.useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (reduced) {
      value.set(target);
      return;
    }
    const controls = animate(value, target, { ...GROW, delay: first ? delay : 0 });
    return () => controls.stop();
  }, [target, delay, reduced, value]);
  return value;
}

function FunnelBar({ width, delay, reduced, color }: { width: number; delay: number; reduced: boolean; color: string }) {
  const reveal = useReveal(Math.max(MIN_BAR, width), delay, reduced);
  const clipPath = useTransform(reveal, (w) => `inset(0 ${(100 - w) / 2}% 0 ${(100 - w) / 2}% round ${BAR_RADIUS}px)`);
  return <motion.div data-slot="funnel-chart-bar" aria-hidden className="h-full w-full" style={{ backgroundColor: color, clipPath }} />;
}

function FunnelNeck({ from, to, delay, reduced, color }: { from: number; to: number; delay: number; reduced: boolean; color: string }) {
  const top = useReveal(Math.max(MIN_BAR, from), delay, reduced);
  const bottom = useReveal(Math.max(MIN_BAR, to), delay, reduced);
  const clipPath = useTransform([top, bottom], ([t, b]: number[]) => {
    const tl = (100 - t) / 2;
    const bl = (100 - b) / 2;
    return `polygon(${tl}% 0%, ${100 - tl}% 0%, ${100 - bl}% 100%, ${bl}% 100%)`;
  });
  return (
    <motion.div
      aria-hidden
      className="h-full w-full"
      style={{ backgroundColor: `color-mix(in oklab, ${color} ${NECK_TINT}%, transparent)`, clipPath }}
    />
  );
}

function FunnelChart({
  stages,
  prefix,
  suffix,
  decimals = 0,
  color = "var(--brand)",
  formatValue,
  loading = false,
  emptyState,
  className,
  ...props
}: FunnelChartProps) {
  const reduced = useReducedMotion() ?? false;
  const top = Math.max(0, stages[0]?.value ?? 0);
  const widths = stages.map((stage) => (top > 0 ? Math.max(0, Math.min(1, stage.value / top)) * 100 : 0));
  const format =
    formatValue ??
    ((n: number) => `${prefix ?? ""}${n.toLocaleString("en-US", { maximumFractionDigits: decimals })}${suffix ?? ""}`);

  if (loading) {
    return (
      <div data-slot="funnel-chart" aria-busy className={cn("flex w-full flex-col", className)} {...props}>
        {[100, 72, 48, 30].map((width, index) => (
          <div key={index} className={GRID} style={{ height: BAR_HEIGHT, marginTop: index ? NECK_HEIGHT : 0 }}>
            <Skeleton className="h-3 w-20" />
            <div className="flex justify-center">
              <Skeleton className="rounded-lg" style={{ width: `${width}%`, height: BAR_HEIGHT }} />
            </div>
            <Skeleton className="ml-auto h-3 w-8" />
          </div>
        ))}
      </div>
    );
  }

  if (!stages.length || top <= 0) {
    return (
      <div data-slot="funnel-chart" className={cn("grid min-h-40 w-full place-items-center rounded-2xl bg-surface/60 px-4 text-center text-sm text-muted-foreground", className)} {...props}>
        {emptyState ?? "No one has entered this funnel yet"}
      </div>
    );
  }

  return (
    <div data-slot="funnel-chart" role="list" className={cn("@container/funnel flex w-full flex-col", className)} {...props}>
      {stages.map((stage, index) => {
        const width = widths[index];
        const prev = index > 0 ? stages[index - 1].value : null;
        const step = prev && prev > 0 ? (stage.value / prev) * 100 : null;
        const drop = step != null ? 100 - step : null;
        return (
          <React.Fragment key={stage.id ?? stage.label}>
            {index > 0 && (
              <div data-slot="funnel-chart-step" aria-hidden className={GRID} style={{ height: NECK_HEIGHT }}>
                <span />
                <FunnelNeck from={widths[index - 1]} to={width} delay={(index - 1) * STAGGER} reduced={reduced} color={color} />
                <span className="justify-self-end text-[11px] leading-none font-medium text-muted-foreground tabular-nums">
                  {drop != null && drop > 0 ? `\u2212${pct(drop)}` : ""}
                </span>
              </div>
            )}
            <div
              role="listitem"
              data-slot="funnel-chart-stage"
              aria-label={`${stage.label}: ${format(stage.value)}, ${pct(width)} of ${stages[0].label}${step != null ? `, ${pct(step)} from ${stages[index - 1].label}` : ""}`}
              className={GRID}
              style={{ height: BAR_HEIGHT }}
            >
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[13px] font-medium">{stage.label}</p>
                <AnimatedCounter
                  value={stage.value}
                  prefix={keepSpaces(prefix)}
                  suffix={keepSpaces(suffix)}
                  decimals={decimals}
                  className="text-[11px] text-muted-foreground"
                />
              </div>
              <FunnelBar width={width} delay={index * STAGGER} reduced={reduced} color={color} />
              <span className="justify-self-end text-[13px] font-medium tracking-tight tabular-nums">{pct(width)}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export { FunnelChart };
