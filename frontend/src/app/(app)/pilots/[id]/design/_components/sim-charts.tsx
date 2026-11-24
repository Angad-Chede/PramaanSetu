"use client";

import * as React from "react";
import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type SimDesign = {
  key: string;
  label: string;
  weeks: number;
  units: number;
  power: number;
  mde: number;
  costPaise: number;
  withinBudget: boolean;
  color: string;
};

// standard normal cdf, Abramowitz and Stegun 7.1.26
function phi(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function zFor(p: number) {
  // inverse normal by bisection, plenty for a chart
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (phi(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const STEPS = 48;

/** Chance each design detects a true improvement of a given size, from its detectable change. */
export function PowerCurveChart({
  designs,
  alpha,
  targetPower,
  expectedEffect,
  claimedEffect,
  unit,
}: {
  designs: SimDesign[];
  alpha: number;
  targetPower: number;
  expectedEffect: number;
  claimedEffect: number;
  unit: string;
}) {
  const zAlpha = zFor(1 - alpha / 2);
  const zPower = zFor(targetPower);
  const maxMde = Math.max(...designs.map((design) => design.mde), 0.0001);
  const top = Math.max(claimedEffect, maxMde * 1.6) * 1.15;

  const data = React.useMemo(() => {
    return Array.from({ length: STEPS + 1 }, (_, step) => {
      const effect = (top * step) / STEPS;
      const row: Record<string, number> = { effect: Number(effect.toFixed(3)) };
      for (const design of designs) {
        const se = design.mde / (zAlpha + zPower);
        const power = phi(effect / se - zAlpha) + phi(-effect / se - zAlpha);
        row[design.key] = Math.round(power * 1000) / 10;
      }
      return row;
    });
  }, [designs, top, zAlpha, zPower]);

  const config = Object.fromEntries(designs.map((design) => [design.key, { label: design.label, color: design.color }])) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
      <LineChart data={data} margin={{ left: 4, right: 16, top: 24, bottom: 4 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="effect"
          type="number"
          domain={[0, top]}
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          tickCount={6}
          tickFormatter={(value: number) => value.toFixed(1)}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 80, 100]}
          tickLine={false}
          axisLine={false}
          width={46}
          tickMargin={6}
          tickFormatter={(value: number) => value + "%"}
        />
        <ReferenceArea y1={0} y2={targetPower * 100} fill="var(--destructive)" fillOpacity={0.035} />
        <ReferenceLine
          y={targetPower * 100}
          stroke="var(--success)"
          strokeDasharray="4 4"
          label={{ value: Math.round(targetPower * 100) + "% target", position: "insideBottomLeft", fill: "var(--success-ink)", fontSize: 11 }}
        />
        <ReferenceLine
          x={Number(expectedEffect.toFixed(3))}
          stroke="var(--foreground)"
          strokeOpacity={0.5}
          strokeDasharray="2 4"
          label={{ value: "Realistic effect", position: "top", fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        {claimedEffect > expectedEffect * 1.05 && (
          <ReferenceLine
            x={Number(claimedEffect.toFixed(3))}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.4}
            strokeDasharray="2 4"
            label={{ value: "Claimed", position: "top", fill: "var(--muted-foreground)", fontSize: 11 }}
          />
        )}
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          animationDuration={200}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => "True improvement of " + Number(payload?.[0]?.payload?.effect ?? 0).toFixed(2) + " " + unit}
              valueFormatter={(value) => Number(value).toFixed(1) + "% chance to detect"}
            />
          }
        />
        {designs.map((design) => (
          <Line
            key={design.key}
            dataKey={design.key}
            type="monotone"
            stroke={`var(--color-${design.key})`}
            strokeWidth={design.key === "recommended" || design.key === "proposed" ? 2.5 : 1.5}
            strokeDasharray={design.key.startsWith("option") ? "5 4" : undefined}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
            isAnimationActive
            animationDuration={900}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  );
}

const lakh = (paise: number) => paise / 100 / 100000;

/** Every screened design placed by cost and power, against the budget ceiling and the target. */
export function DesignSpaceChart({
  designs,
  budgetPaise,
  targetPower,
}: {
  designs: SimDesign[];
  budgetPaise: number | null;
  targetPower: number;
}) {
  const maxCost = Math.max(...designs.map((design) => lakh(design.costPaise)), budgetPaise ? lakh(budgetPaise) : 0);
  const top = Math.ceil((maxCost * 1.18) / 5) * 5 || 5;
  const config = Object.fromEntries(designs.map((design) => [design.key, { label: design.label, color: design.color }])) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
      <ScatterChart margin={{ left: 4, right: 16, top: 24, bottom: 4 }} accessibilityLayer>
        <CartesianGrid />
        <XAxis
          type="number"
          dataKey="cost"
          name="Expected cost"
          domain={[0, top]}
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          tickFormatter={(value: number) => value + "L"}
        />
        <YAxis
          type="number"
          dataKey="power"
          name="Power"
          domain={[0, 100]}
          ticks={[0, 25, 50, 80, 100]}
          tickLine={false}
          axisLine={false}
          width={46}
          tickMargin={6}
          tickFormatter={(value: number) => value + "%"}
        />
        <ZAxis range={[140, 140]} />
        {budgetPaise ? (
          <ReferenceArea x1={lakh(budgetPaise)} x2={top} fill="var(--destructive)" fillOpacity={0.05} />
        ) : null}
        <ReferenceArea x1={0} x2={budgetPaise ? lakh(budgetPaise) : top} y1={targetPower * 100} y2={100} fill="var(--success)" fillOpacity={0.07} />
        {budgetPaise ? (
          <ReferenceLine
            x={lakh(budgetPaise)}
            stroke="var(--destructive)"
            strokeDasharray="4 4"
            label={{ value: "Budget ceiling", position: "top", fill: "var(--destructive-ink)", fontSize: 11 }}
          />
        ) : null}
        <ReferenceLine y={targetPower * 100} stroke="var(--success)" strokeDasharray="4 4" />
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          animationDuration={200}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (SimDesign & { cost: number }) | undefined;
            if (!active || !point) return null;
            return (
              <div className="grid min-w-44 gap-1 rounded-xl bg-popover px-3 py-2 text-xs shadow-float">
                <span className="font-medium text-foreground">{point.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {point.weeks} weeks, {point.units} units
                </span>
                <span className="tabular-nums">{Math.round(point.power * 100)}% power</span>
                <span className="tabular-nums">INR {point.cost.toFixed(1)} lakh expected</span>
              </div>
            );
          }}
        />
        {designs.map((design) => (
          <Scatter
            key={design.key}
            name={design.label}
            data={[{ ...design, cost: lakh(design.costPaise), power: Math.round(design.power * 1000) / 10 }]}
            fill={`var(--color-${design.key})`}
            stroke="var(--card)"
            strokeWidth={2}
          >
            <LabelList dataKey="label" position="top" offset={10} className="fill-foreground text-[11px]" />
          </Scatter>
        ))}
      </ScatterChart>
    </ChartContainer>
  );
}
