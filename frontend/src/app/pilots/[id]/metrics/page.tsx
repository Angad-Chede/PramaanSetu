import type { Metadata } from "next";
import Link from "next/link";

import { disputeMetric, issuePilotApiKey, submitMetrics } from "@/app/pilots/actions";
import { Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  EmptyState,
  Field,
  Meter,
  PageHeader,
  Pill,
  ProblemList,
  Section,
} from "@/components/ui";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { decimal, formatDate } from "@/lib/format";
import { readNotice, readProblem, single } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge, Pilot } from "@/lib/types";

export const metadata: Metadata = { title: "Measurements" };
export const dynamic = "force-dynamic";

type MetricRow = {
  id: string;
  kpi_id: string;
  unit_ref: string;
  period_start: string;
  period_end: string;
  phase: string;
  arm: string;
  value: number;
  source: string;
  status: string;
  dispute_reason: string | null;
};

type Dashboard = {
  plan: { planned_unit_periods: number; units: number; duration_weeks: number } | null;
  measurements_received: number;
  completeness_percent: number;
};

export default async function MetricsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/pilots/" + params.id + "/metrics");
  const pilot = await apiGetOrNotFound<Pilot>("/pilots/" + params.id);
  const challenge = await apiGet<Challenge>("/challenges/" + pilot.challenge_id);
  const dashboard = await apiGetOptional<Dashboard>("/pilots/" + params.id + "/dashboard");

  const phase = single(searchParams?.phase);
  const query = new URLSearchParams({ limit: "500", include_disputed: "true" });
  if (phase) query.set("phase", phase);
  const metrics = await apiGet<{ items: MetricRow[]; count: number }>(
    "/pilots/" + params.id + "/metrics?" + query.toString(),
  );

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const canSubmit =
    session.startup_id === pilot.startup_id ||
    (hasRole(session, "DO") && session.department_id === pilot.department_id);
  const canDispute = hasRole(session, "DO") && session.department_id === pilot.department_id;

  const kpiNames = new Map((challenge.kpis ?? []).map((kpi) => [kpi.id, kpi]));
  const disputed = metrics.items.filter((row) => row.status !== "Accepted");

  return (
    <div>
      <PageHeader
        title="Measurements"
        subtitle="One value per measure, per unit, per period. Submitting the same cell again replaces it rather than creating a duplicate, so a retried upload is always safe."
        meta={
          <>
            <Pill>{pilot.reference}</Pill>
            <Pill>{metrics.count} row{metrics.count === 1 ? "" : "s"}</Pill>
            {disputed.length ? <Pill tone="warn">{disputed.length} disputed</Pill> : null}
          </>
        }
        actions={
          <>
            <a href={"/api/v1/pilots/" + pilot.id + "/metrics/template.csv"} className="btn btn-secondary">
              Download the CSV template
            </a>
            <Link href={"/pilots/" + pilot.id} className="btn btn-secondary">
              Back to the pilot
            </Link>
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
          <Callout tone="bad" title="Some rows were not stored">{problem.message}</Callout>
          <ProblemList problems={problem.fields} title="Fix these and submit again" />
        </div>
      ) : null}

      {dashboard?.plan ? (
        <Section title="Against the plan">
          <Meter
            label="Measurements received against the pre-registered plan"
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
          <p className="mt-3 text-sm text-ink-soft">
            The plan is {dashboard.plan.units} units over {dashboard.plan.duration_weeks} weeks.
            Completeness below 90 percent costs points in the Evidence Confidence Score and is
            stated as a limitation on the report.
          </p>
        </Section>
      ) : null}

      {canSubmit ? (
        <Section
          title="Upload a file"
          description="A CSV using the template columns. Every row is validated on ingest; rejected rows come back with their line number and the reason, and the valid rows are stored."
        >
          <form
            action={"/api/v1/pilots/" + pilot.id + "/metrics/csv"}
            method="post"
            encType="multipart/form-data"
            className="max-w-form space-y-4"
          >
            <Field
              label="CSV file"
              name="file"
              required
              help="Columns: kpi_name, unit_ref, period_start, period_end, phase, arm, value. Identifier-like columns such as phone or email are refused outright."
            >
              <input id="file" name="file" type="file" accept=".csv,text/csv" required />
            </Field>
            <button type="submit" className="btn btn-primary">
              Upload the file
            </button>
          </form>

          <div className="mt-5">
            <Callout tone="neutral" title="Privacy on ingest">
              The upload template has no fields for direct identifiers, and the validator refuses a
              file carrying a column that looks like a phone number, an email address or an
              identification number. Anonymise or aggregate before you upload.
            </Callout>
          </div>

          {session.startup_id === pilot.startup_id ? (
            <div className="mt-5">
              <Disclosure summary="Submit measurements from your own system instead">
                <p className="mb-3">
                  A pilot-scoped API key lets your system post measurements directly. The key is
                  shown once and works only for this pilot.
                </p>
                <form action={issuePilotApiKey}>
                  <input type="hidden" name="pilot_id" value={pilot.id} />
                  <SubmitButton variant="secondary">Issue an API key</SubmitButton>
                </form>
              </Disclosure>
            </div>
          ) : null}
        </Section>
      ) : null}

      {canSubmit ? (
        <Section
          title="Enter rows by hand"
          description="For a small number of readings. Leave a row blank to skip it."
        >
          <form action={submitMetrics} className="space-y-4">
            <input type="hidden" name="pilot_id" value={pilot.id} />
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Measure</th>
                    <th scope="col">Unit</th>
                    <th scope="col">Period start</th>
                    <th scope="col">Period end</th>
                    <th scope="col">Phase</th>
                    <th scope="col">Arm</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 3, 4].map((index) => (
                    <tr key={index}>
                      <td>
                        <label className="sr-only" htmlFor={"row_kpi_" + index}>
                          Measure for row {index + 1}
                        </label>
                        <select id={"row_kpi_" + index} name="row_kpi_id">
                          {(challenge.kpis ?? []).map((kpi) => (
                            <option key={kpi.id} value={kpi.id}>
                              {kpi.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={"row_unit_" + index}>
                          Unit reference for row {index + 1}
                        </label>
                        <input id={"row_unit_" + index} name="row_unit_ref" placeholder="DMA-01" />
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={"row_start_" + index}>
                          Period start for row {index + 1}
                        </label>
                        <input id={"row_start_" + index} name="row_period_start" type="date" />
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={"row_end_" + index}>
                          Period end for row {index + 1}
                        </label>
                        <input id={"row_end_" + index} name="row_period_end" type="date" />
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={"row_phase_" + index}>
                          Phase for row {index + 1}
                        </label>
                        <select id={"row_phase_" + index} name="row_phase" defaultValue="pilot">
                          <option value="baseline">Baseline</option>
                          <option value="pilot">Pilot</option>
                        </select>
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={"row_arm_" + index}>
                          Arm for row {index + 1}
                        </label>
                        <select id={"row_arm_" + index} name="row_arm" defaultValue="treatment">
                          <option value="treatment">Pilot unit</option>
                          <option value="comparison">Comparison unit</option>
                        </select>
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={"row_value_" + index}>
                          Value for row {index + 1}
                        </label>
                        <input id={"row_value_" + index} name="row_value" type="number" step="any" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubmitButton pendingLabel="Submitting...">Submit these rows</SubmitButton>
          </form>
        </Section>
      ) : null}

      <Section
        title="Recorded measurements"
        description="Newest period last. Disputed rows are excluded from interim views and from the Evidence Report until resolved."
        actions={
          <div className="flex gap-2">
            <Link
              href={"/pilots/" + pilot.id + "/metrics"}
              className={"pill no-underline " + (phase ? "pill-neutral" : "pill-good")}
            >
              All
            </Link>
            <Link
              href={"/pilots/" + pilot.id + "/metrics?phase=baseline"}
              className={"pill no-underline " + (phase === "baseline" ? "pill-good" : "pill-neutral")}
            >
              Baseline
            </Link>
            <Link
              href={"/pilots/" + pilot.id + "/metrics?phase=pilot"}
              className={"pill no-underline " + (phase === "pilot" ? "pill-good" : "pill-neutral")}
            >
              Pilot
            </Link>
          </div>
        }
      >
        {metrics.items.length ? (
          <DataTable columns={["Measure", "Unit", "Period", "Phase", "Arm", "Value", "Source", "Status"]}>
            {metrics.items.slice(0, 200).map((row) => (
              <tr key={row.id}>
                <td className="text-sm">{kpiNames.get(row.kpi_id)?.name ?? row.kpi_id}</td>
                <td className="num text-sm">{row.unit_ref}</td>
                <td className="whitespace-nowrap text-sm">{formatDate(row.period_start)}</td>
                <td className="text-sm">{row.phase === "baseline" ? "Baseline" : "Pilot"}</td>
                <td className="text-sm">{row.arm === "comparison" ? "Comparison" : "Pilot unit"}</td>
                <td className="num">{decimal(row.value, 3)}</td>
                <td className="text-sm text-ink-muted">{row.source}</td>
                <td className="text-sm">
                  {row.status === "Accepted" ? (
                    <Pill tone="good">Accepted</Pill>
                  ) : (
                    <Pill tone="warn">{row.status}</Pill>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="No measurements have been recorded for this pilot yet." />
        )}
        {metrics.items.length > 200 ? (
          <p className="mt-3 text-sm text-ink-muted">
            Showing the first 200 of {metrics.count} rows. The validator workspace carries the full
            dataset.
          </p>
        ) : null}
      </Section>

      {canDispute && metrics.items.length ? (
        <Section
          title="Dispute a measurement"
          description="A disputed row is excluded from interim views and from the Evidence Report until the dispute is resolved."
        >
          <form action={disputeMetric} className="max-w-form space-y-3">
            <input type="hidden" name="pilot_id" value={pilot.id} />
            <Field label="Which measurement" name="submission_id" required>
              <select id="submission_id" name="submission_id" required>
                {metrics.items
                  .filter((row) => row.status === "Accepted")
                  .slice(0, 100)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {(kpiNames.get(row.kpi_id)?.name ?? "Measure") +
                        " | " +
                        row.unit_ref +
                        " | " +
                        formatDate(row.period_start) +
                        " | " +
                        decimal(row.value, 2)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="What is wrong with it" name="dispute_reason" required>
              <textarea id="dispute_reason" name="reason" rows={3} required minLength={10} />
            </Field>
            <SubmitButton variant="secondary">Mark as disputed</SubmitButton>
          </form>
        </Section>
      ) : null}
    </div>
  );
}
