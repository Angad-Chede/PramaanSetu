"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = {
  mean: { label: "Mean across units", color: "var(--chart-1)" },
} satisfies ChartConfig;

export type TrendPoint = { label: string; mean: number; units: number };

export function TrendChart({
  points,
  baseline,
  passMark,
  unit,
}: {
  points: TrendPoint[];
  baseline: number | null;
  passMark: number | null;
  unit: string;
}) {
  const values = points.map((point) => point.mean);
  if (baseline !== null) values.push(baseline);
  if (passMark !== null) values.push(passMark);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.25, 0.5);
  const domain: [number, number] = [Math.floor((low - pad) * 10) / 10, Math.ceil((high + pad) * 10) / 10];

  return (
    <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
      <AreaChart data={points} margin={{ left: 0, right: 20, top: 16, bottom: 0 }} accessibilityLayer>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-mean)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-mean)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={16} padding={{ left: 8, right: 16 }} />
        <YAxis tickLine={false} axisLine={false} width={44} tickMargin={6} domain={domain} tickFormatter={(value: number) => value.toFixed(1)} />
        {baseline !== null && (
          <ReferenceLine
            y={baseline}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{ value: "Baseline " + baseline.toFixed(1), position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }}
          />
        )}
        {passMark !== null && (
          <ReferenceLine
            y={passMark}
            stroke="var(--success)"
            strokeDasharray="4 4"
            label={{ value: "Pass mark " + passMark.toFixed(1), position: "insideBottomRight", fill: "var(--success-ink)", fontSize: 11 }}
          />
        )}
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          animationDuration={200}
          content={<ChartTooltipContent valueFormatter={(value) => Number(value).toFixed(2) + " " + unit} />}
        />
        <Area
          dataKey="mean"
          type="monotone"
          stroke="var(--color-mean)"
          strokeWidth={2}
          fill="url(#trend-fill)"
          dot={{ r: 3, strokeWidth: 2, fill: "var(--card)" }}
          activeDot={{ r: 5, strokeWidth: 2 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
