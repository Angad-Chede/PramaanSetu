import type { Metadata } from "next";
import { ArrowRight, Check, Download, FlaskConical, Lock, ShieldAlert, ShieldCheck, X } from "lucide-react";

import { runEvidence } from "@/app/pilots/actions";
import { SubmitButton } from "@/components/app/forms";
import { Callout, EmptyState, Flash, Hash, KeyValues, LinkButton, Page, PageHeader, Panel, ToneBadge, type Tone, bandToneOf } from "@/components/app/kit";
import { Gauge } from "@/components/ui/gauge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { ANALYSIS_METHOD_LABELS, decimal, formatDateTime, signed } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { EvidenceReport, Pilot } from "@/lib/types";

import { ComponentBars, ECS_THRESHOLDS, ForestPlot, ScoreComposition } from "../_run/stats";

export const metadata: Metadata = { title: "Evidence Report" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  AwaitingValidation: "Awaiting independent validation",
  SignedOff: "Validated",
  SignedOffWithQualifications: "Validated with qualifications",
  Refused: "Validation refused",
};

function statusTone(status: string): Tone {
  if (status === "Refused") return "destructive";
  if (status.startsWith("SignedOff")) return "success";
  return "warning";
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EvidencePage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession("/pilots/" + id + "/evidence");
  const pilot = await apiGetOrNotFound<Pilot>("/pilots/" + id);
  const report = await apiGetOptional<EvidenceReport>("/pilots/" + id + "/evidence");

  const canRun = hasRole(session, "DO") && session.department_id === pilot.department_id;
  const analysis = report?.analysis ?? {};
  const score = report?.components;
  const secondary = Array.isArray(analysis.secondary) ? (analysis.secondary as Record<string, any>[]) : [];
  const notes = Array.isArray(analysis.notes) ? (analysis.notes as string[]) : [];
  const unit = String(analysis.primary_kpi_unit ?? "");
  const relative = Number(analysis.relative_effect_percent);

  return (
    <Page>
      <PageHeader
        back={{ href: "/pilots/" + pilot.id, label: "Pilot " + pilot.reference }}
        eyebrow={
          <>
            <span>Evidence Engine</span>
            {report && <span className="font-mono text-[12px] text-muted-foreground/80">{report.reference}</span>}
          </>
        }
        title="Evidence Report"
        description="The analysis fixed at design freeze, run on the locked dataset. The score informs the competent authority. It does not decide."
        meta={report ? <ToneBadge tone={statusTone(report.status)}>{STATUS_LABELS[report.status] ?? report.status}</ToneBadge> : <ToneBadge tone="warning">Not produced yet</ToneBadge>}
        actions={
          report?.pdf_file_id ? (
            <LinkButton href={"/api/v1/evidence/" + report.id + "/report.pdf"} variant="outline" external>
              <Download />
              Download the report
            </LinkButton>
          ) : undefined
        }
      />

      <Flash searchParams={query} />

      {!report ? (
        <Panel>
          <EmptyState
            className="border-0 bg-transparent py-10"
            icon={FlaskConical}
            title="No report yet"
            description={
              pilot.state !== "Completed"
                ? "Mark the pilot complete when the final measurements are in. The analysis then runs on the method and pass mark fixed at design freeze, not on anything chosen afterwards."
                : canRun
                  ? "The pilot is complete. Running the Evidence Engine applies the pre-registered analysis to the locked dataset and produces a provisional score for independent validation."
                  : "The department officer runs the analysis when the pilot is complete."
            }
            action={
              pilot.state === "Completed" && canRun ? (
                <form action={runEvidence}>
                  <input type="hidden" name="pilot_id" value={pilot.id} />
                  <SubmitButton variant="brand" size="lg" pendingLabel="Running the analysis">
                    Run the Evidence Engine
                  </SubmitButton>
                </form>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <>
          {report.dataset_check && !report.dataset_check.unchanged && (
            <Callout tone="destructive" title="This report is no longer valid" icon={ShieldAlert}>
              {report.dataset_check.detail}
            </Callout>
          )}

          {score && (
            <Panel className="animate-enter [animation-delay:60ms]">
              <div className="grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)] md:gap-10">
                <div className="flex flex-col items-center">
                  <Gauge
                    value={score.score}
                    max={100}
                    decimals={1}
                    size={240}
                    thickness={16}
                    thresholds={ECS_THRESHOLDS}
                    label="Evidence Confidence Score"
                    caption={score.issued ? "out of 100" : "provisional, out of 100"}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <ToneBadge tone={bandToneOf(score.band)}>{score.band} evidence</ToneBadge>
                    {!score.issued && <ToneBadge tone="warning">Provisional</ToneBadge>}
                  </div>
                  <p className="font-display text-xl leading-snug font-semibold tracking-tight text-balance md:text-2xl">{score.band_guidance}</p>
                  <p className="text-[15px] text-muted-foreground">{score.message}</p>
                  <ScoreComposition components={score.components} className="mt-2" />
                </div>
              </div>
            </Panel>
          )}

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-6">
              <Panel title="The result on the primary measure" description="Read the interval, not just the point estimate.">
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-1">
                    <span className="text-[13px] font-medium text-muted-foreground">{String(analysis.primary_kpi_name ?? "Primary measure")}</span>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-display text-4xl font-semibold tracking-tight tabular-nums">{signed(Number(analysis.effect), 2)}</span>
                      <span className="text-[15px] text-muted-foreground">{unit}</span>
                      {Number.isFinite(relative) && (
                        <ToneBadge tone={analysis.excludes_zero_95 ? "success" : "warning"} dot={false}>
                          {signed(relative, 1)}% against the baseline
                        </ToneBadge>
                      )}
                    </div>
                  </div>

                  {Number.isFinite(Number(analysis.ci_low)) && (
                    <div className="rounded-2xl bg-surface/60 px-4 pt-4 pb-3 md:px-6">
                      <ForestPlot
                        effect={Number(analysis.effect)}
                        low={Number(analysis.ci_low)}
                        high={Number(analysis.ci_high)}
                        target={analysis.target_effect != null ? Number(analysis.target_effect) : null}
                        direction={String(analysis.effect_direction ?? "lower")}
                        unit={unit}
                      />
                      <p className="mt-2 text-center text-[12px] text-muted-foreground tabular-nums">
                        95 percent interval {decimal(Number(analysis.ci_low), 3)} to {decimal(Number(analysis.ci_high), 3)}
                      </p>
                    </div>
                  )}

                  <Callout tone={analysis.excludes_zero_95 ? "success" : "warning"}>
                    {analysis.excludes_zero_95
                      ? "The whole 95 percent interval sits on the beneficial side of no change, so a result this size is unlikely to be chance."
                      : "The confidence interval includes no change. This pilot cannot rule out that the measured difference is chance variation."}
                  </Callout>

                  <KeyValues
                    columns={3}
                    items={[
                      {
                        label: "Analysis method",
                        value: ANALYSIS_METHOD_LABELS[String(analysis.method ?? "")] ?? String(analysis.method_label ?? analysis.method ?? "Not recorded"),
                        wide: true,
                      },
                      { label: "Baseline mean", value: <span className="tabular-nums">{decimal(Number(analysis.baseline_mean), 3)}</span> },
                      { label: "Pilot mean", value: <span className="tabular-nums">{decimal(Number(analysis.pilot_mean), 3)}</span> },
                      { label: "Units analysed", value: <span className="tabular-nums">{String(analysis.units_analysed ?? analysis.n_pilot ?? "")}</span> },
                      {
                        label: "p-value",
                        value: <span className="tabular-nums">{Number(analysis.p_value) < 0.000001 ? "below 0.000001" : decimal(Number(analysis.p_value), 6)}</span>,
                      },
                      {
                        label: "Pass mark",
                        value: (
                          <span className="inline-flex items-center gap-2 tabular-nums">
                            {decimal(Number(analysis.pass_mark), 2)}
                            {analysis.pass_mark_met ? <ToneBadge tone="success">Met</ToneBadge> : <ToneBadge tone="destructive">Not met</ToneBadge>}
                          </span>
                        ),
                      },
                      {
                        label: "95 percent interval",
                        value: (
                          <span className="tabular-nums">
                            {decimal(Number(analysis.ci_low), 3)} to {decimal(Number(analysis.ci_high), 3)}
                          </span>
                        ),
                      },
                    ]}
                  />

                  {notes.length > 0 && (
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted-foreground">
                      {notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </Panel>

              {score && (
                <Panel title="How the score was built" description="Five components, each scored against what was pre-registered. Every point is explained.">
                  <ComponentBars components={score.components} />
                  <Callout tone="neutral" title="How the bands are meant to be read" className="mt-6">
                    80 and above is strong evidence, where scaling may be considered. 60 to 79 is moderate: extend the pilot, or scale in limited areas with continued
                    measurement. Below 60 is weak, and a rollout should not rest on it. The bands inform the approver. They do not decide.
                  </Callout>
                </Panel>
              )}

              {secondary.length > 0 && (
                <Panel
                  flush
                  title="Supporting measures"
                  description="Supporting evidence only. The decision rests on the primary measure, which was fixed before any data was collected."
                >
                  <div className="overflow-x-auto">
                    <Table className="min-w-[680px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-5 md:pl-6">Measure</TableHead>
                          <TableHead className="text-right">Baseline</TableHead>
                          <TableHead className="text-right">Pilot</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                          <TableHead className="w-52">95 percent interval</TableHead>
                          <TableHead className="pr-5 md:pr-6">Excludes no change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {secondary.map((row) => (
                          <TableRow key={row.kpi_id}>
                            <TableCell className="pl-5 md:pl-6">
                              <div className="flex flex-col">
                                <span className="font-medium whitespace-normal">{row.name}</span>
                                <span className="text-[12px] text-muted-foreground">{row.unit}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{decimal(row.baseline_mean, 2)}</TableCell>
                            <TableCell className="text-right tabular-nums">{decimal(row.pilot_mean, 2)}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{signed(row.effect, 2)}</TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-0.5">
                                <ForestPlot compact effect={row.effect} low={row.ci_low} high={row.ci_high} direction={row.direction} />
                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                  {decimal(row.ci_low, 2)} to {decimal(row.ci_high, 2)}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="pr-5 md:pr-6">
                              {row.excludes_zero_95 ? <ToneBadge tone="success">Yes</ToneBadge> : <ToneBadge tone="warning">No</ToneBadge>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </Panel>
              )}

              {report.deviations.length > 0 && (
                <Panel flush title="Deviations from the pre-registered plan">
                  <ul className="divide-y divide-border/70">
                    {report.deviations.map((deviation, index) => (
                      <li key={index} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between md:px-6">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm">{deviation.description}</span>
                          <span className="text-[12px] text-muted-foreground">{formatDateTime(deviation.at)}</span>
                        </div>
                        {deviation.approved ? <ToneBadge tone="warning">Approved</ToneBadge> : <ToneBadge tone="destructive">Not approved</ToneBadge>}
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <Panel title="Limitations" description="Stated plainly, because a result without its limits invites over-reading.">
                <ol className="flex flex-col gap-3">
                  {report.limitations.map((limitation, index) => (
                    <li key={limitation} className="flex gap-3 text-sm leading-relaxed text-pretty">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-[12px] font-semibold text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                      <span className="pt-0.5">{limitation}</span>
                    </li>
                  ))}
                </ol>
              </Panel>
            </div>

            <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
              <Panel title="Independent validation">
                {report.status === "AwaitingValidation" ? (
                  <Callout tone="warning" title="Awaiting the independent validator">
                    The score is provisional. It becomes final only when a validator with no stake in this pilot has verified the data and signed off. A refusal means no
                    score is issued at all.
                  </Callout>
                ) : (
                  <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "grid size-10 place-items-center rounded-full",
                          report.status === "Refused" ? "bg-destructive/12 text-destructive-ink" : "bg-success/12 text-success-ink",
                        )}
                      >
                        {report.status === "Refused" ? <ShieldAlert className="size-5" /> : <ShieldCheck className="size-5" />}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{STATUS_LABELS[report.status] ?? report.status}</span>
                        <span className="text-[13px] text-muted-foreground">
                          {report.validator_name ?? "Validator recorded"}
                          {report.signed_at && <>, {formatDateTime(report.signed_at)}</>}
                        </span>
                      </div>
                    </div>
                    {Object.keys(report.checklist ?? {}).length > 0 && (
                      <ul className="flex flex-col gap-2">
                        {Object.entries(report.checklist).map(([key, value]) => (
                          <li key={key} className="flex items-center gap-2.5 text-[13px]">
                            <span
                              className={cn(
                                "grid size-5 shrink-0 place-items-center rounded-full",
                                value ? "bg-success text-white" : "bg-destructive/12 text-destructive-ink",
                              )}
                            >
                              {value ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
                            </span>
                            <span className="first-letter:uppercase">{key.replace(/_/g, " ")}</span>
                            <span className="sr-only">{value ? "verified" : "not verified"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {report.remarks && (
                      <blockquote className="rounded-2xl bg-surface/70 p-4 text-[13px] leading-relaxed whitespace-pre-line text-muted-foreground">{report.remarks}</blockquote>
                    )}
                  </div>
                )}
              </Panel>

              <Panel title="Reproducibility" description="The same analysis on the same locked dataset reproduces this result exactly.">
                <div className="flex flex-col gap-4">
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium",
                      report.dataset_check?.unchanged ? "bg-success/10 text-success-ink" : "bg-destructive/10 text-destructive-ink",
                    )}
                  >
                    <Lock className="size-3.5" />
                    {report.dataset_check?.unchanged ? "Dataset unchanged since the analysis" : "Dataset changed, report invalid"}
                  </div>
                  <KeyValues
                    columns={1}
                    items={[
                      { label: "Dataset hash", value: <Hash value={report.dataset_hash} /> },
                      { label: "Analysis seed", value: <span className="font-mono text-[13px]">{report.seed}</span> },
                      { label: "Engine version", value: <span className="font-mono text-[13px]">{report.engine_version}</span> },
                    ]}
                  />
                </div>
              </Panel>

              {report.status !== "Refused" && report.status !== "AwaitingValidation" && (
                <div className="flex flex-col gap-3 rounded-3xl bg-foreground p-5 text-background dark:bg-card dark:text-foreground dark:shadow-card dark:ring-1 dark:ring-brand/25">
                  <p className="font-display text-[15px] font-semibold tracking-tight">Next: the pathway and decision</p>
                  <p className="text-[13px] leading-relaxed opacity-70">With a validated report, the approver can see the recommended procurement route and record a decision.</p>
                  <LinkButton href={"/pilots/" + pilot.id + "/decision"} variant="brand" className="mt-1 w-fit">
                    Open the decision
                    <ArrowRight />
                  </LinkButton>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </Page>
  );
}
