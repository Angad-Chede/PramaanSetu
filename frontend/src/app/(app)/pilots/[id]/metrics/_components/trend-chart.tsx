"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type TrendPoint = { label: string; baseline?: number; pilot?: number };

const config = {
  baseline: { label: "Baseline", color: "var(--glyph)" },
  pilot: { label: "Pilot", color: "var(--brand)" },
} satisfies ChartConfig;

const fmt = (value: number | string) => Number(value).toFixed(2);

export function TrendChart({ data, target, baselineMean, unit }: { data: TrendPoint[]; target: number | null; baselineMean: number | null; unit: string }) {
  const values = data.flatMap((d) => [d.baseline, d.pilot]).filter((v): v is number => typeof v === "number");
  if (target != null) values.push(target);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.15 || 1;

  return (
    <ChartContainer config={config} className="aspect-auto h-[240px] w-full" aria-label={"Weekly mean, " + unit}>
      <AreaChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 0 }} accessibilityLayer>
        <defs>
          {Object.keys(config).map((key) => (
            <linearGradient key={key} id={`metric-fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(--color-${key})`} stopOpacity={0.22} />
              <stop offset="100%" stopColor={`var(--color-${key})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} width={44} tickMargin={6} domain={[Math.floor(lo - pad), Math.ceil(hi + pad)]} tickFormatter={(v) => String(v)} />
        <ChartTooltip cursor={{ strokeDasharray: "3 3" }} animationDuration={200} content={<ChartTooltipContent valueFormatter={fmt} />} />
        {baselineMean != null && (
          <ReferenceLine y={baselineMean} stroke="var(--glyph)" strokeDasharray="4 4" strokeOpacity={0.7} label={{ value: "Baseline mean", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }} />
        )}
        {target != null && (
          <ReferenceLine y={target} stroke="var(--brand)" strokeDasharray="4 4" label={{ value: "Target " + target, position: "insideBottomLeft", fill: "var(--brand)", fontSize: 11 }} />
        )}
        <Area dataKey="baseline" type="monotone" stroke="var(--color-baseline)" strokeWidth={2} fill="url(#metric-fill-baseline)" connectNulls dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        <Area dataKey="pilot" type="monotone" stroke="var(--color-pilot)" strokeWidth={2.25} fill="url(#metric-fill-pilot)" connectNulls dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}
