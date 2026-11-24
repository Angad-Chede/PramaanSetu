import { ArrowDownRight, ArrowUpRight, Star } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/app/kit";
import type { Criterion, Kpi } from "@/lib/types";

function fmt(value: number) {
  return Number.isInteger(value) ? value.toLocaleString("en-IN") : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Baseline to target, drawn as a track so the size of the promised change is visible. */
function Shift({ kpi }: { kpi: Kpi }) {
  const { baseline_value: base, target_value: target } = kpi;
  if (base === null || target === null) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {base === null ? "Baseline to be measured before the pilot" : "Target not set"}
      </p>
    );
  }
  const change = base === 0 ? null : ((target - base) / Math.abs(base)) * 100;
  const max = Math.max(base, target) || 1;
  const better = kpi.direction === "lower" ? target < base : target > base;
  const Arrow = target < base ? ArrowDownRight : ArrowUpRight;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 font-display tabular-nums">
        <span className="text-lg font-semibold tracking-tight text-muted-foreground">{fmt(base)}</span>
        <span className="text-muted-foreground">to</span>
        <span className="text-lg font-semibold tracking-tight text-foreground">{fmt(target)}</span>
        {change !== null && (
          <span
            className={cn(
              "ml-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-sans text-[11px] font-semibold",
              better ? "bg-success/12 text-success-ink" : "bg-warning/14 text-warning-ink",
            )}
          >
            <Arrow className="size-3" />
            {Math.abs(change).toFixed(0)}%
          </span>
        )}
      </div>
      <div className="relative h-1.5 w-full rounded-full bg-recess" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-full bg-glyph/35" style={{ width: (base / max) * 100 + "%" }} />
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", better ? "bg-brand" : "bg-warning")}
          style={{ width: (target / max) * 100 + "%" }}
        />
      </div>
    </div>
  );
}

export function MeasuresList({ kpis }: { kpis: Kpi[] }) {
  if (!kpis.length) return <EmptyState title="No measures yet" description="A challenge needs at least one measure before it can be submitted." />;
  const ordered = [...kpis].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  return (
    <ul className="grid gap-3">
      {ordered.map((kpi) => (
        <li
          key={kpi.id || kpi.name}
          className={cn(
            "grid gap-4 rounded-2xl p-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:p-5",
            kpi.is_primary ? "bg-brand/[0.06] ring-1 ring-brand/20" : "bg-surface/70",
          )}
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{kpi.name}</h3>
              {kpi.is_primary && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-brand-foreground">
                  <Star className="size-3 fill-current" />
                  Primary
                </span>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground">
              {kpi.unit} · {kpi.direction_label || (kpi.direction === "lower" ? "Lower is better" : "Higher is better")}
              {kpi.baseline_sd !== null && <> · varies by {fmt(kpi.baseline_sd)}</>}
            </p>
            {kpi.baseline_method && <p className="mt-1 text-[13px] leading-relaxed text-pretty text-foreground/80">{kpi.baseline_method}</p>}
            {kpi.baseline_source && <p className="text-[12px] text-muted-foreground">Source: {kpi.baseline_source}</p>}
          </div>
          <div className="flex flex-col justify-center gap-1 md:border-l md:border-border/70 md:pl-5">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Baseline to target</span>
            <Shift kpi={kpi} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const WEIGHT_TONES = ["bg-brand", "bg-info", "bg-success", "bg-chart-4", "bg-warning", "bg-glyph"];

export function RubricView({ criteria }: { criteria: Criterion[] }) {
  if (!criteria.length) return <EmptyState title="No rubric yet" description="Criteria and weights are published with the challenge." />;
  const total = criteria.reduce((sum, criterion) => sum + (criterion.weight || 0), 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Weights total ${total} of 100`}>
        {criteria.map((criterion, index) => (
          <div
            key={criterion.id || criterion.name}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", WEIGHT_TONES[index % WEIGHT_TONES.length])}
            style={{ width: (criterion.weight / Math.max(total, 100)) * 100 + "%" }}
          />
        ))}
      </div>
      <ul className="divide-y divide-border/70">
        {criteria.map((criterion, index) => (
          <li key={criterion.id || criterion.name} className="flex gap-4 py-3.5 first:pt-0 last:pb-0">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", WEIGHT_TONES[index % WEIGHT_TONES.length])} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-foreground">{criterion.name}</p>
                <span className="font-display text-sm font-semibold tabular-nums text-foreground">{criterion.weight}%</span>
              </div>
              <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{criterion.description}</p>
              {(criterion.anchors?.["1"] || criterion.anchors?.["5"]) && (
                <div className="mt-2 grid gap-2 text-[12px] sm:grid-cols-2">
                  {criterion.anchors?.["1"] && (
                    <p className="rounded-xl bg-surface/80 px-3 py-2 text-muted-foreground">
                      <span className="font-semibold text-foreground">1 </span>
                      {criterion.anchors["1"]}
                    </p>
                  )}
                  {criterion.anchors?.["5"] && (
                    <p className="rounded-xl bg-surface/80 px-3 py-2 text-muted-foreground">
                      <span className="font-semibold text-foreground">5 </span>
                      {criterion.anchors["5"]}
                    </p>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
