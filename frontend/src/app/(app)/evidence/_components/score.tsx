import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { Gauge } from "@/components/ui/gauge";
import { ToneBadge, bandToneOf, type Tone } from "@/components/app/kit";
import { formatDate } from "@/lib/format";

/** The Evidence Confidence Score on a gauge, with who signed it off. */
export function ScoreCard({
  score,
  band,
  validator,
  validatedOn,
  className,
}: {
  score: number;
  band: string;
  validator: string;
  validatedOn: string;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col items-center gap-4 rounded-3xl bg-card p-6 shadow-card", className)}>
      <div className="flex w-full items-center justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold tracking-tight">Evidence Confidence Score</h2>
        <ToneBadge tone={bandToneOf(band)}>{band}</ToneBadge>
      </div>
      <Gauge
        value={Math.round(score * 10) / 10}
        decimals={1}
        max={100}
        size={208}
        thickness={14}
        label="of 100"
        thresholds={[
          { upTo: 60, tone: "destructive", label: "Weak" },
          { upTo: 80, tone: "warning", label: "Moderate" },
          { upTo: 100, tone: "success", label: "Strong" },
        ]}
      />
      <div className="flex w-full items-start gap-3 rounded-2xl bg-surface px-4 py-3 text-[13px]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
        <p className="leading-relaxed text-muted-foreground">
          Signed off by <span className="font-medium text-foreground">{validator}</span>, an independent validator, on {formatDate(validatedOn)}.
        </p>
      </div>
    </section>
  );
}

const RING_COLOR: Record<Tone, string> = {
  neutral: "var(--glyph)",
  brand: "var(--brand)",
  info: "var(--info)",
  success: "var(--success)",
  warning: "var(--warning)",
  destructive: "var(--destructive)",
};

/** A compact score ring for cards and rows. */
export function ScoreRing({ score, band, size = 52 }: { score: number; band: string; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`Evidence Confidence Score ${score.toFixed(0)} of 100, ${band}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--recess)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={RING_COLOR[bandToneOf(band)]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <span className="absolute font-display text-[15px] font-semibold tracking-tight tabular-nums">{score.toFixed(0)}</span>
    </span>
  );
}
