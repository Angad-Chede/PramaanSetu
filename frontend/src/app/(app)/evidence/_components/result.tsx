import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { ToneBadge } from "@/components/app/kit";
import { decimal, signed } from "@/lib/format";

type Summary = Record<string, unknown>;

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Whether the measured change moved in the direction the challenge asked for. */
export function improved(result: Summary): boolean | null {
  const effect = num(result.effect);
  if (effect === null) return null;
  return result.direction === "higher" ? effect > 0 : effect < 0;
}

/**
 * The headline of a passport: where the measure started, where it ended, and the
 * range the true change most likely lies in, drawn on a number line around zero.
 */
export function ResultVisual({ result, className }: { result: Summary; className?: string }) {
  const baseline = num(result.baseline_mean);
  const pilot = num(result.pilot_mean);
  const effect = num(result.effect);
  const low = num(result.ci_low);
  const high = num(result.ci_high);
  const relative = num(result.relative_effect_percent);
  const unit = String(result.unit ?? "");
  const better = improved(result);

  if (!result.measure || effect === null) {
    return (
      <div className={cn("flex items-center gap-3 rounded-2xl bg-surface px-4 py-6 text-sm text-muted-foreground", className)}>
        <CircleAlert className="size-4 text-glyph" />
        The measured result has not been recorded on this passport.
      </div>
    );
  }

  const peak = Math.max(Math.abs(baseline ?? 0), Math.abs(pilot ?? 0), 1e-9);
  const Trend = effect === 0 ? ArrowRight : effect < 0 ? ArrowDownRight : ArrowUpRight;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-medium text-muted-foreground">{String(result.measure)}</p>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <span
            className={cn(
              "font-display text-5xl leading-none font-semibold tracking-tight tabular-nums md:text-6xl",
              better ? "text-success-ink" : better === false ? "text-destructive-ink" : "text-foreground",
            )}
          >
            {signed(effect, 2)}
          </span>
          <span className="pb-1 text-[15px] text-muted-foreground">{unit}</span>
          {relative !== null && (
            <ToneBadge tone={better ? "success" : "destructive"} dot={false} className="mb-1.5">
              <Trend />
              {signed(relative, 1)}%
            </ToneBadge>
          )}
        </div>
      </div>

      {baseline !== null && pilot !== null && (
        <div className="flex flex-col gap-3">
          {[
            { label: "Baseline", value: baseline, fill: "bg-glyph/35" },
            { label: "During the pilot", value: pilot, fill: better ? "bg-success" : "bg-brand" },
          ].map((row) => (
            <div key={row.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px]">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-recess">
                <span className={cn("block h-full rounded-full", row.fill)} style={{ width: (Math.abs(row.value) / peak) * 100 + "%" }} />
              </span>
              <span className="text-right font-medium text-foreground tabular-nums">{decimal(row.value, 2)}</span>
            </div>
          ))}
        </div>
      )}

      {low !== null && high !== null && <IntervalPlot effect={effect} low={low} high={high} better={better} />}
    </div>
  );
}

/** The 95 percent interval on a number line with zero marked, so "no change" is visible. */
export function IntervalPlot({ effect, low, high, better }: { effect: number; low: number; high: number; better: boolean | null }) {
  const lo = Math.min(low, 0);
  const hi = Math.max(high, 0);
  const pad = (hi - lo || 1) * 0.18;
  const min = lo - pad;
  const max = hi + pad;
  const at = (value: number) => ((value - min) / (max - min)) * 100;
  const excludesZero = low > 0 || high < 0;

  return (
    <figure className="flex flex-col gap-2" aria-label={`95 percent interval from ${decimal(low, 2)} to ${decimal(high, 2)}, estimate ${decimal(effect, 2)}`}>
      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span className="font-medium tracking-wide uppercase">95 percent interval</span>
        <span className={cn("inline-flex items-center gap-1", excludesZero ? "text-success-ink" : "text-warning-ink")}>
          {excludesZero ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />}
          {excludesZero ? "Clear of zero" : "Includes no change"}
        </span>
      </div>
      <div className="relative h-14 rounded-2xl bg-surface">
        <span className="absolute inset-x-4 top-1/2 h-px -translate-y-1/2 bg-border" />
        <div className="absolute inset-x-4 inset-y-0">
          <span className="absolute inset-y-2.5 w-px bg-foreground/35" style={{ left: at(0) + "%" }} />
          <span
            className={cn("absolute top-1/2 h-3 -translate-y-1/2 rounded-full", better ? "bg-success/30" : "bg-brand/30")}
            style={{ left: at(low) + "%", width: at(high) - at(low) + "%" }}
          />
          <span
            className={cn(
              "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-card",
              better ? "bg-success" : "bg-brand",
            )}
            style={{ left: at(effect) + "%" }}
          />
        </div>
      </div>
      <div className="relative mx-4 h-4 text-[12px] text-muted-foreground tabular-nums">
        {[
          { value: low, label: decimal(low, 2) },
          { value: 0, label: "0" },
          { value: high, label: decimal(high, 2) },
        ].map((tick) => (
          <span key={tick.label + tick.value} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: at(tick.value) + "%" }}>
            {tick.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Context facts as label and value pairs, long text spanning the row. */
export function contextItems(context: Record<string, unknown>) {
  return Object.entries(context)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => {
      const text = String(value);
      return {
        label: key.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()),
        value: <span className={cn(typeof value === "number" && "tabular-nums")}>{text}</span>,
        wide: text.length > 60,
      };
    });
}
