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
} from "@/components/ui";
import { apiGet, apiGetOptional } from "@/lib/api";
import { compactRupees, decimal, formatDate, money } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { requireSession } from "@/lib/session";
import type { Milestone } from "@/lib/types";

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

export default async function FinancePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/finance");
  const queue = await apiGet<{ items: Milestone[]; count: number; note: string }>("/finance/queue");
  const report = session.department_id
    ? await apiGetOptional<Report>("/departments/" + session.department_id + "/payment-report")
    : null;

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const overdue = queue.items.filter((item) => item.overdue);
  const total = queue.items.reduce((sum, item) => sum + item.amount_paise, 0);

  return (
    <div>
      <PageHeader
        title="Payment queue"
        subtitle={queue.note}
        meta={
          <>
            <Pill>{queue.count} awaiting release</Pill>
            <Pill>{compactRupees(total)} in total</Pill>
            {overdue.length ? <Pill tone="bad">{overdue.length} past the service level</Pill> : null}
          </>
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That release could not be recorded">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {report ? (
        <Section
          title="Your department's payment performance"
          description={"Over the last " + report.window_days + " days. Startups see these figures too."}
        >
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              {
                label: "Service level met",
                value:
                  report.sla_adherence_percent === null
                    ? "Not yet measured"
                    : report.sla_adherence_percent + " percent",
                tone:
                  report.sla_adherence_percent !== null && report.sla_adherence_percent < 80
                    ? "bad"
                    : undefined,
              },
              {
                label: "Days to accept evidence",
                value:
                  report.average_days.officer_acceptance === null
                    ? "Not yet measured"
                    : decimal(report.average_days.officer_acceptance, 1),
              },
              {
                label: "Days to approve payment",
                value:
                  report.average_days.approver_payment_approval === null
                    ? "Not yet measured"
                    : decimal(report.average_days.approver_payment_approval, 1),
              },
              {
                label: "Days to release",
                value:
                  report.average_days.finance_release === null
                    ? "Not yet measured"
                    : decimal(report.average_days.finance_release, 1),
              },
            ].map((item) => (
              <div
                key={item.label}
                className={
                  "rounded border px-3 py-3 " +
                  (item.tone === "bad" ? "border-bad bg-bad-light" : "border-line bg-paper-soft")
                }
              >
                <dd className="num text-2xl font-semibold text-ink">{item.value}</dd>
                <dt className="mt-1 text-sm text-ink-muted">{item.label}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-ink-muted">
            The agreed service levels are {report.service_levels.officer_acceptance_days} days to
            accept, {report.service_levels.approver_payment_days} days to approve and{" "}
            {report.service_levels.finance_release_days} days to release.{" "}
            {report.open_breaches
              ? report.open_breaches + " item(s) are past their service level right now."
              : "Nothing is past its service level right now."}
          </p>
        </Section>
      ) : null}

      <Section
        title="Approved milestones awaiting release"
        description="Sorted by service level deadline. Anything already past its deadline is listed first and has been escalated."
      >
        {queue.items.length ? (
          <div className="space-y-4">
            {queue.items.map((milestone) => (
              <article
                key={milestone.id}
                className={"rounded border " + (milestone.overdue ? "border-bad" : "border-line")}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-soft px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {milestone.startup_name ?? "Startup"} &mdash; milestone {milestone.seq}:{" "}
                      {milestone.title}
                    </p>
                    <p className="num mt-0.5 text-sm text-ink-muted">
                      {milestone.pilot_reference} &middot; {money({ paise: milestone.amount_paise })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {milestone.overdue ? <Pill tone="bad">Past the service level</Pill> : null}
                    {milestone.escalation_level > 0 ? <Pill tone="bad">Escalated</Pill> : null}
                  </div>
                </div>

                <div className="space-y-4 px-4 py-4">
                  <p className="text-sm">
                    <Deadline value={milestone.sla_due_at} label="Release due by" />
                  </p>
                  <p className="text-sm text-ink-soft">
                    Deliverable: {milestone.deliverable}
                  </p>

                  <Disclosure summary="Record the release">
                    <form action={milestoneAction} className="max-w-form space-y-3">
                      <input type="hidden" name="milestone_id" value={milestone.id} />
                      <input type="hidden" name="action" value="record-release" />
                      <input type="hidden" name="back" value="/finance" />
                      <input type="hidden" name="version" value={milestone.version} />
                      <Field label="Payment reference number" name={"ref_" + milestone.id} required>
                        <input
                          id={"ref_" + milestone.id}
                          name="reference_no"
                          required
                          minLength={3}
                          placeholder="Treasury voucher or payment advice reference"
                        />
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
                        <input id={"mode_" + milestone.id} name="mode" defaultValue="Bank transfer" />
                      </Field>
                      <Field label="Remarks" name={"remarks_" + milestone.id}>
                        <input id={"remarks_" + milestone.id} name="remarks" />
                      </Field>
                      <p className="text-sm text-ink-muted">
                        Only one release can be recorded per milestone. The amount must match the
                        approved amount.
                      </p>
                      <SubmitButton pendingLabel="Recording...">Record the release</SubmitButton>
                    </form>
                  </Disclosure>

                  <p className="text-sm">
                    <Link href={"/pilots/" + milestone.pilot_id + "/milestones"}>
                      Open the pilot milestones
                    </Link>
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState message="No milestone is waiting for release. Approved payments appear here as soon as the approver clears them." />
        )}
      </Section>
    </div>
  );
}
