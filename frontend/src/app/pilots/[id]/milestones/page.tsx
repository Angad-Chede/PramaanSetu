import type { Metadata } from "next";
import Link from "next/link";

import { milestoneAction } from "@/app/pilots/actions";
import { Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  Deadline,
  EmptyState,
  Field,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  StatusPill,
} from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { ROLE_LABELS, formatDate, money } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Milestone, Pilot } from "@/lib/types";

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

export default async function MilestonesPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/pilots/" + params.id + "/milestones");
  const pilot = await apiGetOrNotFound<Pilot>("/pilots/" + params.id);
  const body = await apiGet<{
    items: Milestone[];
    total_value: { paise: number; display: string };
    paid_value: { paise: number; display: string };
    outstanding_value: { paise: number; display: string };
    note: string;
  }>("/pilots/" + params.id + "/milestones");

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const back = "/pilots/" + params.id + "/milestones";

  const isStartup = session.startup_id === pilot.startup_id;
  const isOfficer = hasRole(session, "DO") && session.department_id === pilot.department_id;
  const isApprover = hasRole(session, "DA") && session.department_id === pilot.department_id;
  const isFinance = hasRole(session, "FO") && session.department_id === pilot.department_id;

  const breaches = body.items.filter((m) => m.escalation_level > 0 && m.state !== "Paid");

  return (
    <div>
      <PageHeader
        title="Milestones and payments"
        subtitle={body.note}
        meta={
          <>
            <Pill>{pilot.reference}</Pill>
            <Pill>Total {money(body.total_value)}</Pill>
            <Pill tone="good">Paid {money(body.paid_value)}</Pill>
            <Pill>Outstanding {money(body.outstanding_value)}</Pill>
          </>
        }
        actions={<Link href={"/pilots/" + pilot.id} className="btn btn-secondary">Back to the pilot</Link>}
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That action did not complete">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {breaches.length ? (
        <div className="mb-5">
          <Callout tone="bad" title={breaches.length + " milestone(s) past their service level"}>
            <ul className="space-y-1">
              {breaches.map((milestone) => (
                <li key={milestone.id}>
                  Milestone {milestone.seq}: {milestone.title} is with the{" "}
                  {ROLE_LABELS[milestone.held_by_role ?? ""] ?? "department"} and has been escalated.
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : null}

      <Section
        title="Every milestone"
        description="Each state carries a service level. The holder and the days remaining are shown, so nobody has to ask where a payment is."
      >
        {body.items.length ? (
          <div className="space-y-5">
            {body.items.map((milestone) => (
              <article
                key={milestone.id}
                className={
                  "rounded border " + (milestone.overdue ? "border-bad" : "border-line")
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-soft px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {milestone.seq}. {milestone.title}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      Due {formatDate(milestone.due_date)}, worth{" "}
                      <span className="num">{money({ paise: milestone.amount_paise })}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill state={milestone.state} label={milestone.state_label} />
                    {milestone.held_by_role ? (
                      <Pill>With the {ROLE_LABELS[milestone.held_by_role] ?? milestone.held_by_role}</Pill>
                    ) : null}
                    {milestone.escalation_level > 0 ? <Pill tone="bad">Escalated</Pill> : null}
                    {milestone.resubmission_count > 0 ? (
                      <Pill tone="warn">Resubmitted {milestone.resubmission_count} time(s)</Pill>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-4 px-4 py-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-muted">Deliverable</p>
                      <p className="mt-0.5 text-sm text-ink-soft">{milestone.deliverable}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-muted">Evidence required</p>
                      <p className="mt-0.5 text-sm text-ink-soft">{milestone.evidence_required}</p>
                    </div>
                  </div>

                  {milestone.sla_due_at ? (
                    <p className="text-sm">
                      <Deadline value={milestone.sla_due_at} label="Service level expires" />
                    </p>
                  ) : null}

                  {milestone.submission_note ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-muted">What was submitted</p>
                      <p className="mt-0.5 whitespace-pre-line text-sm text-ink-soft">
                        {milestone.submission_note}
                      </p>
                    </div>
                  ) : null}

                  {milestone.unmet_requirement ? (
                    <Callout tone="bad" title="Returned by the department">
                      <p>Requirement not met: {milestone.unmet_requirement}</p>
                      {milestone.rejection_reason ? <p className="mt-1">{milestone.rejection_reason}</p> : null}
                    </Callout>
                  ) : null}

                  {milestone.release ? (
                    <Callout tone="good" title="Payment released">
                      Reference {milestone.release.reference_no}, {money(milestone.release.amount)},
                      released {formatDate(milestone.release.released_on)} by{" "}
                      {milestone.release.mode.toLowerCase()}.
                    </Callout>
                  ) : null}

                  <div className="flex flex-wrap gap-3 no-print">
                    {isStartup && ["Pending", "Rejected"].includes(milestone.state) ? (
                      <Disclosure
                        summary={milestone.state === "Rejected" ? "Resubmit the evidence" : "Submit the evidence"}
                      >
                        <form action={milestoneAction} className="max-w-form space-y-3">
                          <input type="hidden" name="milestone_id" value={milestone.id} />
                          <input type="hidden" name="action" value="submit" />
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="version" value={milestone.version} />
                          <Field
                            label="What you are submitting"
                            name={"note_" + milestone.id}
                            required
                            help={"Describe the evidence against the requirement: " + milestone.evidence_required}
                          >
                            <textarea id={"note_" + milestone.id} name="note" rows={4} required minLength={10} />
                          </Field>
                          <SubmitButton pendingLabel="Submitting...">Submit the evidence</SubmitButton>
                        </form>
                      </Disclosure>
                    ) : null}

                    {isOfficer && milestone.state === "Submitted" ? (
                      <>
                        <form action={milestoneAction}>
                          <input type="hidden" name="milestone_id" value={milestone.id} />
                          <input type="hidden" name="action" value="accept" />
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="version" value={milestone.version} />
                          <SubmitButton pendingLabel="Accepting...">Accept the evidence</SubmitButton>
                        </form>
                        <Disclosure summary="Reject and return it">
                          <form action={milestoneAction} className="max-w-form space-y-3">
                            <input type="hidden" name="milestone_id" value={milestone.id} />
                            <input type="hidden" name="action" value="reject" />
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="version" value={milestone.version} />
                            <Field
                              label="Which evidence requirement was not met"
                              name={"unmet_" + milestone.id}
                              required
                              help="Quote the part of the requirement that is missing. A rejection cannot be recorded without it."
                            >
                              <input
                                id={"unmet_" + milestone.id}
                                name="unmet_requirement"
                                required
                                minLength={5}
                              />
                            </Field>
                            <Field label="Explain the decision" name={"reason_" + milestone.id} required>
                              <textarea
                                id={"reason_" + milestone.id}
                                name="reason"
                                rows={3}
                                required
                                minLength={10}
                              />
                            </Field>
                            <p className="text-sm text-ink-muted">
                              The service level clock stops only for the time the startup takes to
                              resubmit.
                            </p>
                            <SubmitButton variant="danger">Return to the startup</SubmitButton>
                          </form>
                        </Disclosure>
                      </>
                    ) : null}

                    {isApprover && milestone.state === "Accepted" ? (
                      <form action={milestoneAction}>
                        <input type="hidden" name="milestone_id" value={milestone.id} />
                        <input type="hidden" name="action" value="approve-payment" />
                        <input type="hidden" name="back" value={back} />
                        <input type="hidden" name="version" value={milestone.version} />
                        <SubmitButton
                          pendingLabel="Approving..."
                          confirm={
                            "Approve payment of " +
                            money({ paise: milestone.amount_paise }) +
                            " for this milestone?"
                          }
                        >
                          Approve the payment
                        </SubmitButton>
                      </form>
                    ) : null}

                    {isFinance && milestone.state === "PaymentApproved" ? (
                      <Disclosure summary="Record the release">
                        <form action={milestoneAction} className="max-w-form space-y-3">
                          <input type="hidden" name="milestone_id" value={milestone.id} />
                          <input type="hidden" name="action" value="record-release" />
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="version" value={milestone.version} />
                          <Field label="Payment reference number" name={"ref_" + milestone.id} required>
                            <input id={"ref_" + milestone.id} name="reference_no" required minLength={3} />
                          </Field>
                          <Field label="Amount in rupees" name={"amount_" + milestone.id} required>
                            <input
                              id={"amount_" + milestone.id}
                              name="amount_rupees"
                              type="number"
                              step="0.01"
                              defaultValue={milestone.amount_paise / 100}
                              required
                            />
                          </Field>
                          <Field label="Date of release" name={"released_" + milestone.id}>
                            <input id={"released_" + milestone.id} name="released_on" type="date" />
                          </Field>
                          <Field label="Mode" name={"mode_" + milestone.id}>
                            <input
                              id={"mode_" + milestone.id}
                              name="mode"
                              defaultValue="Bank transfer"
                            />
                          </Field>
                          <p className="text-sm text-ink-muted">
                            Only one release can be recorded per milestone. The startup is notified
                            with the reference.
                          </p>
                          <SubmitButton>Record the release</SubmitButton>
                        </form>
                      </Disclosure>
                    ) : null}
                  </div>

                  {milestone.state_history.length ? (
                    <Disclosure summary="History and service level timings">
                      <ol className="space-y-1">
                        {milestone.state_history.map((entry, index) => (
                          <li key={index}>
                            {HISTORY_LABELS[entry.state] ?? entry.state} on {formatDate(entry.at)}
                            {entry.sla_due_at ? (
                              <span className="text-ink-muted">
                                {" "}
                                (service level to {formatDate(entry.sla_due_at)})
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </Disclosure>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState message="No milestones have been set. They are created when the agreement is drafted." />
        )}
      </Section>
    </div>
  );
}
