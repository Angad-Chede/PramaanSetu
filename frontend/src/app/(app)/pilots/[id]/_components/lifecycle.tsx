import Link from "next/link";
import { ArrowUpRight, Check, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type StageStatus = "done" | "current" | "upcoming" | "blocked";

export type Stage = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  status: StageStatus;
  detail: string;
};

const STATUS_TEXT: Record<StageStatus, string> = {
  done: "Done",
  current: "In progress",
  upcoming: "Not started",
  blocked: "Needs attention",
};

/** The pilot's stages as one connected track; every stage is a link to its page. */
export function LifecycleTrack({ stages, active }: { stages: Stage[]; active?: string }) {
  return (
    <nav aria-label="Pilot stages" className="rounded-3xl bg-card p-2 shadow-card">
      <ol className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const isActive = stage.key === active;
          return (
            <li key={stage.key} className="relative">
              <Link
                href={stage.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative flex h-full flex-col gap-3 rounded-[20px] p-3.5 outline-none transition-[background-color,box-shadow,translate] duration-200 ease-ios hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring",
                  isActive && "bg-surface shadow-lift",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "grid size-8 place-items-center rounded-full transition-colors",
                      stage.status === "done" && "bg-success/14 text-success-ink",
                      stage.status === "current" && "bg-brand text-brand-foreground shadow-[0_0_0_4px_color-mix(in_oklab,var(--brand)_16%,transparent)]",
                      stage.status === "upcoming" && "bg-surface text-glyph",
                      stage.status === "blocked" && "bg-warning/16 text-warning-ink",
                    )}
                  >
                    {stage.status === "done" ? <Check className="size-4" strokeWidth={2.5} /> : <Icon className="size-4" />}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">0{index + 1}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                    {stage.label}
                    <ArrowUpRight className="size-3.5 text-glyph opacity-0 transition-[opacity,translate] duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
                  </span>
                  <span className="text-[12px] leading-snug text-muted-foreground">{stage.detail}</span>
                  <span className="sr-only">{STATUS_TEXT[stage.status]}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
