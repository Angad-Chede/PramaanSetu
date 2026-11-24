import type { Metadata } from "next";
import Link from "next/link";

import { signOffEvidence } from "@/app/pilots/actions";
import { Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  Field,
  Hash,
  KeyValue,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { ANALYSIS_METHOD_LABELS, decimal, formatDate, signed } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Validator workspace" };
export const dynamic = "force-dynamic";

type Workspace = {
  report_id: string;
  reference: string;
  dataset_hash: string;
  seed: number;
  engine_version: string;
  status: string;
  checklist: { key: string; label: string; checked: boolean }[];
  pre_registered_plan: {
    duration_weeks: number;
    units: number;
    measurements_per_week: number;
    pass_mark: number;
    analysis_method: string;
    alpha: number;
    frozen_at: string | null;
    amendments: { description: string; approved: boolean; at: string }[];
  } | null;
  analysis: Record<string, any>;
  components: {
    score: number;
    band: string;
    components: { code: string; name: string; points: number; max_points: number; explanation: string }[];
  };
  raw_submissions: {
    id: string;
    kpi_id: string;
    unit_ref: string;
    phase: string;
    arm: string;
    period_start: string;
    value: number;
    source: string;
    status: string;
    submitted_by: string;
    upload_hash: string | null;
  }[];
  row_count: number;
  dataset_check: { unchanged: boolean; detail: string };
  guidance: string[];
};

export default async function ValidationPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession("/validation/" + params.id);
  const workspace = await apiGetOrNotFound<Workspace>("/evidence/" + params.id + "/workspace");

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const decided = workspace.status !== "AwaitingValidation";
  const analysis = workspace.analysis ?? {};

  return (
    <div>
      <PageHeader
        title="Validator workspace"
        subtitle="Verify the data behind this Evidence Report, re-run the analysis on the locked dataset, and then sign off, sign off with qualifications, or refuse."
        meta={
          <>
            <Pill>{workspace.reference}</Pill>
            <Pill tone={decided ? "good" : "warn"}>{workspace.status}</Pill>
            <Pill>{workspace.row_count} raw rows</Pill>
          </>
        }
        actions={
          <>
            <a href={"/api/v1/evidence/" + params.id + "/report.pdf"} className="btn btn-secondary">
              Download the report
            </a>
            <Link href="/evaluation" className="btn btn-secondary">
              Back to my panel work
            </Link>
          </>
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Recorded">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That could not be recorded">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      <Section title="What your sign-off means">
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
          {workspace.guidance.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>

      <Section
        title="The pre-registered plan"
        description="Frozen before data collection began. Anything the department changed afterwards is listed as an amendment."
      >
        {workspace.pre_registered_plan ? (
          <>
            <KeyValue
              rows={[
                { label: "Duration", value: workspace.pre_registered_plan.duration_weeks + " weeks" },
                { label: "Units", value: workspace.pre_registered_plan.units },
                {
                  label: "Measurement frequency",
                  value: workspace.pre_registered_plan.measurements_per_week + " per week",
                },
                { label: "Pass mark", value: decimal(workspace.pre_registered_plan.pass_mark, 2) },
                {
                  label: "Analysis method",
                  value:
                    ANALYSIS_METHOD_LABELS[workspace.pre_registered_plan.analysis_method] ??
                    workspace.pre_registered_plan.analysis_method,
                },
                { label: "Significance level", value: workspace.pre_registered_plan.alpha },
                { label: "Frozen", value: <Timestamp value={workspace.pre_registered_plan.frozen_at} /> },
              ]}
            />
            {workspace.pre_registered_plan.amendments.length ? (
              <div className="mt-4">
                <Callout tone="warn" title="Amendments and deviations">
                  <ul className="space-y-2">
                    {workspace.pre_registered_plan.amendments.map((amendment, index) => (
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
            ) : (
              <p className="mt-3 text-sm text-ink-muted">
                No amendments or deviations were recorded. The pilot ran as pre-registered.
              </p>
            )}
          </>
        ) : (
          <Callout tone="bad" title="No plan was frozen">
            A pilot without a pre-registered plan cannot produce defensible evidence.
          </Callout>
        )}
      </Section>

      <Section
        title="The result as computed"
        description="Re-run this yourself against the raw data below. The seed and the engine version make it reproducible."
      >
        <KeyValue
          rows={[
            { label: "Measure", value: String(analysis.primary_kpi_name ?? "") },
            { label: "Method used", value: String(analysis.method_label ?? analysis.method ?? "") },
            { label: "Baseline mean", value: decimal(Number(analysis.baseline_mean), 4) },
            { label: "Pilot mean", value: decimal(Number(analysis.pilot_mean), 4) },
            { label: "Measured change", value: signed(Number(analysis.effect), 4) },
            {
              label: "95 percent interval",
              value: decimal(Number(analysis.ci_low), 4) + " to " + decimal(Number(analysis.ci_high), 4),
            },
            { label: "p-value", value: decimal(Number(analysis.p_value), 6) },
            { label: "Test statistic", value: decimal(Number(analysis.statistic), 4) },
            { label: "Units analysed", value: String(analysis.n_pilot ?? "") },
            { label: "Bootstrap resamples", value: String(analysis.resamples ?? "") },
            { label: "Analysis seed", value: <span className="num">{workspace.seed}</span> },
            { label: "Engine version", value: workspace.engine_version },
            { label: "Dataset hash", value: <Hash value={workspace.dataset_hash} /> },
          ]}
        />
        <div className="mt-4">
          <Callout tone={workspace.dataset_check.unchanged ? "good" : "bad"}>
            {workspace.dataset_check.detail}
          </Callout>
        </div>
      </Section>

      <Section
        title="Provisional score"
        description="It becomes final when you sign off. A refusal means no score is issued at all."
      >
        <p className="num text-3xl font-semibold text-ink">
          {decimal(workspace.components.score, 1)}{" "}
          <span className="text-base font-normal text-ink-muted">of 100, {workspace.components.band}</span>
        </p>
        <DataTable columns={["Component", "Points", "Maximum", "Why"]}>
          {workspace.components.components.map((component) => (
            <tr key={component.code}>
              <td className="font-medium">{component.name}</td>
              <td className="num">{decimal(component.points, 2)}</td>
              <td className="num text-ink-muted">{component.max_points}</td>
              <td className="max-w-md text-sm text-ink-muted">{component.explanation}</td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section
        title="Raw submissions"
        description="Every row, including any that were rejected or disputed, so you can trace values back to the source records."
      >
        <DataTable columns={["Unit", "Phase", "Arm", "Period", "Value", "Source", "Status", "Upload hash"]}>
          {workspace.raw_submissions.slice(0, 300).map((row) => (
            <tr key={row.id}>
              <td className="num text-sm">{row.unit_ref}</td>
              <td className="text-sm">{row.phase}</td>
              <td className="text-sm">{row.arm}</td>
              <td className="whitespace-nowrap text-sm">{formatDate(row.period_start)}</td>
              <td className="num">{decimal(row.value, 3)}</td>
              <td className="text-sm text-ink-muted">{row.source}</td>
              <td className="text-sm">
                {row.status === "Accepted" ? (
                  <Pill tone="good">Accepted</Pill>
                ) : (
                  <Pill tone="warn">{row.status}</Pill>
                )}
              </td>
              <td>
                <Hash value={row.upload_hash ? row.upload_hash.slice(0, 12) + "..." : null} />
              </td>
            </tr>
          ))}
        </DataTable>
        {workspace.row_count > 300 ? (
          <p className="mt-3 text-sm text-ink-muted">
            Showing the first 300 of {workspace.row_count} rows.
          </p>
        ) : null}
      </Section>

      {!decided ? (
        <Section
          title="Your decision"
          description="Complete every verification step before signing off. Refusing needs remarks but not the checklist."
        >
          <form action={signOffEvidence} className="max-w-form space-y-5">
            <input type="hidden" name="report_id" value={params.id} />

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">Verification checklist</legend>
              <ul className="space-y-2">
                {workspace.checklist.map((item) => (
                  <li key={item.key} className="flex items-start gap-3 rounded border border-line px-3 py-2">
                    <input type="hidden" name="checklist_key" value={item.key} />
                    <input
                      id={"check_" + item.key}
                      name={"check_" + item.key}
                      type="checkbox"
                      defaultChecked={item.checked}
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <label htmlFor={"check_" + item.key} className="font-normal">
                      {item.label}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <Field label="Decision" name="decision" required>
              <select id="decision" name="decision" defaultValue="sign_off" required>
                <option value="sign_off">Sign off: the result is verified</option>
                <option value="sign_off_with_qualifications">
                  Sign off with qualifications: verified, but read my remarks
                </option>
                <option value="refuse">Refuse: I cannot verify this result</option>
              </select>
            </Field>

            <Field
              label="Written remarks"
              name="remarks"
              required
              help="At least 20 characters. Record what you verified, how, and anything a reader should be careful about. These remarks travel with the report and the Innovation Passport."
            >
              <textarea id="remarks" name="remarks" rows={6} required minLength={20} />
            </Field>

            <Callout tone="warn" title="Refusing has consequences">
              A refusal means no Evidence Confidence Score is issued and no scale decision can be
              recorded on this pilot. Use it when the data cannot be verified, not as a way of
              expressing doubt: qualified sign-off exists for that.
            </Callout>

            <SubmitButton
              pendingLabel="Recording..."
              confirm="Record this decision? It is final for this version of the report."
            >
              Record my decision
            </SubmitButton>
          </form>
        </Section>
      ) : (
        <Section title="Decision recorded">
          <Callout tone="good">
            This report is in state {workspace.status}. Your remarks are carried on the report and,
            where the report was signed off, on the Innovation Passport.
          </Callout>
        </Section>
      )}
    </div>
  );
}
