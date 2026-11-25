import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, ArrowUpRight, BadgeIndianRupee, CircleCheckBig, Inbox, Wallet } from "lucide-react";

import { Disclosure } from "@/components/app/forms";
import { EmptyState, Figure, FigureGrid, Flash, Page, PageHeader, Panel, ToneBadge } from "@/components/app/kit";
import { all, apiGet, apiGetOptional } from "@/lib/api";
import { compactRupees, decimal, formatRupees } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Milestone } from "@/lib/types";

import { SlaClock } from "../pilots/[id]/_run/payment";
import { ReleaseForm } from "../pilots/[id]/_run/release-form";

export const metadata: Metadata = { title: "Payment queue" };
export const dynamic = "force-dynamic";

type Report = {
  window_days: number;
  milestones_considered: number;
  average_days: {
    officer_acceptance: number | null;
    approver_payment_approval: number | null;
    finance_release: number | null;
  };
  sla_adherence_percent: number | null;
  paid_milestones: number;
  breaches: number;
  open_breaches: number;
  service_levels: {
    officer_acceptance_days: number;
    approver_payment_days: number;
    finance_release_days: number;
  };
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FinancePage({ searchParams }: Props) {
  const query = await searchParams;
  const sessionRead = requireSession("/finance");
  const [session, queue, report] = await all(
    sessionRead,
    apiGet<{ items: Milestone[]; count: number; note: string }>("/finance/queue"),
    sessionRead.then((s) => (s.department_id ? apiGetOptional<Report>("/departments/" + s.department_id + "/payment-report") : null)),
  );

  const overdue = queue.items.filter((item) => item.overdue);
  const total = queue.items.reduce((sum, item) => sum + item.amount_paise, 0);
  const adherence = report?.sla_adherence_percent ?? null;

  return (
    <Page>
      <PageHeader
        eyebrow="Payment Pulse"
        title="Payment queue"
        description={queue.note}
        meta={
          overdue.length > 0 ? (
            <ToneBadge tone="destructive">
              {overdue.length} past the service level
            </ToneBadge>
          ) : undefined
        }
      />

      <Flash searchParams={query} />

      <FigureGrid className="grid-cols-2 animate-enter [animation-delay:60ms]">
        <Figure label="Awaiting release" value={queue.count} icon={Inbox} tone="brand" hint="Approved by the department approver" />
        <Figure label="Value to release" value={compactRupees(total).replace("INR ", "₹ ")} icon={Wallet} hint={queue.count ? "Across every approved milestone" : "Nothing approved right now"} />
        <Figure
          label="Past the service level"
          value={overdue.length}
          icon={AlarmClock}
          tone={overdue.length ? "destructive" : "success"}
          hint={overdue.length ? "Already escalated. Release these first." : "Every release is inside its clock"}
        />
        <Figure
          label="Service level met"
          value={adherence === null ? "Not yet" : decimal(adherence, 0) + "%"}
          icon={CircleCheckBig}
          tone={adherence === null ? "neutral" : adherence < 80 ? "destructive" : "success"}
          hint={report ? `Last ${report.window_days} days, ${report.paid_milestones} paid` : "No department figures"}
        />
      </FigureGrid>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby="queue-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="queue-heading" className="font-display text-lg font-semibold tracking-tight">
                Approved milestones awaiting release
              </h2>
              <p className="text-[13px] text-muted-foreground">Sorted by service level deadline. Anything past it is listed first and has been escalated.</p>
            </div>
          </div>

          {queue.items.length === 0 ? (
            <EmptyState
              icon={BadgeIndianRupee}
              title="Nothing waiting for release"
              description="Approved payments appear here as soon as the department approver clears them, with the service level clock already running."
            />
          ) : (
            <ol className="flex flex-col gap-4">
              {queue.items.map((milestone, index) => (
                <li key={milestone.id} className="animate-enter" style={{ animationDelay: 100 + index * 50 + "ms" }}>
                  <article className={cn("overflow-hidden rounded-3xl bg-card shadow-card", milestone.overdue && "ring-1 ring-destructive/40")}>
                    <div className="flex flex-col gap-5 p-5 md:p-6">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                            <span className="font-medium text-foreground">{milestone.startup_name ?? "Startup"}</span>
                            <span aria-hidden>·</span>
                            <span className="font-mono text-[12px]">{milestone.pilot_reference}</span>
                          </div>
                          <h3 className="font-display text-[17px] leading-snug font-semibold tracking-tight text-balance">
                            Milestone {milestone.seq}: {milestone.title}
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {milestone.overdue && <ToneBadge tone="destructive">Past the service level</ToneBadge>}
                            {milestone.escalation_level > 0 && <ToneBadge tone="destructive" dot={false}>Escalated</ToneBadge>}
                            {!milestone.overdue && <ToneBadge tone="brand">Ready to release</ToneBadge>}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col sm:items-end">
                          <span className="font-display text-[28px] leading-none font-semibold tracking-tight tabular-nums">
                            <span className="mr-0.5 text-lg text-muted-foreground">₹</span>
                            {formatRupees(milestone.amount_paise).replace(/\.00$/, "")}
                          </span>
                          <span className="mt-1 text-[13px] text-muted-foreground">Approved amount</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-4 rounded-2xl bg-surface/60 p-4 md:flex-row md:items-center md:justify-between">
                        <SlaClock milestone={milestone} />
                        <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground md:text-right">
                          <span className="font-medium text-foreground">Deliverable.</span> {milestone.deliverable}
                        </p>
                      </div>

                      <Disclosure defaultOpen={index === 0} summary="Record the release" className="ring-1 ring-brand/15">
                        <div className="pt-1">
                          <ReleaseForm milestone={milestone} back="/finance" withRemarks />
                        </div>
                      </Disclosure>

                      <Link
                        href={"/pilots/" + milestone.pilot_id + "/milestones"}
                        className="group inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Open the pilot milestones
                        <ArrowUpRight className="size-3.5 transition-transform duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </Link>
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          )}
        </section>

        {report && (
          <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
            <Panel title="Your department's payment speed" description={`Average days at each step over the last ${report.window_days} days. Startups see these figures too.`}>
              <div className="flex flex-col gap-5">
                <SpeedBar label="Accept the evidence" who="Department Officer" actual={report.average_days.officer_acceptance} limit={report.service_levels.officer_acceptance_days} />
                <SpeedBar label="Approve the payment" who="Department Approver" actual={report.average_days.approver_payment_approval} limit={report.service_levels.approver_payment_days} />
                <SpeedBar label="Release the money" who="Finance Officer" actual={report.average_days.finance_release} limit={report.service_levels.finance_release_days} />
              </div>
              <div className="mt-5 flex items-center gap-2 border-t border-border/70 pt-4 text-[12px] text-muted-foreground">
                <span className="inline-block h-3 w-0.5 rounded-full bg-foreground/70" />
                The tick marks the agreed service level
              </div>
            </Panel>
            <div
              className={cn(
                "rounded-3xl p-5 text-sm",
                report.open_breaches ? "bg-destructive/8" : "bg-success/10",
              )}
            >
              <p className="font-medium text-foreground">
                {report.open_breaches
                  ? `${report.open_breaches} item${report.open_breaches === 1 ? " is" : "s are"} past the service level right now`
                  : "Nothing is past its service level right now"}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {report.breaches} breach{report.breaches === 1 ? "" : "es"} across {report.milestones_considered} milestones in this window. The agreed levels are{" "}
                {report.service_levels.officer_acceptance_days} days to accept, {report.service_levels.approver_payment_days} to approve and{" "}
                {report.service_levels.finance_release_days} to release.
              </p>
            </div>
          </aside>
        )}
      </div>
    </Page>
  );
}

function SpeedBar({ label, who, actual, limit }: { label: string; who: string; actual: number | null; limit: number }) {
  const scale = Math.max(limit, actual ?? 0) * 1.25 || 1;
  const over = actual !== null && actual > limit;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-[12px] text-muted-foreground">{who}</span>
        </div>
        <span className={cn("font-display text-lg font-semibold tabular-nums", over ? "text-destructive-ink" : "text-foreground")}>
          {actual === null ? <span className="text-sm font-normal text-muted-foreground">Not measured</span> : decimal(actual, 1)}
          {actual !== null && <span className="ml-1 text-[12px] font-normal text-muted-foreground">of {limit} days</span>}
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-recess">
        {actual !== null && (
          <span
            className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-soft", over ? "bg-destructive" : "bg-success")}
            style={{ width: Math.min(100, (actual / scale) * 100) + "%" }}
          />
        )}
        <span aria-hidden className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground/70" style={{ left: (limit / scale) * 100 + "%" }} />
      </div>
    </div>
  );
}
