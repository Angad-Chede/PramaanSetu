import type { Metadata } from "next";
import { BadgeIndianRupee, CircleAlert, FileCheck2, History, Receipt, Repeat2 } from "lucide-react";

import { milestoneAction } from "@/app/pilots/actions";
import { Disclosure, SubmitButton, TextAreaField, TextField } from "@/components/app/forms";
import { Callout, EmptyState, Flash, KeyValues, Page, PageHeader, Panel, StateBadge, ToneBadge } from "@/components/app/kit";
import { all, apiGet, apiGetOrNotFound } from "@/lib/api";
import { ROLE_LABELS, formatDate, formatRupees, money } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Milestone, Pilot } from "@/lib/types";

import { PaymentRail, SlaClock, holderLabel, milestoneTone, stageIndex } from "../_run/payment";
import { ReleaseForm } from "../_run/release-form";

export const metadata: Metadata = { title: "Milestones and payments" };
export const dynamic = "force-dynamic";

const HISTORY_LABELS: Record<string, string> = {
  Pending: "Created",
  Submitted: "Evidence submitted",
  Accepted: "Accepted by the officer",
  Rejected: "Returned to the startup",
  PaymentApproved: "Payment approved",
  Paid: "Release recorded",
};

type Money = { paise: number; display: string };
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MilestonesPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [session, pilot, body] = await all(
    requireSession("/pilots/" + id + "/milestones"),
    apiGetOrNotFound<Pilot>("/pilots/" + id),
    apiGet<{
      items: Milestone[];
      total_value: Money;
      paid_value: Money;
      outstanding_value: Money;
      note: string;
    }>("/pilots/" + id + "/milestones"),
  );

  const back = "/pilots/" + id + "/milestones";
  const isStartup = session.startup_id === pilot.startup_id;
  const isOfficer = hasRole(session, "DO") && session.department_id === pilot.department_id;
  const isApprover = hasRole(session, "DA") && session.department_id === pilot.department_id;
  const isFinance = hasRole(session, "FO") && session.department_id === pilot.department_id;

  const breaches = body.items.filter((m) => m.escalation_level > 0 && m.state !== "Paid");
  const total = body.total_value.paise || 1;
  const sumWhere = (states: string[]) => body.items.filter((m) => states.includes(m.state)).reduce((sum, m) => sum + m.amount_paise, 0);
  const segments = [
    { key: "paid", label: "Paid", paise: sumWhere(["Paid"]), className: "bg-success" },
    { key: "release", label: "Approved, awaiting release", paise: sumWhere(["PaymentApproved"]), className: "bg-brand" },
    { key: "review", label: "With the department", paise: sumWhere(["Submitted", "Accepted"]), className: "bg-info" },
    { key: "open", label: "Not yet submitted", paise: sumWhere(["Pending", "Rejected"]), className: "bg-recess" },
  ];
  const paidCount = body.items.filter((m) => m.state === "Paid").length;

  return (
    <Page>
      <PageHeader
        back={{ href: "/pilots/" + pilot.id, label: "Pilot " + pilot.reference }}
        eyebrow={
          <>
            <span>Payment Pulse</span>
            {pilot.startup_name && <span className="text-muted-foreground/70">· {pilot.startup_name}</span>}
          </>
        }
        title="Milestones and payments"
        description={body.note}
      />

      <Flash searchParams={query} />

      <Panel className="animate-enter [animation-delay:60ms]">
        <div className="flex flex-col gap-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-muted-foreground">Agreement value</span>
              <span className="font-display text-3xl font-semibold tracking-tight tabular-nums">
                <span className="mr-1 text-lg text-muted-foreground">₹</span>
                {formatRupees(body.total_value.paise).replace(/\.00$/, "")}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {body.items.length} milestone{body.items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-muted-foreground">Paid to the startup</span>
              <span className="font-display text-3xl font-semibold tracking-tight text-success-ink tabular-nums">
                <span className="mr-1 text-lg opacity-70">₹</span>
                {formatRupees(body.paid_value.paise).replace(/\.00$/, "")}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {paidCount} of {body.items.length} released
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-muted-foreground">Outstanding</span>
              <span className="font-display text-3xl font-semibold tracking-tight tabular-nums">
                <span className="mr-1 text-lg text-muted-foreground">₹</span>
                {formatRupees(body.outstanding_value.paise).replace(/\.00$/, "")}
              </span>
              <span className="text-[13px] text-muted-foreground">{Math.round((body.outstanding_value.paise / total) * 100)} percent of the agreement</span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-recess" role="img" aria-label="Agreement value by payment state">
              {segments
                .filter((segment) => segment.paise > 0)
                .map((segment) => (
                  <span key={segment.key} className={cn("h-full first:rounded-l-full last:rounded-r-full", segment.className)} style={{ width: (segment.paise / total) * 100 + "%" }} />
                ))}
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground">
              {segments.filter((segment) => segment.paise > 0).map((segment) => (
                <li key={segment.key} className="inline-flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", segment.className, segment.key === "open" && "ring-1 ring-border")} />
                  {segment.label}
                  <span className="font-medium text-foreground tabular-nums">{money({ paise: segment.paise })}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      {breaches.length > 0 && (
        <Callout tone="destructive" title={`${breaches.length} milestone${breaches.length === 1 ? " is" : "s are"} past the service level`}>
          <ul className="flex flex-col gap-1">
            {breaches.map((milestone) => (
              <li key={milestone.id}>
                Milestone {milestone.seq}, {milestone.title}, is with {holderLabel(milestone.held_by_role)} and has been escalated.
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {body.items.length === 0 ? (
        <EmptyState icon={BadgeIndianRupee} title="No milestones yet" description="Milestones are created when the agreement is drafted. Each one carries its own payment and service level." />
      ) : (
        <ol className="flex flex-col gap-4">
          {body.items.map((milestone, index) => (
            <li key={milestone.id} className="animate-enter" style={{ animationDelay: 100 + index * 50 + "ms" }}>
              <MilestoneCard
                milestone={milestone}
                back={back}
                isStartup={isStartup}
                isOfficer={isOfficer}
                isApprover={isApprover}
                isFinance={isFinance}
              />
            </li>
          ))}
        </ol>
      )}
    </Page>
  );
}

function MilestoneCard({
  milestone,
  back,
  isStartup,
  isOfficer,
  isApprover,
  isFinance,
}: {
  milestone: Milestone;
  back: string;
  isStartup: boolean;
  isOfficer: boolean;
  isApprover: boolean;
  isFinance: boolean;
}) {
  const paid = milestone.state === "Paid";
  const hidden = (
    <>
      <input type="hidden" name="milestone_id" value={milestone.id} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="version" value={milestone.version} />
    </>
  );
  const canSubmit = isStartup && ["Pending", "Rejected"].includes(milestone.state);
  const canReview = isOfficer && milestone.state === "Submitted";
  const canApprove = isApprover && milestone.state === "Accepted";
  const canRelease = isFinance && milestone.state === "PaymentApproved";
  const hasAction = canSubmit || canReview || canApprove || canRelease;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-3xl bg-card shadow-card",
        milestone.overdue && !paid && "ring-1 ring-destructive/40",
        hasAction && !milestone.overdue && "ring-1 ring-brand/30",
      )}
    >
      <div className="flex flex-col gap-5 p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 gap-4">
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-2xl font-display text-[15px] font-semibold tabular-nums",
                paid ? "bg-success/12 text-success-ink" : "bg-surface text-foreground shadow-lift",
              )}
            >
              {milestone.seq}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 className="font-display text-[17px] leading-snug font-semibold tracking-tight text-balance">{milestone.title}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge state={milestone.state} labels={{ [milestone.state]: milestone.state_label }} tone={milestoneTone(milestone.state, milestone.overdue)} />
                {milestone.held_by_role && !paid && <ToneBadge dot={false}>With the {ROLE_LABELS[milestone.held_by_role] ?? milestone.held_by_role}</ToneBadge>}
                {milestone.escalation_level > 0 && !paid && <ToneBadge tone="destructive">Escalated</ToneBadge>}
                {milestone.resubmission_count > 0 && (
                  <ToneBadge tone="warning" dot={false}>
                    <Repeat2 />
                    Resubmitted {milestone.resubmission_count}×
                  </ToneBadge>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col md:items-end">
            <span className="font-display text-2xl font-semibold tracking-tight tabular-nums">
              <span className="mr-0.5 text-base text-muted-foreground">₹</span>
              {formatRupees(milestone.amount_paise).replace(/\.00$/, "")}
            </span>
            <span className="text-[13px] text-muted-foreground">Due {formatDate(milestone.due_date)}</span>
          </div>
        </div>

        <div className="grid items-center gap-5 rounded-2xl bg-surface/60 p-4 md:grid-cols-[1fr_auto] md:gap-8 md:px-5">
          <PaymentRail milestone={milestone} />
          {!paid && milestone.sla_due_at && (
            <SlaClock milestone={milestone} className="border-t border-border/70 pt-4 md:min-w-64 md:border-t-0 md:border-l md:pt-0 md:pl-6" />
          )}
          {paid && milestone.release && (
            <div className="flex items-center gap-3 border-t border-border/70 pt-4 md:min-w-64 md:border-t-0 md:border-l md:pt-0 md:pl-6">
              <span className="grid size-10 place-items-center rounded-full bg-success/12 text-success-ink">
                <Receipt className="size-4" />
              </span>
              <div className="flex flex-col">
                <span className="text-[13px] font-medium">Released {formatDate(milestone.release.released_on)}</span>
                <span className="text-[13px] text-muted-foreground">
                  Ref <span className="font-mono text-[12px]">{milestone.release.reference_no}</span>
                </span>
              </div>
            </div>
          )}
        </div>

        {!paid && (
        <KeyValues
          items={[
            { label: "Deliverable", value: milestone.deliverable },
            { label: "Evidence required", value: milestone.evidence_required },
            ...(milestone.submission_note ? [{ label: "What was submitted", value: <span className="whitespace-pre-line">{milestone.submission_note}</span>, wide: true }] : []),
          ]}
        />
        )}

        {milestone.unmet_requirement && (
          <Callout tone="warning" title="Returned by the department" icon={CircleAlert}>
            <p>Requirement not met: {milestone.unmet_requirement}</p>
            {milestone.rejection_reason && <p className="mt-1">{milestone.rejection_reason}</p>}
          </Callout>
        )}

        {milestone.release && (
          <div className="grid gap-4 rounded-2xl border border-dashed border-success/40 bg-success/[0.06] p-4 sm:grid-cols-4">
            {[
              { label: "Reference", value: <span className="font-mono text-[13px]">{milestone.release.reference_no}</span> },
              { label: "Amount", value: <span className="tabular-nums">{money(milestone.release.amount)}</span> },
              { label: "Released on", value: formatDate(milestone.release.released_on) },
              { label: "Mode", value: milestone.release.mode },
            ].map((item) => (
              <div key={item.label} className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium tracking-wide text-success-ink uppercase">{item.label}</span>
                <span className="text-sm font-medium">{item.value}</span>
              </div>
            ))}
            {milestone.release.remarks && <p className="text-[13px] text-muted-foreground sm:col-span-4">{milestone.release.remarks}</p>}
          </div>
        )}

        {hasAction && (
          <div className="flex flex-col gap-3 rounded-2xl bg-brand/[0.05] p-4 ring-1 ring-brand/15">
            <p className="text-[13px] font-medium text-brand-ink">Waiting on you</p>

            {canSubmit && (
              <form action={milestoneAction} className="flex flex-col gap-4">
                {hidden}
                <input type="hidden" name="action" value="submit" />
                <TextAreaField
                  id={"note_" + milestone.id}
                  label={milestone.state === "Rejected" ? "Resubmit the evidence" : "What you are submitting"}
                  name="note"
                  rows={4}
                  required
                  minLength={10}
                  hint={"Describe the evidence against the requirement: " + milestone.evidence_required}
                />
                <div>
                  <SubmitButton variant="brand" pendingLabel="Submitting">
                    <FileCheck2 />
                    Submit the evidence
                  </SubmitButton>
                </div>
              </form>
            )}

            {canReview && (
              <div className="flex flex-col gap-3">
                <form action={milestoneAction} className="flex flex-wrap items-center gap-3">
                  {hidden}
                  <input type="hidden" name="action" value="accept" />
                  <SubmitButton
                    variant="brand"
                    pendingLabel="Accepting"
                    confirmTitle="Accept this evidence?"
                    confirm="The milestone moves to the approver for payment approval, and their service level clock starts."
                  >
                    Accept the evidence
                  </SubmitButton>
                  <span className="text-[13px] text-muted-foreground">or return it below with the requirement that was not met.</span>
                </form>
                <Disclosure summary="Reject and return it to the startup" className="bg-card">
                  <form action={milestoneAction} className="flex flex-col gap-4 pt-1">
                    {hidden}
                    <input type="hidden" name="action" value="reject" />
                    <TextField
                      id={"unmet_" + milestone.id}
                      label="Which evidence requirement was not met"
                      name="unmet_requirement"
                      required
                      minLength={5}
                      hint="Quote the part of the requirement that is missing. A rejection cannot be recorded without it."
                    />
                    <TextAreaField id={"reason_" + milestone.id} label="Explain the decision" name="reason" rows={3} required minLength={10} />
                    <p className="text-[13px] text-muted-foreground">The service level clock stops only for the time the startup takes to resubmit.</p>
                    <div>
                      <SubmitButton variant="destructive" confirmTitle="Return this milestone?" confirm="The startup is notified with your reason and can resubmit.">
                        Return to the startup
                      </SubmitButton>
                    </div>
                  </form>
                </Disclosure>
              </div>
            )}

            {canApprove && (
              <form action={milestoneAction} className="flex flex-wrap items-center gap-3">
                {hidden}
                <input type="hidden" name="action" value="approve-payment" />
                <SubmitButton
                  variant="brand"
                  pendingLabel="Approving"
                  confirmTitle="Approve this payment?"
                  confirm={"Approve payment of " + money({ paise: milestone.amount_paise }) + " for this milestone? It moves to the finance office for release."}
                  confirmLabel="Approve the payment"
                >
                  Approve the payment
                </SubmitButton>
                <span className="text-[13px] tabular-nums text-muted-foreground">{money({ paise: milestone.amount_paise })}</span>
              </form>
            )}

            {canRelease && <ReleaseForm milestone={milestone} back={back} />}
          </div>
        )}

        {milestone.state_history.length > 0 && (
          <Disclosure
            summary={
              <span className="inline-flex items-center gap-2">
                <History className="size-4 text-glyph" />
                {paid ? "Deliverable, evidence and history" : "History and service level timings"}
              </span>
            }
          >
            {paid && (
              <KeyValues
                className="mb-5"
                items={[
                  { label: "Deliverable", value: milestone.deliverable },
                  { label: "Evidence required", value: milestone.evidence_required },
                  ...(milestone.submission_note ? [{ label: "What was submitted", value: <span className="whitespace-pre-line">{milestone.submission_note}</span>, wide: true }] : []),
                ]}
              />
            )}
            <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
              {milestone.state_history.map((entry, index) => {
                const last = index === milestone.state_history.length - 1;
                return (
                  <li key={index} className="relative">
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-surface",
                        entry.state === "Rejected" ? "bg-warning" : last && stageIndex(entry.state) < 4 ? "bg-brand" : "bg-success",
                      )}
                    />
                    <p className="text-sm font-medium text-foreground">{HISTORY_LABELS[entry.state] ?? entry.state}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {formatDate(entry.at)}
                      {entry.sla_due_at && <> · service level to {formatDate(entry.sla_due_at)}</>}
                    </p>
                  </li>
                );
              })}
            </ol>
          </Disclosure>
        )}
      </div>
    </article>
  );
}
