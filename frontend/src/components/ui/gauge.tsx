"use client";

import * as React from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type Transition } from "motion/react";

import { cn } from "@/lib/utils";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Skeleton } from "@/components/ui/skeleton";

const FILL: Transition = { type: "spring", visualDuration: 0.9, bounce: 0.08 };
const NEEDLE: Transition = { type: "spring", visualDuration: 0.9, bounce: 0.28 };
const INSTANT: Transition = { duration: 0 };
const EDGE = 6;
const HUB = 5;
const ZONE_OPACITY = 0.16;

const TONE = {
  brand: "var(--brand)",
  success: "var(--success)",
  warning: "var(--warning)",
  destructive: "var(--destructive)",
  info: "var(--info)",
  neutral: "var(--foreground)",
} as const;

const GEOMETRY = {
  semicircle: { start: 180, sweep: 180 },
  radial: { start: 135, sweep: 270 },
} as const;

const keepSpaces = (text?: string) => text?.replace(/^ +| +$/g, " ");

export type GaugeTone = keyof typeof TONE;
export type GaugeThreshold = { upTo: number; tone: GaugeTone; label?: string };

export type GaugeProps = Omit<React.ComponentProps<"div">, "children" | "prefix"> & {
  value: number;
  min?: number;
  max?: number;
  target?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  label?: React.ReactNode;
  caption?: React.ReactNode;
  variant?: keyof typeof GEOMETRY;
  thresholds?: GaugeThreshold[];
  tone?: GaugeTone;
  needle?: boolean;
  size?: number;
  thickness?: number;
  formatValue?: (value: number) => string;
  loading?: boolean;
};

const rad = (deg: number) => (deg * Math.PI) / 180;

function Gauge({
  value,
  min = 0,
  max = 100,
  target,
  prefix,
  suffix,
  decimals = 0,
  label,
  caption,
  variant = "semicircle",
  thresholds,
  tone = "brand",
  needle,
  size = 220,
  thickness = 14,
  formatValue,
  loading = false,
  className,
  ...props
}: GaugeProps) {
  const reduced = useReducedMotion() ?? false;
  const maskId = `gauge-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { start, sweep } = GEOMETRY[variant];
  const semi = variant === "semicircle";
  const showNeedle = needle ?? semi;
  const r = size / 2 - thickness / 2 - EDGE;
  const cx = size / 2;
  const cy = semi ? r + thickness / 2 + EDGE : size / 2;
  const height = semi ? cy + Math.max(thickness / 2, HUB) + 2 : cy + r * Math.sin(rad(45)) + thickness / 2 + 2;
  const span = max - min || 1;
  const clampFraction = (n: number) => Math.min(1, Math.max(0, (n - min) / span));
  const fraction = Number.isFinite(value) ? clampFraction(value) : 0;
  const zones = thresholds ? [...thresholds].sort((a, b) => a.upTo - b.upTo) : [];
  const zone = zones.find((z) => value <= z.upTo) ?? zones[zones.length - 1];
  const color = TONE[zone?.tone ?? tone];
  const format =
    formatValue ??
    ((n: number) => `${prefix ?? ""}${n.toLocaleString("en-US", { maximumFractionDigits: decimals })}${suffix ?? ""}`);

  const point = (f: number, radius = r) => {
    const angle = rad(start + f * sweep);
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  };
  const arc = (from: number, to: number) => {
    const a = point(from);
    const b = point(to);
    const large = (to - from) * sweep > 180 ? 1 : 0;
    return `M${a.x},${a.y}A${r},${r} 0 ${large} 1 ${b.x},${b.y}`;
  };
  const track = arc(0, 1);
  // the end zones run past the track by a cap's width and are clipped to it, so they wear its round caps
  const cap = ((thickness / 2 / r) * 180) / Math.PI / sweep;
  const needleAngle = start + fraction * sweep;
  const needleLength = r - thickness / 2 - 8;

  const angle = useMotionValue(reduced ? needleAngle : start);
  React.useEffect(() => {
    const swing = animate(angle, needleAngle, reduced ? INSTANT : NEEDLE);
    return () => swing.stop();
  }, [angle, needleAngle, reduced]);
  // the needle is drawn from the animated angle, so it always pivots on the hub
  const needlePath = useTransform(angle, (deg) => {
    const along = rad(deg);
    const across = along + Math.PI / 2;
    const tip = { x: cx + needleLength * Math.cos(along), y: cy + needleLength * Math.sin(along) };
    const base = (w: number, at: { x: number; y: number }) => [at.x + w * Math.cos(across), at.y + w * Math.sin(across), at.x - w * Math.cos(across), at.y - w * Math.sin(across)];
    const [b1x, b1y, b2x, b2y] = base(2.5, { x: cx, y: cy });
    const [t1x, t1y, t2x, t2y] = base(0.75, tip);
    return `M${b1x},${b1y}L${t1x},${t1y}L${t2x},${t2y}L${b2x},${b2y}Z`;
  });
  const inside = !(semi && showNeedle);
  const valueBlock = (
    <div
      data-slot="gauge-value"
      className={cn("pointer-events-none flex flex-col items-center text-center", inside ? "absolute inset-x-0" : "-mt-1 mb-1")}
      style={inside ? (semi ? { bottom: 0 } : { top: cy, transform: "translateY(-50%)" }) : undefined}
    >
      <AnimatedCounter
        value={Number.isFinite(value) ? value : 0}
        prefix={keepSpaces(prefix)}
        suffix={keepSpaces(suffix)}
        decimals={decimals}
        className={cn("leading-none font-semibold tracking-tight", size >= 200 ? "text-[28px]" : "text-[22px]")}
      />
      {label && <span className="mt-0.5 max-w-[10rem] truncate text-xs text-muted-foreground">{label}</span>}
    </div>
  );

  if (loading) {
    return (
      <div data-slot="gauge" aria-busy className={cn("flex flex-col items-center", className)} {...props}>
        <Skeleton
          style={{
            width: size,
            height,
            mask: `radial-gradient(circle at 50% ${cy}px, transparent ${r - thickness / 2}px, black ${r - thickness / 2 + 0.5}px, black ${r + thickness / 2}px, transparent ${r + thickness / 2 + 0.5}px)`,
            WebkitMask: `radial-gradient(circle at 50% ${cy}px, transparent ${r - thickness / 2}px, black ${r - thickness / 2 + 0.5}px, black ${r + thickness / 2}px, transparent ${r + thickness / 2 + 0.5}px)`,
          }}
        />
        <Skeleton className="mt-3 h-3 w-28" />
      </div>
    );
  }

  return (
    <div
      data-slot="gauge"
      data-variant={variant}
      role="meter"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      aria-label={typeof label === "string" ? label : undefined}
      className={cn("flex flex-col items-center", className)}
      {...props}
    >
      <div className="relative" style={{ width: size, height }}>
        <svg width={size} height={height} className="block overflow-visible" aria-hidden>
          <path d={track} fill="none" stroke="var(--surface)" strokeWidth={thickness} strokeLinecap="round" />
          {zones.length > 0 && (
            <>
              <mask id={maskId} maskUnits="userSpaceOnUse">
                <path d={track} fill="none" stroke="white" strokeWidth={thickness} strokeLinecap="round" />
              </mask>
              <g mask={`url(#${maskId})`}>
                {zones.map((z, index) => {
                  const from = index === 0 ? -cap : clampFraction(zones[index - 1].upTo);
                  const end = clampFraction(z.upTo);
                  const to = end >= 1 ? 1 + cap : end;
                  if (to <= from) return null;
                  return (
                    <path
                      key={`${z.tone}-${z.upTo}`}
                      data-slot="gauge-zone"
                      d={arc(from, to)}
                      fill="none"
                      stroke={TONE[z.tone]}
                      strokeOpacity={ZONE_OPACITY}
                      strokeWidth={thickness}
                      strokeLinecap="butt"
                    />
                  );
                })}
              </g>
            </>
          )}
          <motion.path
            data-slot="gauge-fill"
            d={track}
            fill="none"
            strokeWidth={thickness}
            strokeLinecap="round"
            initial={reduced ? false : { pathLength: 0, opacity: 0, stroke: color }}
            animate={{ pathLength: fraction, opacity: fraction > 0 ? 1 : 0, stroke: color }}
            transition={reduced ? INSTANT : { pathLength: FILL, opacity: { duration: 0.15 }, stroke: { duration: 0.3 } }}
          />
          {target != null && (
            <g data-slot="gauge-target">
              <line
                x1={point(clampFraction(target), r - thickness / 2 - 3).x}
                y1={point(clampFraction(target), r - thickness / 2 - 3).y}
                x2={point(clampFraction(target), r + thickness / 2 + 3).x}
                y2={point(clampFraction(target), r + thickness / 2 + 3).y}
                stroke="var(--card)"
                strokeWidth={5}
                strokeLinecap="round"
              />
              <line
                x1={point(clampFraction(target), r - thickness / 2 - 3).x}
                y1={point(clampFraction(target), r - thickness / 2 - 3).y}
                x2={point(clampFraction(target), r + thickness / 2 + 3).x}
                y2={point(clampFraction(target), r + thickness / 2 + 3).y}
                stroke="var(--foreground)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </g>
          )}
          {showNeedle && (
            <g data-slot="gauge-needle">
              <motion.path d={needlePath} fill="var(--foreground)" />
              <circle cx={cx} cy={cy} r={HUB} fill="var(--foreground)" />
              <circle cx={cx} cy={cy} r={HUB - 3} fill="var(--card)" />
            </g>
          )}
        </svg>

        {inside && valueBlock}
      </div>

      {!inside && valueBlock}
      {semi && (
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums" style={{ width: size - EDGE * 2 }} aria-hidden>
          <span>{format(min)}</span>
          {target != null && <span className="text-foreground">Target {format(target)}</span>}
          <span>{format(max)}</span>
        </div>
      )}
      {caption && <div data-slot="gauge-caption" className="mt-2 text-center text-xs text-muted-foreground tabular-nums">{caption}</div>}
    </div>
  );
}

export { Gauge };
