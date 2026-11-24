import type { Metadata } from "next";
import Link from "next/link";

import { runEvidence } from "@/app/pilots/actions";
import { SubmitButton } from "@/components/forms";
import {
  ButtonLink,
  Callout,
  DataTable,
  Hash,
  KeyValue,
  Meter,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { ANALYSIS_METHOD_LABELS, bandTone, decimal, signed } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { EvidenceReport, Pilot } from "@/lib/types";

export const metadata: Metadata = { title: "Evidence Report" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  AwaitingValidation: "Awaiting independent validation",
  SignedOff: "Validated",
  SignedOffWithQualifications: "Validated with qualifications",
  Refused: "Validation refused",
};

export default async function EvidencePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/pilots/" + params.id + "/evidence");
  const pilot = await apiGetOrNotFound<Pilot>("/pilots/" + params.id);
  const report = await apiGetOptional<EvidenceReport>("/pilots/" + params.id + "/evidence");

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const canRun = hasRole(session, "DO") && session.department_id === pilot.department_id;
  const analysis = report?.analysis ?? {};
  const score = report?.components;

  return (
    <div>
      <PageHeader
        title="Evidence Report"
        subtitle="The analysis fixed at design freeze, run on the locked dataset. The score informs the competent authority; it does not decide."
        meta={
          <>
            <Pill>{pilot.reference}</Pill>
            {report ? (
              <>
                <Pill>{report.reference}</Pill>
                <Pill tone={report.status === "Refused" ? "bad" : report.status.startsWith("SignedOff") ? "good" : "warn"}>
                  {STATUS_LABELS[report.status] ?? report.status}
                </Pill>
              </>
            ) : (
              <Pill tone="warn">Not produced yet</Pill>
            )}
          </>
        }
        actions={
          <>
            {report?.pdf_file_id ? (
              <a href={"/api/v1/evidence/" + report.id + "/report.pdf"} className="btn btn-secondary">
                Download the report
              </a>
            ) : null}
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
          <Callout tone="bad" title="The analysis could not be run">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {!report ? (
        <Section
          title="No report yet"
          description="The Evidence Engine runs the pre-registered analysis once the pilot is complete."
        >
          {pilot.state !== "Completed" ? (
            <Callout tone="warn" title="The pilot is not complete">
              Mark the pilot complete when the final measurements are in. The analysis runs on the
              method and pass mark fixed at design freeze, not on anything chosen afterwards.
            </Callout>
          ) : canRun ? (
            <form action={runEvidence}>
              <input type="hidden" name="pilot_id" value={pilot.id} />
              <SubmitButton pendingLabel="Running the analysis...">
                Run the Evidence Engine
              </SubmitButton>
            </form>
          ) : (
            <Callout tone="neutral">
              The department officer runs the analysis when the pilot is complete.
            </Callout>
          )}
        </Section>
      ) : (
        <>
          {report.dataset_check && !report.dataset_check.unchanged ? (
            <div className="mb-5">
              <Callout tone="bad" title="This report is no longer valid">
                {report.dataset_check.detail}
              </Callout>
            </div>
          ) : null}

          {score ? (
            <Section
              title="Evidence Confidence Score"
              description={score.message}
            >
              <div className="flex flex-wrap items-center gap-6">
                <div
                  className={
                    "rounded border px-6 py-4 text-center " +
                    (bandTone(score.band) === "good"
                      ? "border-good bg-good-light"
                      : bandTone(score.band) === "warn"
                        ? "border-warn bg-warn-light"
                        : "border-bad bg-bad-light")
                  }
                >
                  <p className="num text-4xl font-semibold text-ink">{decimal(score.score, 1)}</p>
                  <p className="mt-1 text-sm text-ink-soft">out of 100</p>
                  <p className="mt-2 font-semibold text-ink">{score.band} evidence</p>
                </div>
                <p className="max-w-prose flex-1 text-ink-soft">{score.band_guidance}</p>
              </div>

              <div className="mt-6 space-y-4">
                {score.components.map((component) => (
                  <div key={component.code}>
                    <Meter
                      label={component.name}
                      value={component.points}
                      max={component.max_points}
                      tone={
                        component.points >= component.max_points * 0.8
                          ? "good"
                          : component.points >= component.max_points * 0.4
                            ? "warn"
                            : "bad"
                      }
                    />
                    <p className="mt-1 max-w-prose text-sm text-ink-muted">{component.explanation}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                <Callout tone="neutral" title="How the bands are meant to be read">
                  80 and above is strong evidence, where scaling may be considered. 60 to 79 is
                  moderate: extend the pilot, or scale in limited areas with continued measurement.
                  Below 60 is weak, and a rollout should not rest on it. The bands inform the
                  approver; they do not decide.
                </Callout>
              </div>
            </Section>
          ) : null}

          <Section
            title="The result on the primary measure"
            description="Read the interval, not just the point estimate."
          >
            <KeyValue
              rows={[
                { label: "Measure", value: String(analysis.primary_kpi_name ?? "Not recorded") },
                {
                  label: "Analysis method",
                  value:
                    ANALYSIS_METHOD_LABELS[String(analysis.method ?? "")] ??
                    String(analysis.method_label ?? analysis.method ?? "Not recorded"),
                },
                { label: "Baseline mean", value: decimal(Number(analysis.baseline_mean), 3) },
                { label: "Pilot mean", value: decimal(Number(analysis.pilot_mean), 3) },
                {
                  label: "Measured change",
                  value: (
                    <span className="num font-semibold">
                      {signed(Number(analysis.effect), 3)} {String(analysis.primary_kpi_unit ?? "")}
                    </span>
                  ),
                },
                {
                  label: "95 percent confidence interval",
                  value: (
                    <span className="num">
                      {decimal(Number(analysis.ci_low), 3)} to {decimal(Number(analysis.ci_high), 3)}
                    </span>
                  ),
                },
                { label: "p-value", value: decimal(Number(analysis.p_value), 6) },
                { label: "Units analysed", value: String(analysis.units_analysed ?? analysis.n_pilot ?? "") },
                {
                  label: "Pass mark",
                  value:
                    decimal(Number(analysis.pass_mark), 2) +
                    (analysis.pass_mark_met ? " (met)" : " (not met)"),
                },
              ]}
            />

            <div className="mt-5">
              <Callout tone={analysis.excludes_zero_95 ? "good" : "warn"}>
                {analysis.excludes_zero_95
                  ? "The whole 95 percent interval sits on the beneficial side of no change, so a result this size is unlikely to be chance."
                  : "The confidence interval includes no change. This pilot cannot rule out that the measured difference is chance variation."}
              </Callout>
            </div>

            {Array.isArray(analysis.notes) && analysis.notes.length ? (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-muted">
                {(analysis.notes as string[]).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </Section>

          {Array.isArray(analysis.secondary) && analysis.secondary.length ? (
            <Section
              title="Supporting measures"
              description="Reported as supporting evidence. The decision rests on the primary measure, which was fixed before any data was collected."
            >
              <DataTable columns={["Measure", "Baseline", "Pilot", "Change", "95 percent interval", "Excludes no change"]}>
                {(analysis.secondary as any[]).map((row) => (
                  <tr key={row.kpi_id}>
                    <td className="font-medium">
                      {row.name} <span className="text-sm text-ink-muted">({row.unit})</span>
                    </td>
                    <td className="num text-sm">{decimal(row.baseline_mean, 2)}</td>
                    <td className="num text-sm">{decimal(row.pilot_mean, 2)}</td>
                    <td className="num text-sm">{signed(row.effect, 2)}</td>
                    <td className="num text-sm">
                      {decimal(row.ci_low, 2)} to {decimal(row.ci_high, 2)}
                    </td>
                    <td className="text-sm">
                      {row.excludes_zero_95 ? <Pill tone="good">Yes</Pill> : <Pill tone="warn">No</Pill>}
                    </td>
                  </tr>
                ))}
              </DataTable>
            </Section>
          ) : null}

          {report.deviations.length ? (
            <Section title="Deviations from the pre-registered plan">
              <DataTable columns={["Deviation", "Approved", "Recorded"]}>
                {report.deviations.map((deviation, index) => (
                  <tr key={index}>
                    <td>{deviation.description}</td>
                    <td>
                      {deviation.approved ? <Pill tone="warn">Approved</Pill> : <Pill tone="bad">Not approved</Pill>}
                    </td>
                    <td className="text-sm text-ink-muted">
                      <Timestamp value={deviation.at} />
                    </td>
                  </tr>
                ))}
              </DataTable>
            </Section>
          ) : null}

          <Section
            title="Limitations"
            description="Stated plainly, because a result without its limits invites over-reading."
          >
            <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
              {report.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </Section>

          <Section
            title="Reproducibility"
            description="The same analysis on the same locked dataset reproduces this result exactly."
          >
            <KeyValue
              rows={[
                { label: "Dataset hash", value: <Hash value={report.dataset_hash} /> },
                { label: "Analysis seed", value: <span className="num">{report.seed}</span> },
                { label: "Engine version", value: report.engine_version },
                {
                  label: "Dataset check",
                  value: report.dataset_check?.unchanged ? (
                    <Pill tone="good">Unchanged since the analysis</Pill>
                  ) : (
                    <Pill tone="bad">Changed, report invalid</Pill>
                  ),
                },
              ]}
            />
          </Section>

          <Section title="Independent validation">
            {report.status === "AwaitingValidation" ? (
              <Callout tone="warn" title="Awaiting the independent validator">
                The score above is provisional. It becomes final only when a validator with no stake
                in this pilot has verified the data and signed off. A refusal means no score is
                issued at all.
              </Callout>
            ) : (
              <>
                <KeyValue
                  rows={[
                    { label: "Outcome", value: STATUS_LABELS[report.status] ?? report.status },
                    { label: "Validator", value: report.validator_name ?? "Recorded" },
                    { label: "Signed", value: <Timestamp value={report.signed_at} /> },
                  ]}
                />
                {report.remarks ? (
                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-wide text-ink-muted">Validator remarks</p>
                    <p className="mt-1 max-w-prose whitespace-pre-line text-ink-soft">{report.remarks}</p>
                  </div>
                ) : null}
                {Object.keys(report.checklist ?? {}).length ? (
                  <ul className="mt-4 space-y-1 text-sm">
                    {Object.entries(report.checklist).map(([key, value]) => (
                      <li key={key}>
                        {value ? <Pill tone="good">Verified</Pill> : <Pill tone="bad">Not verified</Pill>}{" "}
                        <span className="text-ink-soft">{key.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </Section>

          {report.status !== "Refused" && report.status !== "AwaitingValidation" ? (
            <Section title="Next" description="With a validated report, the approver can record a decision.">
              <ButtonLink href={"/pilots/" + pilot.id + "/decision"} variant="primary">
                Open the pathway and decision
              </ButtonLink>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}
