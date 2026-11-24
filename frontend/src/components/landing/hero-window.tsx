"use client";

import * as React from "react";
import { Check, FileLock2, FlaskConical, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

const STEP_MS = 3200;
const EASE = [0.22, 1, 0.36, 1] as const;

export type HeroPassport = {
  reference: string;
  department: string;
  measure: string;
  unit: string;
  baseline: number;
  pilot: number;
  relative: number;
  ciLow: number;
  ciHigh: number;
  score: number;
  band: string;
};

const COMPONENTS = [
  { key: "E", label: "Effect attainment", max: 30 },
  { key: "C", label: "Statistical confidence", max: 25 },
  { key: "D", label: "Data quality", max: 20 },
  { key: "P", label: "Protocol adherence", max: 15 },
  { key: "V", label: "Independent validation", max: 10 },
];

const STEPS = [
  { icon: FileLock2, label: "Dataset hash locked", detail: "SHA-256 recorded at design freeze" },
  { icon: FlaskConical, label: "Pre-registered analysis run", detail: "Paired comparison, same units before and after" },
  { icon: ShieldCheck, label: "Validator signed off", detail: "Signed by the Independent Validator" },
];

function Ring({ score }: { score: number }) {
  const radius = 52;
  const length = Math.PI * 2 * radius;
  return (
    <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
      <circle cx="60" cy="60" r={radius} fill="none" className="stroke-recess" strokeWidth="9" />
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        className="stroke-brand"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - score / 100)}
      />
    </svg>
  );
}

export function HeroWindow({ passport }: { passport: HeroPassport }) {
  const reduced = useReducedMotion();
  const [step, setStep] = React.useState(STEPS.length - 1);
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (reduced || paused) return;
    setStep(0);
    const timer = window.setInterval(() => setStep((value) => (value + 1) % STEPS.length), STEP_MS);
    return () => window.clearInterval(timer);
  }, [reduced, paused]);

  const max = Math.max(passport.baseline, passport.pilot) * 1.15;

  return (
    <div
      data-ui className="relative flex h-full flex-col overflow-hidden rounded-[28px] bg-card lg:min-h-0 shadow-[0_0_0_1px_var(--border),0_30px_80px_-20px_rgba(0,0,0,0.25)]"
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-recess" />
          <span className="size-2.5 rounded-full bg-recess" />
          <span className="size-2.5 rounded-full bg-recess" />
        </span>
        <span className="ml-2 hidden min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground sm:block">pramaansetu / evidence / {passport.reference}</span>
        {!reduced && (
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            className="-my-1 ml-auto shrink-0 rounded-full px-2 outline-none focus-visible:ring-2 focus-visible:ring-brand py-1 text-[11px] text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            {paused ? "Play" : "Pause"}
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-5 lg:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-muted-foreground">Evidence report</p>
            <p className="mt-1 font-display text-lg leading-snug font-medium tracking-tight text-balance">{passport.measure} in {passport.department.replace(/ Water Supply Department$/, "")}</p>
          </div>
          <span className="shrink-0 rounded-full bg-success/12 px-2.5 py-1 text-[12px] font-medium text-success-ink">{passport.band} evidence</span>
        </div>

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-2xl bg-surface/70 p-4 sm:gap-5">
          <div className="relative size-[88px] sm:size-[104px]">
            <Ring score={passport.score} />
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="font-display text-[28px] leading-none font-medium tracking-tight tabular-nums">{passport.score.toFixed(1)}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">of 100</div>
              </div>
            </div>
          </div>
          <ul className="flex flex-col gap-1.5">
            {COMPONENTS.map((component) => (
              <li key={component.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-[12px]">
                <span className="truncate text-muted-foreground">{component.label}</span>
                <span className="tabular-nums text-foreground">{component.max}</span>
                <span className="col-span-2 h-1 overflow-hidden rounded-full bg-recess">
                  <span className="block h-full rounded-full bg-foreground/70" style={{ width: (component.max / 30) * 100 + "%" }} />
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="hidden grid-cols-2 gap-3 sm:grid">
          {[
            { label: "Before the pilot", value: passport.baseline, tone: "bg-glyph/40" },
            { label: "During the pilot", value: passport.pilot, tone: "bg-brand" },
          ].map((bar) => (
            <div key={bar.label} className="flex flex-col justify-end gap-2 rounded-2xl bg-surface/70 p-4">
              <span className="text-[12px] text-muted-foreground">{bar.label}</span>
              <span className="font-display text-xl font-medium tracking-tight tabular-nums">{bar.value.toFixed(1)}%</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-recess">
                <span className={cn("block h-full rounded-full", bar.tone)} style={{ width: (bar.value / max) * 100 + "%" }} />
              </span>
            </div>
          ))}
        </div>
        <p className="hidden text-[12px] leading-relaxed text-muted-foreground sm:block">
          {Math.abs(passport.relative).toFixed(1)}% lower {passport.unit}, 95% interval {passport.ciLow.toFixed(1)} to {passport.ciHigh.toFixed(1)} points.
        </p>

        <ol className="mt-auto hidden flex-col gap-2 sm:flex" aria-label="How this result was produced">
          {STEPS.map((item, index) => {
            const done = index <= step;
            const current = index === step;
            return (
              <li
                key={item.label}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-500",
                  current ? "bg-surface" : "bg-transparent",
                )}
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-500",
                    done ? "bg-foreground text-background" : "bg-recess text-glyph",
                  )}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {done && !current ? (
                      <motion.span key="done" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, ease: EASE }}>
                        <Check className="size-3.5" />
                      </motion.span>
                    ) : (
                      <motion.span key="icon" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, ease: EASE }}>
                        <item.icon className="size-3.5" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-[13px] font-medium transition-colors duration-500", done ? "text-foreground" : "text-muted-foreground")}>{item.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{item.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
