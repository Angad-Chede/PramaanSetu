"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { Cell, Pie, PieChart, Sector } from "recharts";

import { cn } from "@/lib/utils";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Skeleton } from "@/components/ui/skeleton";

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--glyph)", "var(--chart-5)"];
const CAPTION: Transition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] };
const INSTANT: Transition = { duration: 0 };
const SWEEP_MS = 900;
const ACTIVE_GROW = 4;
const PAD_ANGLE = 2;

const keepSpaces = (text?: string) => text?.replace(/^ +| +$/g, " ");

export type DonutDatum = { name: string; value: number; color?: string };

export type DonutChartProps = Omit<React.ComponentProps<"div">, "children" | "prefix"> & {
  data: DonutDatum[];
  prefix?: string;
  suffix?: string;
  decimals?: number;
  label?: React.ReactNode;
  size?: number;
  thickness?: number;
  legend?: "auto" | "right" | "bottom" | "none";
  formatValue?: (value: number) => string;
  loading?: boolean;
  emptyState?: React.ReactNode;
};

type SectorProps = React.ComponentProps<typeof Sector> & { outerRadius?: number };

function ActiveSlice(props: unknown) {
  const sector = props as SectorProps;
  return <Sector {...sector} outerRadius={(sector.outerRadius ?? 0) + ACTIVE_GROW} />;
}

function DonutChart({
  data,
  prefix,
  suffix,
  decimals = 0,
  label = "Total",
  size = 168,
  thickness = 20,
  legend = "auto",
  formatValue,
  loading = false,
  emptyState,
  className,
  ...props
}: DonutChartProps) {
  const reduced = useReducedMotion() ?? false;
  const [active, setActive] = React.useState<number | null>(null);
  const slices = data.map((d, i) => ({ ...d, value: Math.max(0, d.value), fill: d.color ?? PALETTE[i % PALETTE.length] }));
  const total = slices.reduce((sum, d) => sum + d.value, 0);
  const empty = total === 0;
  const current = active != null ? slices[active] : null;
  const format =
    formatValue ??
    ((n: number) => `${prefix ?? ""}${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix ?? ""}`);
  const outer = size / 2 - ACTIVE_GROW;
  const inner = outer - thickness;
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0);

  const layout =
    legend === "right" ? "flex-col @[17rem]/donut:flex-row" : legend === "bottom" ? "flex-col" : "flex-col @md/donut:flex-row";

  return (
    <div data-slot="donut-chart" aria-busy={loading || undefined} className={cn("@container/donut w-full", className)} {...props}>
      <div className={cn("flex items-center gap-4", layout)} onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}>
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          {loading ? (
            <Skeleton
              className="size-full rounded-full"
              style={{ mask: `radial-gradient(circle, transparent ${inner}px, #000 ${inner + 0.5}px)`, WebkitMask: `radial-gradient(circle, transparent ${inner}px, #000 ${inner + 0.5}px)` }}
            />
          ) : (
            <PieChart
              width={size}
              height={size}
              className="[-webkit-tap-highlight-color:transparent] [&_.recharts-sector]:cursor-pointer [&_.recharts-sector]:outline-none [&_.recharts-sector]:transition-[fill-opacity] [&_.recharts-sector]:duration-200 [&_.recharts-surface]:outline-none"
            >
              {empty ? (
                <Pie data={[{ value: 1 }]} dataKey="value" innerRadius={inner} outerRadius={outer} stroke="none" isAnimationActive={false}>
                  <Cell fill="var(--surface)" />
                </Pie>
              ) : (
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={inner}
                  outerRadius={outer}
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={slices.filter((s) => s.value > 0).length > 1 ? PAD_ANGLE : 0}
                  cornerRadius={4}
                  stroke="none"
                  activeIndex={active ?? undefined}
                  activeShape={ActiveSlice}
                  onMouseEnter={(_, index) => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                  onClick={(_, index) => setActive(index)}
                  isAnimationActive={!reduced}
                  animationBegin={0}
                  animationDuration={SWEEP_MS}
                  animationEasing="ease-out"
                >
                  {slices.map((slice, index) => (
                    <Cell key={slice.name} fill={slice.fill} fillOpacity={active == null || active === index ? 1 : 0.3} />
                  ))}
                </Pie>
              )}
            </PieChart>
          )}

          {!loading && (
            <div data-slot="donut-chart-center" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-live="polite">
              {empty ? (
                <span className="text-sm text-muted-foreground">{emptyState ?? "No data"}</span>
              ) : (
                <>
                  <span aria-hidden className="h-4" />
                  <AnimatedCounter
                    value={current ? current.value : total}
                    prefix={keepSpaces(prefix)}
                    suffix={keepSpaces(suffix)}
                    decimals={decimals}
                    className="leading-none font-semibold tracking-tight"
                    style={{ fontSize: Math.round(Math.min(26, Math.max(15, inner * 0.36))) }}
                  />
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={current?.name ?? "__total"}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={reduced ? INSTANT : CAPTION}
                      className="truncate text-xs text-muted-foreground"
                      style={{ maxWidth: inner * 1.85 }}
                    >
                      {current ? current.name : label}
                    </motion.span>
                  </AnimatePresence>
                  <span aria-hidden={!current} className={cn("h-4 text-[11px] leading-4 text-muted-foreground tabular-nums transition-opacity duration-200", !current && "opacity-0")}>
                    {current ? `${share(current.value).toFixed(1)}% of total` : ""}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {legend !== "none" && (
          <ul data-slot="donut-chart-legend" className="grid w-full min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-0.5">
            {loading
              ? [64, 52, 44, 36].map((width, index) => (
                  <li key={index} className="flex h-8 items-center gap-2 px-2 pointer-coarse:h-11">
                    <Skeleton className="size-2.5 rounded-full" />
                    <Skeleton className="h-3" style={{ width: `${width}%` }} />
                    <Skeleton className="ml-auto h-3 w-8" />
                  </li>
                ))
              : slices.map((slice, index) => (
                  <li key={slice.name}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onMouseLeave={() => setActive(null)}
                      onClick={() => setActive(index)}
                      onFocus={() => setActive(index)}
                      onBlur={() => setActive(null)}
                      aria-label={`${slice.name}: ${format(slice.value)}, ${share(slice.value).toFixed(1)}%`}
                      className={cn(
                        "flex h-8 w-full items-center gap-1.5 rounded-lg px-1.5 text-left text-[13px] outline-none transition-[background-color,opacity] duration-200 [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11",
                        active === index && "bg-surface",
                        active != null && active !== index && "opacity-50",
                      )}
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.fill }} />
                      <span className="min-w-0 flex-1 truncate text-foreground">{slice.name}</span>
                      <span className="hidden shrink-0 text-muted-foreground tabular-nums @sm/donut:inline">{format(slice.value)}</span>
                      <span className="w-9 shrink-0 text-right font-medium tabular-nums">{share(slice.value).toFixed(share(slice.value) < 10 ? 1 : 0)}%</span>
                    </button>
                  </li>
                ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export { DonutChart };
