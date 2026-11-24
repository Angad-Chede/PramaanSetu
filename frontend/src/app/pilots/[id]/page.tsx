import type { Metadata } from "next";
import Link from "next/link";

import { pilotTransition } from "@/app/pilots/actions";
import { Disclosure, SubmitButton } from "@/components/forms";
import {
  ButtonLink,
  Callout,
  DataTable,
  Field,
  Hash,
  KeyValue,
  Meter,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  StatusPill,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import {
  ANALYSIS_METHOD_LABELS,
  PILOT_STATE_LABELS,
  decimal,
  formatDate,
  money,
  percent,
} from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Pilot } from "@/lib/types";

export const metadata: Metadata = { title: "Pilot" };
export const dynamic = "force-dynamic";

type Dashboard = {
  primary_kpi: {
    name: string;
    unit: string;
    direction: string;
    baseline_mean: number | null;
    target_value: number | null;
  } | null;
  plan: {
    duration_weeks: number;
    units: number;
    measurements_per_week: number;
    pass_mark: number;
    planned_unit_periods: number;
    frozen_at: string | null;
  } | null;
  periods_completed: number;
  periods_planned: number;
  measurements_received: number;
  completeness_percent: number;
  trend: { period_start: string; mean: number; units: number }[];
  next_milestone: {
    id: string;
    seq: number;
    title: string;
    due_date: string;
    amount_paise: number;
    state: string;
  } | null;
};

export default async function PilotPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/pilots/" + params.id);
  const pilot = await apiGetOrNotFound<Pilot>("/pilots/" + params.id);
  const dashboard = await apiGetOptional<Dashboard>("/pilots/" + params.id + "/dashboard");

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const isDepartment = session.department_id === pilot.department_id;
  const isStartup = session.startup_id === pilot.startup_id;
  const actions = pilot.available_actions ?? [];

  return (
    <div>
      <PageHeader
        title={pilot.challenge_title ?? "Pilot"}
        subtitle={"Run by " + (pilot.startup_name ?? "the startup") + ". Every measurement is compared against a plan frozen before any data was collected."}
        meta={
          <>
            <Pill>{pilot.reference}</Pill>
            <StatusPill state={pilot.state} label={PILOT_STATE_LABELS[pilot.state] ?? pilot.state} />
            {pilot.design ? (
              pilot.design.frozen ? (
                <Pill tone="good">Plan pre-registered</Pill>
              ) : (
                <Pill tone="warn">Plan not frozen</Pill>
              )
            ) : (
              <Pill tone="warn">No plan yet</Pill>
            )}
          </>
        }
        actions={
          <>
            <ButtonLink href={"/pilots/" + pilot.id + "/milestones"}>Milestones and payments</ButtonLink>
            <ButtonLink href={"/pilots/" + pilot.id + "/metrics"}>Measurements</ButtonLink>
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
          <Callout tone="bad" title="That action did not complete">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {pilot.state === "Paused" ? (
        <div className="mb-5">
          <Callout tone="warn" title="This pilot is paused">
            {pilot.pause_reason ?? "No reason was recorded."}
          </Callout>
        </div>
      ) : null}
      {pilot.state === "Terminated" ? (
        <div className="mb-5">
          <Callout tone="bad" title="This pilot was terminated">
            {pilot.termination_reason ?? "No reason was recorded."}
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {dashboard && dashboard.plan ? (
            <Section
              title="Progress against the pre-registered plan"
              description="The plan was frozen before data collection started, so the success bar cannot move after the results are seen."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <Meter
                  label="Measurement periods completed"
                  value={dashboard.periods_completed}
                  max={dashboard.periods_planned || 1}
                  tone={dashboard.periods_completed >= dashboard.periods_planned ? "good" : "neutral"}
                />
                <Meter
                  label="Measurements received"
                  value={dashboard.measurements_received}
                  max={dashboard.plan.planned_unit_periods || 1}
                  tone={
                    dashboard.completeness_percent >= 90
                      ? "good"
                      : dashboard.completeness_percent >= 70
                        ? "warn"
                        : "bad"
                  }
                />
              </div>

              <p className="mt-4 text-sm text-ink-soft">
                Data completeness is{" "}
                <span className="num font-semibold">{dashboard.completeness_percent} percent</span>{" "}
                of the plan. Completeness below 90 percent costs points in the Evidence Confidence
                Score and is stated as a limitation on the report.
              </p>

              {dashboard.primary_kpi && dashboard.trend.length ? (
                <div className="mt-5">
                  <h3 className="mb-2">
                    {dashboard.primary_kpi.name} by period ({dashboard.primary_kpi.unit})
                  </h3>
                  <DataTable columns={["Period starting", "Mean across units", "Units reporting", "Against baseline"]}>
                    {dashboard.trend.map((point) => {
                      const baseline = dashboard.primary_kpi?.baseline_mean ?? null;
                      const change = baseline !== null ? point.mean - baseline : null;
                      const better =
                        change !== null &&
                        (dashboard.primary_kpi?.direction === "lower" ? change < 0 : change > 0);
                      return (
                        <tr key={point.period_start}>
                          <td className="whitespace-nowrap text-sm">{formatDate(point.period_start)}</td>
                          <td className="num">{decimal(point.mean, 2)}</td>
                          <td className="num text-sm">{point.units}</td>
                          <td className="num text-sm">
                            {change === null ? (
                              <span className="text-ink-muted">No baseline</span>
                            ) : (
                              <span className={better ? "text-good" : "text-ink"}>
                                {change > 0 ? "+" : ""}
                                {decimal(change, 2)} {better ? "(better)" : ""}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </DataTable>
                  <p className="mt-2 text-sm text-ink-muted">
                    This is a running view, not a result. The Evidence Report runs the analysis that
                    was pre-registered, on the locked dataset, once the pilot is complete.
                  </p>
                </div>
              ) : null}
            </Section>
          ) : null}

          <Section
            title="The pre-registered plan"
            description="Frozen before data collection. Any change after that is an amendment, and every amendment costs protocol adherence points."
            actions={<ButtonLink href={"/pilots/" + pilot.id + "/design"}>Open the simulator</ButtonLink>}
          >
            {pilot.design ? (
              <>
                <KeyValue
                  rows={[
                    { label: "Primary measure", value: pilot.design.primary_kpi_name || "Not recorded" },
                    {
                      label: "Pass mark",
                      value: decimal(pilot.design.pass_mark, 2) + " " + pilot.design.unit,
                    },
                    { label: "Duration", value: pilot.design.duration_weeks + " weeks" },
                    { label: "Units", value: pilot.design.units },
                    {
                      label: "Measurement frequency",
                      value: pilot.design.measurements_per_week + " per week",
                    },
                    {
                      label: "Analysis method",
                      value:
                        ANALYSIS_METHOD_LABELS[pilot.design.analysis_method] ??
                        pilot.design.analysis_method,
                    },
                    {
                      label: "Expected power at freeze",
                      value:
                        pilot.design.expected_power === null
                          ? "Not recorded"
                          : percent(pilot.design.expected_power),
                    },
                    {
                      label: "Smallest detectable change",
                      value:
                        pilot.design.minimum_detectable_effect === null
                          ? "Not recorded"
                          : decimal(pilot.design.minimum_detectable_effect, 2) + " " + pilot.design.unit,
                    },
                    { label: "Frozen", value: <Timestamp value={pilot.design.frozen_at} /> },
                  ]}
                />

                {pilot.design.amendments.length ? (
                  <div className="mt-4">
                    <Callout tone="warn" title="Amendments to the frozen plan">
                      <ul className="space-y-2">
                        {pilot.design.amendments.map((amendment, index) => (
                          <li key={index}>
                            {amendment.description}{" "}
                            <span className="text-ink-muted">
                              ({amendment.approved ? "approved" : "not approved"}, {formatDate(amendment.at)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Callout>
                  </div>
                ) : null}
              </>
            ) : (
              <Callout tone="warn" title="No plan has been frozen">
                A pilot without a pre-registered plan cannot produce defensible evidence. Run the
                Pilot Flight Simulator and freeze a design before the pilot starts.
              </Callout>
            )}
          </Section>

          <Section
            title="The agreement"
            description="Every version is kept and diffable. Acceptance is recorded with the user, the timestamp and the hash of the exact document accepted."
            actions={<ButtonLink href={"/pilots/" + pilot.id + "/agreement"}>Open the agreement</ButtonLink>}
          >
            {pilot.agreement ? (
              <KeyValue
                rows={[
                  { label: "Version", value: pilot.agreement.number },
                  {
                    label: "Intellectual property",
                    value: pilot.agreement.ip_option ?? "Not recorded",
                  },
                  { label: "Approved", value: <Timestamp value={pilot.agreement.approved_at ?? null} /> },
                  { label: "Accepted", value: <Timestamp value={pilot.agreement.accepted_at ?? null} /> },
                  {
                    label: "Signature reference",
                    value: pilot.agreement.esign_reference ?? "Not signed yet",
                  },
                  {
                    label: "Document hash",
                    value: <Hash value={pilot.agreement.sha256 ?? null} />,
                  },
                ]}
              />
            ) : (
              <Callout tone="warn" title="No agreement has been drafted">
                The officer drafts the agreement from the Template Kit, the approver approves it, and
                the startup accepts it. The pilot cannot start until then.
              </Callout>
            )}
          </Section>
        </div>

        <div>
          <Section title="The record">
            <KeyValue
              rows={[
                { label: "Reference", value: <span className="num">{pilot.reference}</span> },
                { label: "State", value: PILOT_STATE_LABELS[pilot.state] ?? pilot.state },
                { label: "Startup", value: pilot.startup_name ?? "Not recorded" },
                { label: "Total value", value: pilot.total_value ? money(pilot.total_value) : "Not set" },
                { label: "Started", value: <Timestamp value={pilot.started_at} /> },
                { label: "Ended", value: <Timestamp value={pilot.ended_at} /> },
                {
                  label: "Cybersecurity checklist",
                  value: pilot.cyber_completed_at ? (
                    <Pill tone="good">Complete</Pill>
                  ) : (
                    <Pill tone="warn">Not complete</Pill>
                  ),
                },
              ]}
            />
          </Section>

          {dashboard?.next_milestone ? (
            <Section title="Next milestone">
              <p className="font-medium text-ink">
                {dashboard.next_milestone.seq}. {dashboard.next_milestone.title}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                Due {formatDate(dashboard.next_milestone.due_date)}, worth{" "}
                {money({ paise: dashboard.next_milestone.amount_paise })}
              </p>
              <p className="mt-3">
                <Link href={"/pilots/" + pilot.id + "/milestones"}>Open milestones</Link>
              </p>
            </Section>
          ) : null}

          <Section title="Related pages">
            <ul className="space-y-2 text-sm">
              <li>
                <Link href={"/pilots/" + pilot.id + "/design"}>Simulator and pre-registered plan</Link>
              </li>
              <li>
                <Link href={"/pilots/" + pilot.id + "/agreement"}>Agreement and its versions</Link>
              </li>
              <li>
                <Link href={"/pilots/" + pilot.id + "/metrics"}>Measurements</Link>
              </li>
              <li>
                <Link href={"/pilots/" + pilot.id + "/milestones"}>Milestones and payments</Link>
              </li>
              <li>
                <Link href={"/pilots/" + pilot.id + "/evidence"}>Evidence Report</Link>
              </li>
              <li>
                <Link href={"/pilots/" + pilot.id + "/decision"}>Pathway and scale decision</Link>
              </li>
              <li>
                <Link href={"/challenges/" + pilot.challenge_id}>The challenge behind this pilot</Link>
              </li>
            </ul>
          </Section>

          {isDepartment && (actions.includes("pause") || actions.includes("resume") || actions.includes("complete") || actions.includes("terminate")) ? (
            <Section title="Lifecycle actions" description="Every one of these is recorded with a reason.">
              <div className="space-y-4">
                {actions.includes("pause") && hasRole(session, "DO") ? (
                  <Disclosure summary="Pause this pilot">
                    <form action={pilotTransition} className="space-y-3">
                      <input type="hidden" name="pilot_id" value={pilot.id} />
                      <input type="hidden" name="action" value="pause" />
                      <Field label="Reason for pausing" name="pause_reason" required>
                        <textarea id="pause_reason" name="reason" rows={3} required minLength={10} />
                      </Field>
                      <SubmitButton variant="secondary">Pause the pilot</SubmitButton>
                    </form>
                  </Disclosure>
                ) : null}

                {actions.includes("resume") && hasRole(session, "DO") ? (
                  <Disclosure summary="Resume this pilot">
                    <form action={pilotTransition} className="space-y-3">
                      <input type="hidden" name="pilot_id" value={pilot.id} />
                      <input type="hidden" name="action" value="resume" />
                      <Field label="Reason for resuming" name="resume_reason" required>
                        <textarea id="resume_reason" name="reason" rows={3} required minLength={10} />
                      </Field>
                      <SubmitButton variant="secondary">Resume the pilot</SubmitButton>
                    </form>
                  </Disclosure>
                ) : null}

                {actions.includes("complete") && hasRole(session, "DO") ? (
                  <form action={pilotTransition}>
                    <input type="hidden" name="pilot_id" value={pilot.id} />
                    <input type="hidden" name="action" value="complete" />
                    <SubmitButton
                      confirm="Mark this pilot complete? The dataset is then analysed against the pre-registered plan."
                    >
                      Mark the pilot complete
                    </SubmitButton>
                  </form>
                ) : null}

                {actions.includes("terminate") && hasRole(session, "DA") ? (
                  <Disclosure summary="Terminate under the exit clause">
                    <form action={pilotTransition} className="space-y-3">
                      <input type="hidden" name="pilot_id" value={pilot.id} />
                      <input type="hidden" name="action" value="terminate" />
                      <Field label="Reason, citing the exit clause" name="terminate_reason" required>
                        <textarea id="terminate_reason" name="reason" rows={3} required minLength={10} />
                      </Field>
                      <SubmitButton
                        variant="danger"
                        confirm="Terminate this pilot? Milestones already accepted remain payable and the startup must hand over a data export within 15 days."
                      >
                        Terminate the pilot
                      </SubmitButton>
                    </form>
                  </Disclosure>
                ) : null}
              </div>
            </Section>
          ) : null}

          {isStartup && actions.includes("request-changes") ? (
            <Section title="Request a change to the agreement">
              <form action={pilotTransition} className="space-y-3">
                <input type="hidden" name="pilot_id" value={pilot.id} />
                <input type="hidden" name="action" value="request-changes" />
                <Field label="What needs to change, and why" name="change_reason" required>
                  <textarea id="change_reason" name="reason" rows={3} required minLength={10} />
                </Field>
                <SubmitButton variant="secondary">Send the request</SubmitButton>
              </form>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
