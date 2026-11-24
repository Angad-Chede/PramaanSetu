import { cn } from "@/lib/utils";
import { decimal } from "@/lib/format";
import type { ScoreComponent } from "@/lib/types";

/** Score band boundaries used everywhere the Evidence Confidence Score is drawn. */
export const ECS_THRESHOLDS = [
  { upTo: 60, tone: "destructive" as const, label: "Weak" },
  { upTo: 80, tone: "warning" as const, label: "Moderate" },
  { upTo: 100, tone: "success" as const, label: "Strong" },
];

const COMPONENT_FILLS = ["bg-brand", "bg-info", "bg-success", "bg-chart-4", "bg-warning", "bg-chart-5"];

/** The score as one bar: each component's points side by side, the gap to 100 left empty. */
export function ScoreComposition({ components, className }: { components: ScoreComponent[]; className?: string }) {
  const max = components.reduce((sum, c) => sum + c.max_points, 0) || 100;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-recess" role="img" aria-label="Score by component">
        {components.map((component, index) => (
          <span
            key={component.code}
            title={`${component.name}: ${decimal(component.points, 1)} of ${component.max_points}`}
            className={cn("h-full first:rounded-l-full", COMPONENT_FILLS[index % COMPONENT_FILLS.length])}
            style={{ width: (component.points / max) * 100 + "%" }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
        {components.map((component, index) => (
          <li key={component.code} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", COMPONENT_FILLS[index % COMPONENT_FILLS.length])} />
            {component.name}
            <span className="font-medium text-foreground tabular-nums">{decimal(component.points, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One row per component: its points against its maximum, with the reason in words. */
export function ComponentBars({ components }: { components: ScoreComponent[] }) {
  return (
    <ol className="flex flex-col gap-5">
      {components.map((component, index) => {
        const ratio = component.max_points ? component.points / component.max_points : 0;
        const tone = ratio >= 0.8 ? "text-success-ink" : ratio >= 0.4 ? "text-warning-ink" : "text-destructive-ink";
        return (
          <li key={component.code} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <span
              className={cn(
                "row-span-2 mt-0.5 grid size-7 place-items-center rounded-lg font-mono text-[12px] font-semibold text-white",
                COMPONENT_FILLS[index % COMPONENT_FILLS.length],
              )}
              aria-hidden
            >
              {component.code}
            </span>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-foreground">{component.name}</span>
              <span className="shrink-0 text-sm tabular-nums">
                <span className={cn("font-display font-semibold", tone)}>{decimal(component.points, 1)}</span>
                <span className="text-muted-foreground"> / {component.max_points}</span>
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-recess">
                <div
                  className={cn("h-full rounded-full", COMPONENT_FILLS[index % COMPONENT_FILLS.length])}
                  style={{ width: Math.max(2, ratio * 100) + "%" }}
                />
              </div>
              <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{component.explanation}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function niceDomain(values: number[]) {
  const finite = values.filter((v) => Number.isFinite(v));
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  return { lo: lo - pad, hi: hi + pad };
}

/**
 * A forest plot for one effect: the 95 percent interval as a bar, the estimate as a dot,
 * no change as a dashed line, and the pre-registered target if there was one.
 */
export function ForestPlot({
  effect,
  low,
  high,
  target,
  direction = "lower",
  unit,
  compact = false,
  className,
}: {
  effect: number;
  low: number;
  high: number;
  target?: number | null;
  direction?: "lower" | "higher" | string;
  unit?: string;
  compact?: boolean;
  className?: string;
}) {
  const { lo, hi } = niceDomain([low, high, effect, 0, ...(target != null && !compact ? [target] : [])]);
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const excludesZero = (low > 0 && high > 0) || (low < 0 && high < 0);
  const beneficial = direction === "higher" ? effect > 0 : effect < 0;
  const good = excludesZero && beneficial;
  const bar = good ? "bg-success" : excludesZero ? "bg-destructive" : "bg-warning";
  const dot = good ? "bg-success-ink" : excludesZero ? "bg-destructive" : "bg-warning-ink";

  return (
    <div className={cn("relative w-full", compact ? "h-6" : "h-24", className)}>
      {!compact && (
        <div className="absolute inset-x-0 top-0 flex justify-between text-[11px] font-medium text-muted-foreground">
          <span>{direction === "higher" ? "Worse" : "Better"}</span>
          <span>{direction === "higher" ? "Better" : "Worse"}</span>
        </div>
      )}
      {!compact && (
        <span
          className="absolute top-4 -translate-x-1/2 text-[12px] font-semibold whitespace-nowrap text-foreground tabular-nums"
          style={{ left: Math.min(90, Math.max(10, at(effect))) + "%" }}
        >
          {decimal(effect, 2)}
          {unit ? <span className="sr-only"> {unit}</span> : null}
        </span>
      )}
      <div className={cn("absolute inset-x-0", compact ? "top-1/2 -translate-y-1/2" : "top-9")}>
        <div className="relative h-6">
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          <span aria-hidden className="absolute -inset-y-1 border-l border-dashed border-foreground/40" style={{ left: at(0) + "%" }} />
          {target != null && !compact && (
            <span aria-hidden className="absolute -inset-y-2 flex -translate-x-1/2 flex-col items-center" style={{ left: at(target) + "%" }}>
              <span className="h-full border-l-2 border-brand" />
            </span>
          )}
          <span
            className={cn("absolute top-1/2 h-2 -translate-y-1/2 rounded-full opacity-80", bar)}
            style={{ left: at(low) + "%", width: Math.max(0.8, at(high) - at(low)) + "%" }}
          />
          <span
            className={cn("absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-card", dot)}
            style={{ left: at(effect) + "%" }}
          />
        </div>
      </div>
      {!compact && (
        <div className="absolute inset-x-0 bottom-0 h-8 text-[11px] text-muted-foreground tabular-nums">
          <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: at(0) + "%" }}>
            No change
          </span>
          {target != null && (
            <span className="absolute top-3.5 -translate-x-1/2 font-medium whitespace-nowrap text-brand-ink" style={{ left: at(target) + "%" }}>
              Target {decimal(target, 1)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
