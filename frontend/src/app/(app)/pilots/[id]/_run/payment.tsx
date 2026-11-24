import { Check, CornerDownLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import { ROLE_LABELS, formatDate } from "@/lib/format";
import type { Milestone } from "@/lib/types";

/** The five states a milestone payment moves through, and who holds each one. */
export const PAYMENT_STAGES = [
  { state: "Pending", label: "Startup submits", short: "Submit" },
  { state: "Submitted", label: "Officer accepts", short: "Accept" },
  { state: "Accepted", label: "Approver approves", short: "Approve" },
  { state: "PaymentApproved", label: "Finance releases", short: "Release" },
  { state: "Paid", label: "Paid", short: "Paid" },
] as const;

export function stageIndex(state: string): number {
  if (state === "Rejected") return 0;
  const index = PAYMENT_STAGES.findIndex((stage) => stage.state === state);
  return index < 0 ? 0 : index;
}

/** Milestone states read differently from challenge states: accepted is not yet paid. */
export function milestoneTone(state: string, overdue: boolean): "neutral" | "info" | "brand" | "success" | "warning" | "destructive" {
  if (state === "Paid") return "success";
  if (overdue) return "destructive";
  if (state === "Rejected") return "warning";
  if (state === "PaymentApproved") return "brand";
  if (state === "Submitted" || state === "Accepted") return "info";
  return "neutral";
}

export function holderLabel(role: string | null | undefined): string {
  if (!role) return "the department";
  if (role === "SU") return "the startup";
  return "the " + (ROLE_LABELS[role] ?? role);
}

/** A horizontal rail: done stages tick, the current one pulses in the holder's colour. */
export function PaymentRail({ milestone, className }: { milestone: Pick<Milestone, "state" | "overdue">; className?: string }) {
  const current = stageIndex(milestone.state);
  const paid = milestone.state === "Paid";
  const returned = milestone.state === "Rejected";
  const tone = milestone.overdue ? "destructive" : returned ? "warning" : "brand";
  const live = {
    brand: "bg-brand text-brand-foreground ring-brand/25",
    warning: "bg-warning text-white ring-warning/25",
    destructive: "bg-destructive text-white ring-destructive/25",
  }[tone];
  const pulse = { brand: "bg-brand", warning: "bg-warning", destructive: "bg-destructive" }[tone];

  return (
    <ol aria-label="Payment progress" className={cn("grid grid-cols-5", className)}>
      {PAYMENT_STAGES.map((stage, index) => {
        const done = paid ? true : index < current;
        const active = !paid && index === current;
        return (
          <li key={stage.state} className="relative flex flex-col items-center gap-2 text-center" aria-current={active ? "step" : undefined}>
            {index > 0 && (
              <span aria-hidden className="absolute top-3 right-1/2 h-0.5 w-full -translate-y-1/2 rounded-full bg-recess">
                <span
                  className={cn(
                    "block h-full rounded-full transition-[width] duration-700 ease-out-soft",
                    done || active ? "w-full" : "w-0",
                    done ? "bg-success" : active ? (tone === "destructive" ? "bg-destructive/60" : tone === "warning" ? "bg-warning/60" : "bg-brand/60") : "",
                  )}
                />
              </span>
            )}
            <span className="relative z-10 grid size-6 place-items-center">
              {active && <span aria-hidden className={cn("absolute inset-0 animate-ping rounded-full opacity-40 motion-reduce:animate-none", pulse)} />}
              <span
                className={cn(
                  "relative grid size-6 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
                  done && "bg-success text-white",
                  active && cn("ring-4", live),
                  !done && !active && "bg-card text-muted-foreground ring-1 ring-border",
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : active && returned ? <CornerDownLeft className="size-3" strokeWidth={2.5} /> : index + 1}
              </span>
            </span>
            <span
              className={cn(
                "px-0.5 text-[11px] leading-tight text-balance sm:text-xs",
                active ? "font-medium text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/70",
              )}
            >
              <span className="sm:hidden">{stage.short}</span>
              <span className="hidden sm:inline">{stage.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function slaWindow(milestone: Pick<Milestone, "state" | "state_history" | "sla_due_at">) {
  if (!milestone.sla_due_at) return null;
  const due = new Date(milestone.sla_due_at).getTime();
  const entered = [...(milestone.state_history ?? [])].reverse().find((entry) => entry.state === milestone.state);
  const start = entered ? new Date(entered.at).getTime() : due - 7 * 86400000;
  return { start, due, span: Math.max(due - start, 86400000) };
}

/**
 * The service level clock: a ring that drains as the deadline nears and turns red when
 * it passes. The days left are always written next to it, so colour never carries it alone.
 */
export function SlaClock({
  milestone,
  size = 64,
  className,
}: {
  milestone: Pick<Milestone, "state" | "state_history" | "sla_due_at" | "days_remaining" | "overdue" | "held_by_role" | "escalation_level">;
  size?: number;
  className?: string;
}) {
  const window = slaWindow(milestone);
  if (!window) return null;
  const now = Date.now();
  const days = milestone.days_remaining ?? (window.due - now) / 86400000;
  const overdue = milestone.overdue || days < 0;
  const remaining = Math.max(0, Math.min(1, (window.due - now) / window.span));
  const tone = overdue ? "destructive" : remaining < 0.25 ? "warning" : "success";
  const stroke = { success: "var(--success)", warning: "var(--warning)", destructive: "var(--destructive)" }[tone];
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const shown = Math.abs(Math.round(days));

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={6} className="stroke-recess" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={6}
            strokeLinecap="round"
            stroke={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={overdue ? 0 : circumference * (1 - remaining)}
            className="transition-[stroke-dashoffset] duration-1000 ease-out-soft"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center">
          <span className="flex flex-col items-center leading-none">
            <span className={cn("font-display text-lg font-semibold tabular-nums", overdue ? "text-destructive-ink" : "text-foreground")}>
              {overdue ? "+" : ""}
              {shown}
            </span>
            <span className="mt-0.5 text-[9px] font-medium tracking-wide text-muted-foreground uppercase">{shown === 1 ? "day" : "days"}</span>
          </span>
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-foreground">With {holderLabel(milestone.held_by_role)}</span>
        <span className={cn("text-[13px] leading-snug", overdue ? "font-medium text-destructive-ink" : "text-muted-foreground")}>
          {overdue
            ? `${shown} ${shown === 1 ? "day" : "days"} past the service level`
            : shown === 0
              ? "Service level ends today"
              : `${shown} ${shown === 1 ? "day" : "days"} left, until ${formatDate(milestone.sla_due_at)}`}
        </span>
        {milestone.escalation_level > 0 && <span className="text-[12px] font-medium text-destructive-ink">Escalated to the next level</span>}
      </div>
    </div>
  );
}
