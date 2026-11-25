import type { ReactNode } from "react";
import { BadgeCheck, Clock3, EyeOff, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

/** A cobalt panel cut from one of the plates, with a piece of the product floating on it. */
export function StagePanel({ art, position = "50% 60%", children, className }: { art: string; position?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[20px] bg-cobalt p-6 sm:aspect-[16/11] sm:p-12", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art} alt="" aria-hidden loading="lazy" className="absolute inset-0 size-full object-cover opacity-75" style={{ objectPosition: position }} />
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_50%,rgba(12,22,80,0.35),transparent)]" aria-hidden />
      <div className="relative w-full max-w-[440px]">{children}</div>
    </div>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-ui className={cn("rounded-[14px] bg-[#fbfaf7] p-5 text-ink shadow-[0_30px_80px_-24px_rgba(5,10,45,0.65),0_0_0_1px_rgba(21,19,15,0.06)]", className)}>{children}</div>;
}

function Label({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[11px] tracking-wide text-ink/45 uppercase">{children}</p>;
}

export function ChallengeDraft() {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Label>Drafted from Template Kit v3</Label>
        <span className="inline-flex items-center gap-1 text-[11.5px] text-cobalt">
          <Sparkles className="size-3.5" /> Draft
        </span>
      </div>
      <p className="font-serif text-[22px] leading-tight">Reduce water lost before it reaches a meter</p>
      {[
        { name: "Non-revenue water", base: "31.1%", target: "26.0%", primary: true },
        { name: "Complaints resolved in 48 h", base: "62%", target: "80%", primary: false },
      ].map((kpi) => (
        <div key={kpi.name} className="flex items-center justify-between gap-3 rounded-[10px] bg-ink/[0.04] px-3.5 py-3">
          <div>
            <p className="text-[13.5px] font-medium">{kpi.name}</p>
            <p className="font-mono text-[11.5px] text-ink/50">
              baseline {kpi.base} · target {kpi.target}
            </p>
          </div>
          {kpi.primary && <span className="rounded-full bg-vermilion/12 px-2 py-0.5 text-[11px] font-medium text-vermilion">Primary</span>}
        </div>
      ))}
    </Card>
  );
}

export function BlindScores() {
  const rows = [
    { name: "Proposal 07", scores: [8, 9, 7], total: 84 },
    { name: "Proposal 03", scores: [7, 8, 8], total: 79 },
    { name: "Proposal 12", scores: [6, 7, 6], total: 64 },
  ];
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Label>Panel scores · round one</Label>
        <span className="inline-flex items-center gap-1 text-[11.5px] text-ink/50">
          <EyeOff className="size-3.5" /> Names hidden
        </span>
      </div>
      <div className="flex flex-col divide-y divide-ink/8">
        {rows.map((row, index) => (
          <div key={row.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5">
            <span className="text-[14px] font-medium">{row.name}</span>
            <span className="flex gap-1">
              {row.scores.map((score, i) => (
                <span key={i} className="grid size-6 place-items-center rounded-md bg-ink/[0.05] font-mono text-[11px]">
                  {score}
                </span>
              ))}
            </span>
            <span className={cn("w-9 text-right font-serif text-[20px]", index === 0 ? "text-cobalt" : "text-ink/70")}>{row.total}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function PowerCurve() {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Power by sample size · 10,000 runs</Label>
        <span className="font-mono text-[12px] text-vermilion">n = 48</span>
      </div>
      <svg viewBox="0 0 320 140" className="w-full" aria-hidden>
        <line x1="0" y1="40" x2="320" y2="40" stroke="rgba(21,19,15,0.25)" strokeDasharray="3 4" />
        <text x="2" y="33" fontSize="10" fill="rgba(21,19,15,0.5)" fontFamily="var(--font-geist-mono)">80% power</text>
        <path d="M0 132 C 60 126, 100 100, 150 64 S 240 30, 320 22" fill="none" stroke="var(--color-cobalt)" strokeWidth="2.5" />
        <path d="M0 132 C 60 126, 100 100, 150 64 S 240 30, 320 22 L320 140 L0 140 Z" fill="var(--color-cobalt)" opacity="0.07" />
        <circle cx="198" cy="40" r="5" fill="var(--color-vermilion)" />
        <line x1="198" y1="40" x2="198" y2="140" stroke="var(--color-vermilion)" strokeDasharray="2 3" />
      </svg>
      <p className="text-[13px] text-ink/55">Smallest design inside the budget ceiling that reaches 80 percent power.</p>
    </Card>
  );
}

export function ScoreBars({ score }: { score: number }) {
  const parts = [30, 25, 20, 15, 10];
  return (
    <Card className="flex flex-col gap-4">
      <Label>Evidence Confidence Score</Label>
      <div className="flex items-end justify-between">
        <span className="font-serif text-[60px] leading-none tracking-[-0.03em]">{score.toFixed(1)}</span>
        <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-[#e7f3ea] px-2.5 py-1 text-[12px] font-medium text-[#1d6b3a]">
          <BadgeCheck className="size-3.5" /> Strong
        </span>
      </div>
      <div className="flex gap-1.5">
        {parts.map((weight, index) => (
          <span key={index} className="h-2.5 rounded-full bg-cobalt" style={{ flexGrow: weight, opacity: 1 - index * 0.14 }} />
        ))}
      </div>
      <p className="font-mono text-[11.5px] text-ink/50">effect 30 · confidence 25 · data 20 · protocol 15 · validation 10</p>
    </Card>
  );
}

export function PaymentClock() {
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Label>Milestone 2 of 3 · Rs 9.6 lakh</Label>
          <span className="inline-flex items-center gap-1 text-[11.5px] text-ink/50">
            <Clock3 className="size-3.5" /> Finance Officer
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { step: "Accept", days: "7 days", fill: 100 },
            { step: "Approve", days: "5 days", fill: 100 },
            { step: "Release", days: "7 days", fill: 62 },
          ].map((stage) => (
            <div key={stage.step} className="flex flex-col gap-2">
              <span className="h-1.5 overflow-hidden rounded-full bg-ink/8">
                <span className="block h-full rounded-full bg-cobalt" style={{ width: stage.fill + "%" }} />
              </span>
              <span className="text-[13.5px] font-medium">{stage.step}</span>
              <span className="font-mono text-[11px] text-ink/45">{stage.days}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card className="ml-auto flex w-[78%] items-center gap-3 py-3.5">
        <span className="grid size-9 place-items-center rounded-full bg-vermilion text-white">
          <BadgeCheck className="size-4" />
        </span>
        <div>
          <p className="text-[13.5px] font-medium">Innovation Passport issued</p>
          <p className="text-[12px] text-ink/50">Another department can reuse the result</p>
        </div>
      </Card>
    </div>
  );
}
