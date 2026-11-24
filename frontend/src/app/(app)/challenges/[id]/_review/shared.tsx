import Link from "next/link";
import type { ReactNode } from "react";
import { ClipboardCheck, ListOrdered, UsersRound } from "lucide-react";

import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "screening", label: "Applications", icon: ClipboardCheck },
  { key: "panel", label: "Panel", icon: UsersRound },
  { key: "ranking", label: "Scores and shortlist", icon: ListOrdered },
] as const;

export type ReviewStep = (typeof STEPS)[number]["key"];

/** The three review screens of a challenge, as one strip so officers can move between them. */
export function ReviewNav({ challengeId, active }: { challengeId: string; active: ReviewStep }) {
  return (
    <nav aria-label="Review stages" className="-mx-1 overflow-x-auto px-1 pb-1 scrollbar-none">
      <ol className="inline-flex min-w-max items-center gap-1 rounded-full bg-surface p-1">
        {STEPS.map((step, index) => {
          const current = step.key === active;
          return (
            <li key={step.key}>
              <Link
                href={`/challenges/${challengeId}/${step.key}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-ios outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  current ? "bg-card text-foreground shadow-lift" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-[11px] tabular-nums",
                    current ? "bg-brand text-brand-foreground" : "bg-recess text-glyph",
                  )}
                >
                  {index + 1}
                </span>
                {step.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const TINTS = [
  "bg-brand/14 text-brand-ink",
  "bg-info/14 text-info-ink",
  "bg-success/14 text-success-ink",
  "bg-warning/16 text-warning-ink",
  "bg-chart-4/14 text-chart-4-ink",
];

function hash(text: string) {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) >>> 0;
  return value;
}

export function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold tracking-tight",
        TINTS[hash(name) % TINTS.length],
        className,
      )}
    >
      {initials(name) || "?"}
    </span>
  );
}

/** A stacked bar that splits a whole into tinted parts, with a legend underneath. */
export function SplitBar({
  parts,
  className,
  label,
}: {
  parts: { label: string; value: number; className: string; dot: string }[];
  className?: string;
  label: string;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div role="img" aria-label={label} className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-recess">
        {total > 0 &&
          parts
            .filter((part) => part.value > 0)
            .map((part) => (
              <span
                key={part.label}
                className={cn("h-full transition-[width] duration-700 ease-out-soft first:rounded-l-full last:rounded-r-full", part.className)}
                style={{ width: (part.value / total) * 100 + "%" }}
              />
            ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
        {parts.map((part) => (
          <li key={part.label} className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className={cn("size-2 rounded-full", part.dot)} />
            {part.label}
            <span className="font-medium text-foreground tabular-nums">{part.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Two columns on wide screens: the work on the left, status and actions in a sticky aside. */
export function Split({ main, aside, className }: { main: ReactNode; aside: ReactNode; className?: string }) {
  return (
    <div className={cn("grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]", className)}>
      <div className="flex min-w-0 flex-col gap-6">{main}</div>
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20">{aside}</aside>
    </div>
  );
}
