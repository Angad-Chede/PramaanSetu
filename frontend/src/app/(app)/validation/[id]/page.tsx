import type { Metadata } from "next";
import { ArrowRight, Check, CircleAlert, Download, FileCheck2, Fingerprint, ShieldX, Stamp } from "lucide-react";

import { signOffEvidence } from "@/app/pilots/actions";
import { SubmitButton, TextAreaField } from "@/components/app/forms";
import { Callout, EmptyState, Flash, Hash, KeyValues, Meter, Page, PageHeader, Panel, ToneBadge, type Tone } from "@/components/app/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { Gauge } from "@/components/ui/gauge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { all, apiGetOrNotFound } from "@/lib/api";
import { ANALYSIS_METHOD_LABELS, decimal, formatDate, formatDateTime, signed } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Split } from "@/app/(app)/challenges/[id]/_review/shared";

export const metadata: Metadata = { title: "Validator workspace" };
export const dynamic = "force-dynamic";

type Secondary = {
  kpi_id: string;
  name: string;
  unit: string;
  direction: string;
  baseline_mean: number;
  pilot_mean: number;
  effect: number;
  ci_low: number;
  ci_high: number;
  p_value: number;
  excludes_zero_95?: boolean;
};

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  AwaitingValidation: { label: "Awaiting your sign-off", tone: "warning" },
  SignedOff: { label: "Signed off", tone: "success" },
  SignedOffWithQualifications: { label: "Signed off with qualifications", tone: "success" },
  Refused: { label: "Refused", tone: "destructive" },
};

const DECISIONS = [
  { value: "sign_off", title: "Sign off", body: "The result is verified.", icon: Stamp, tone: "text-success" },
  { value: "sign_off_with_qualifications", title: "Sign off with qualifications", body: "Verified, but a reader must see my remarks.", icon: FileCheck2, tone: "text-warning" },
  { value: "refuse", title: "Refuse", body: "I cannot verify this result. No score is issued.", icon: ShieldX, tone: "text-destructive" },
];

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** The 95 percent interval drawn against zero and the target change. */
function IntervalPlot({ low, high, effect, target, unit }: { low: number; high: number; effect: number; target: number | null; unit: string }) {
  const points = [low, high, effect, 0, ...(target !== null ? [target] : [])];
  let lo = Math.min(...points);
  let hi = Math.max(...points);
  const pad = (hi - lo || 1) * 0.12;
  lo -= pad;
  hi += pad;
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const excludesZero = (low > 0 && high > 0) || (low < 0 && high < 0);

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative h-16" role="img" aria-label={`Change ${signed(effect, 2)} ${unit}, 95 percent interval ${decimal(low, 2)} to ${decimal(high, 2)}`}>
        <div className="absolute inset-x-0 top-8 h-px bg-border" />
        <div className="absolute top-3 bottom-3 w-px bg-foreground/40" style={{ left: at(0) + "%" }}>
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap text-muted-foreground">No change</span>
        </div>
        {target !== null && (
          <div className="absolute top-3 bottom-3 border-l border-dashed border-brand" style={{ left: at(target) + "%" }}>
            <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[11px] font-medium whitespace-nowrap text-brand-ink">Target</span>
          </div>
        )}
        <div
          className={cn("absolute top-[26px] h-3 rounded-full", excludesZero ? "bg-success/30" : "bg-warning/30")}
          style={{ left: at(low) + "%", width: Math.max(0.5, at(high) - at(low)) + "%" }}
        />
        <div
          className={cn("absolute top-[24px] size-4 -translate-x-1/2 rounded-full border-2 border-card shadow-lift", excludesZero ? "bg-success" : "bg-warning")}
          style={{ left: at(effect) + "%" }}
        />
      </div>
      <figcaption className="flex flex-wrap justify-between gap-2 text-[12px] text-muted-foreground tabular-nums">
        <span>
          Interval {decimal(low, 2)} to {decimal(high, 2)} {unit}
        </span>
        <span className={cn("font-medium", excludesZero ? "text-success-ink" : "text-warning-ink")}>
          {excludesZero ? "Excludes no change" : "Includes no change"}
        </span>
      </figcaption>
    </figure>
  );
}

const th = "px-3 py-2.5 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase first:pl-5 last:pr-5 md:first:pl-6 md:last:pr-6";
const td = "px-3 py-2.5 whitespace-nowrap first:pl-5 last:pr-5 md:first:pl-6 md:last:pr-6";

export default async function ValidatorWorkspacePage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [, workspace] = await all(requireSession("/validation/" + id), apiGetOrNotFound<Workspace>("/evidence/" + id + "/workspace"));

  const decided = workspace.status !== "AwaitingValidation";
  const status = STATUS[workspace.status] ?? { label: workspace.status, tone: "neutral" as Tone };
  const analysis = workspace.analysis ?? {};
  const plan = workspace.pre_registered_plan;
  const unit = String(analysis.primary_kpi_unit ?? "");
  const secondary: Secondary[] = Array.isArray(analysis.secondary) ? analysis.secondary : [];

  const baseline = num(analysis.baseline_mean);
  const pilotMean = num(analysis.pilot_mean);
  const effect = num(analysis.effect);
  const ciLow = num(analysis.ci_low);
  const ciHigh = num(analysis.ci_high);
  const relative = num(analysis.relative_effect_percent);
  const target = num(analysis.target_effect);
  const passMarkMet = analysis.pass_mark_met;
  const shown = workspace.raw_submissions.slice(0, 300);

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/validation", label: "Back to the validation queue" }}
        eyebrow={
          <>
            <span className="font-mono text-[12px] tracking-tight">{workspace.reference}</span>
            <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
            <span className="tabular-nums">{workspace.row_count} raw rows</span>
          </>
        }
        title="Verify the evidence, then decide"
        description="Check the data behind this Evidence Report, re-run the analysis on the locked dataset, and then sign off, sign off with qualifications, or refuse."
        actions={
          // a plain anchor: the PDF is served by the API route, not a page
          <a
            href={"/api/v1/evidence/" + id + "/report.pdf"}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-card px-4 text-sm font-medium shadow-card transition-shadow hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Download className="size-4" />
            Download the report
          </a>
        }
      />
      <Flash searchParams={query} />

      <Split
        main={
          <>
            <Panel title="The result as computed" description="Re-run this yourself against the raw data below. The seed and the engine version make it reproducible.">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <p className="text-[13px] text-muted-foreground">{String(analysis.primary_kpi_name ?? "Primary measure")}</p>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-display text-xl text-muted-foreground tabular-nums">{decimal(baseline, 2)}</span>
                    <ArrowRight className="size-4 self-center text-glyph" />
                    <span className="font-serif text-[40px] font-normal tracking-[-0.03em] tabular-nums">{decimal(pilotMean, 2)}</span>
                    <span className="text-sm text-muted-foreground">{unit}</span>
                    <span className="flex flex-wrap gap-1.5 sm:ml-auto">
                      <ToneBadge tone="neutral" dot={false}>
                        {signed(effect, 2)}
                        {relative !== null ? ` (${signed(relative, 1)}%)` : ""}
                      </ToneBadge>
                      {passMarkMet !== undefined && (
                        <ToneBadge tone={passMarkMet ? "success" : "warning"}>{passMarkMet ? "Pass mark met" : "Pass mark not met"}</ToneBadge>
                      )}
                    </span>
                  </div>
                </div>

                {effect !== null && ciLow !== null && ciHigh !== null && (
                  <IntervalPlot low={ciLow} high={ciHigh} effect={effect} target={target} unit={unit} />
                )}

                <KeyValues
                  columns={3}
                  items={[
                    { label: "Method used", value: String(analysis.method_label ?? analysis.method ?? "Not recorded"), wide: true },
                    { label: "Baseline mean", value: <span className="tabular-nums">{decimal(baseline, 4)}</span> },
                    { label: "Pilot mean", value: <span className="tabular-nums">{decimal(pilotMean, 4)}</span> },
                    { label: "Measured change", value: <span className="tabular-nums">{signed(effect, 4)}</span> },
                    { label: "95 percent interval", value: <span className="tabular-nums">{decimal(ciLow, 4) + " to " + decimal(ciHigh, 4)}</span> },
                    { label: "p-value", value: <span className="tabular-nums">{decimal(num(analysis.p_value), 6)}</span> },
                    { label: "Test statistic", value: <span className="tabular-nums">{decimal(num(analysis.statistic), 4)}</span> },
                    { label: "Units analysed", value: <span className="tabular-nums">{String(analysis.n_pilot ?? "")}</span> },
                    { label: "Bootstrap resamples", value: <span className="tabular-nums">{String(analysis.resamples ?? "")}</span> },
                    { label: "Analysis seed", value: <span className="font-mono text-[13px]">{workspace.seed}</span> },
                    { label: "Engine version", value: <span className="font-mono text-[13px]">{workspace.engine_version}</span> },
                    { label: "Dataset hash", value: <Hash value={workspace.dataset_hash} /> },
                  ]}
                />

                <Callout tone={workspace.dataset_check.unchanged ? "success" : "destructive"} icon={Fingerprint} title={workspace.dataset_check.unchanged ? "Dataset unchanged" : "Dataset changed"}>
                  {workspace.dataset_check.detail}
                </Callout>
              </div>
            </Panel>

            {secondary.length > 0 && (
              <Panel title="Supporting measures" description="Reported for context. They never decide the score." flush>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="border-y border-border/70 bg-surface/50">
                      <tr>
                        <th className={th}>Measure</th>
                        <th className={cn(th, "text-right")}>Baseline</th>
                        <th className={cn(th, "text-right")}>Pilot</th>
                        <th className={cn(th, "text-right")}>Change</th>
                        <th className={cn(th, "text-right")}>Interval</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {secondary.map((row) => {
                        const excludes = row.excludes_zero_95 ?? ((row.ci_low > 0 && row.ci_high > 0) || (row.ci_low < 0 && row.ci_high < 0));
                        return (
                          <tr key={row.kpi_id}>
                            <td className={cn(td, "whitespace-normal")}>
                              <span className="font-medium">{row.name}</span>
                              <span className="block text-[12px] text-muted-foreground">
                                {row.unit}, {row.direction === "lower" ? "lower is better" : "higher is better"}
                              </span>
                            </td>
                            <td className={cn(td, "text-right tabular-nums text-muted-foreground")}>{decimal(row.baseline_mean, 2)}</td>
                            <td className={cn(td, "text-right font-medium tabular-nums")}>{decimal(row.pilot_mean, 2)}</td>
                            <td className={cn(td, "text-right tabular-nums")}>{signed(row.effect, 2)}</td>
                            <td className={cn(td, "text-right tabular-nums", excludes ? "text-success-ink" : "text-muted-foreground")}>
                              {decimal(row.ci_low, 2)} to {decimal(row.ci_high, 2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}

            <Panel title="The pre-registered plan" description="Frozen before data collection began. Anything the department changed afterwards is listed as an amendment.">
              {plan ? (
                <div className="flex flex-col gap-5">
                  <KeyValues
                    columns={3}
                    items={[
                      { label: "Duration", value: plan.duration_weeks + " weeks" },
                      { label: "Units", value: plan.units },
                      { label: "Measurement frequency", value: plan.measurements_per_week + " per week" },
                      { label: "Pass mark", value: <span className="tabular-nums">{decimal(plan.pass_mark, 2) + (unit ? " " + unit : "")}</span> },
                      { label: "Significance level", value: <span className="tabular-nums">{plan.alpha}</span> },
                      { label: "Frozen", value: plan.frozen_at ? formatDateTime(plan.frozen_at) : "Not frozen" },
                      { label: "Analysis method", value: ANALYSIS_METHOD_LABELS[plan.analysis_method] ?? plan.analysis_method, wide: true },
                    ]}
                  />
                  {plan.amendments.length ? (
                    <Callout tone="warning" title="Amendments and deviations">
                      <ul className="flex flex-col gap-2">
                        {plan.amendments.map((amendment, index) => (
                          <li key={index}>
                            {amendment.description}{" "}
                            <span className="text-muted-foreground">
                              ({amendment.approved ? "approved" : "not approved"}, {formatDate(amendment.at)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Callout>
                  ) : (
                    <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Check className="size-4 text-success" />
                      No amendments or deviations were recorded. The pilot ran as pre-registered.
                    </p>
                  )}
                </div>
              ) : (
                <Callout tone="destructive" title="No plan was frozen">
                  A pilot without a pre-registered plan cannot produce defensible evidence.
                </Callout>
              )}
            </Panel>

            <Panel
              title="Raw submissions"
              description="Every row, including any that were rejected or disputed, so you can trace values back to the source records."
              flush
              action={<span className="text-[12px] text-muted-foreground tabular-nums">{workspace.row_count} rows</span>}
            >
              {shown.length ? (
                <>
                  <div className="max-h-[520px] overflow-auto overscroll-contain">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 z-10 border-y border-border/70 bg-card">
                        <tr>
                          <th className={th}>Unit</th>
                          <th className={th}>Phase</th>
                          <th className={th}>Arm</th>
                          <th className={th}>Period</th>
                          <th className={cn(th, "text-right")}>Value</th>
                          <th className={th}>Source</th>
                          <th className={th}>Status</th>
                          <th className={th}>Upload hash</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {shown.map((row) => (
                          <tr key={row.id} className={cn(row.status !== "Accepted" && "bg-warning/[0.05]")}>
                            <td className={cn(td, "font-mono text-[12px]")}>{row.unit_ref}</td>
                            <td className={cn(td, "capitalize")}>{row.phase}</td>
                            <td className={cn(td, "capitalize text-muted-foreground")}>{row.arm}</td>
                            <td className={cn(td, "text-muted-foreground")}>{formatDate(row.period_start)}</td>
                            <td className={cn(td, "text-right font-medium tabular-nums")}>{decimal(row.value, 3)}</td>
                            <td className={cn(td, "text-muted-foreground")}>{row.source}</td>
                            <td className={td}>
                              <ToneBadge tone={row.status === "Accepted" ? "success" : "warning"}>{row.status}</ToneBadge>
                            </td>
                            <td className={cn(td, "font-mono text-[12px] text-muted-foreground")} title={row.upload_hash ?? undefined}>
                              {row.upload_hash ? row.upload_hash.slice(0, 12) : "None"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {workspace.row_count > 300 && (
                    <p className="border-t border-border/70 px-5 py-3 text-[13px] text-muted-foreground md:px-6">
                      Showing the first 300 of {workspace.row_count} rows.
                    </p>
                  )}
                </>
              ) : (
                <EmptyState title="No raw rows" description="No measurements were submitted for this pilot." className="m-5 mt-0 md:m-6 md:mt-0" />
              )}
            </Panel>

            {!decided ? (
              <Panel id="decision" title="Your decision" description="Complete every verification step before signing off. Refusing needs remarks but not the checklist." className="scroll-mt-20">
                <form action={signOffEvidence} className="flex flex-col gap-6">
                  <input type="hidden" name="report_id" value={id} />

                  <fieldset className="flex min-w-0 flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">Verification checklist</legend>
                    {workspace.checklist.map((item) => (
                      <label
                        key={item.key}
                        htmlFor={"check_" + item.key}
                        className="flex cursor-pointer items-start gap-3 rounded-2xl bg-surface/60 px-4 py-3 text-sm leading-snug transition-colors hover:bg-surface has-[[data-state=checked]]:bg-success/[0.07]"
                      >
                        <input type="hidden" name="checklist_key" value={item.key} />
                        <Checkbox id={"check_" + item.key} name={"check_" + item.key} value="yes" defaultChecked={item.checked} className="mt-0.5" />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </fieldset>

                  <fieldset className="flex min-w-0 flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">Decision</legend>
                    <RadioGroup name="decision" defaultValue="sign_off" required className="grid gap-2 md:grid-cols-3">
                      {DECISIONS.map((decision) => (
                        <label
                          key={decision.value}
                          htmlFor={"decision_" + decision.value}
                          className="flex cursor-pointer flex-col gap-2 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:ring-glyph/40 has-[[data-state=checked]]:ring-2 has-[[data-state=checked]]:ring-foreground/70"
                        >
                          <span className="flex items-center justify-between">
                            <decision.icon className={cn("size-5", decision.tone)} />
                            <RadioGroupItem id={"decision_" + decision.value} value={decision.value} />
                          </span>
                          <span className="text-sm font-medium">{decision.title}</span>
                          <span className="text-[13px] leading-snug text-muted-foreground">{decision.body}</span>
                        </label>
                      ))}
                    </RadioGroup>
                  </fieldset>

                  <TextAreaField
                    id="remarks"
                    label="Written remarks"
                    name="remarks"
                    rows={6}
                    required
                    minLength={20}
                    hint="At least 20 characters. Record what you verified, how, and anything a reader should be careful about. These remarks travel with the report and the Innovation Passport."
                  />

                  <Callout tone="warning" icon={CircleAlert} title="Refusing has consequences">
                    A refusal means no Evidence Confidence Score is issued and no scale decision can be recorded on this pilot. Use it when the
                    data cannot be verified, not as a way of expressing doubt: qualified sign-off exists for that.
                  </Callout>

                  <div>
                    <SubmitButton
                      variant="brand"
                      size="lg"
                      pendingLabel="Recording"
                      confirmTitle="Record this decision?"
                      confirm="It is final for this version of the report."
                    >
                      Record my decision
                    </SubmitButton>
                  </div>
                </form>
              </Panel>
            ) : (
              <Callout tone={status.tone} title="Decision recorded">
                This report is {status.label.toLowerCase()}. Your remarks are carried on the report and, where the report was signed off, on
                the Innovation Passport.
              </Callout>
            )}
          </>
        }
        aside={
          <>
            <Panel title={decided ? "Evidence Confidence Score" : "Provisional score"} description={decided ? undefined : "Final when you sign off. A refusal means no score is issued."}>
              <div className="flex flex-col gap-5">
                <div className="flex flex-col items-center">
                  <Gauge
                    value={workspace.components.score}
                    decimals={1}
                    size={220}
                    tone={workspace.status === "Refused" ? "neutral" : decided ? "success" : "brand"}
                    needle={false}
                    caption={workspace.components.band}
                  />
                </div>
                <ul className="flex flex-col gap-3.5 border-t border-border/70 pt-4">
                  {workspace.components.components.map((component) => (
                    <li key={component.code} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="font-medium">{component.name}</span>
                        <span className="tabular-nums text-muted-foreground">
                          <span className="font-medium text-foreground">{decimal(component.points, 1)}</span> / {component.max_points}
                        </span>
                      </div>
                      <Meter value={component.points} max={component.max_points} tone={decided && workspace.status !== "Refused" ? "success" : "brand"} label={component.name} />
                      <p className="text-[12px] leading-snug text-muted-foreground">{component.explanation}</p>
                    </li>
                  ))}
                </ul>
                {!decided && (
                  <a
                    href="#decision"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Go to your decision
                    <ArrowRight className="size-4" />
                  </a>
                )}
              </div>
            </Panel>

            {workspace.guidance.length > 0 && (
              <Panel title="What your sign-off means">
                <ol className="flex flex-col gap-3">
                  {workspace.guidance.map((line, index) => (
                    <li key={line} className="flex gap-3 text-[13px] leading-relaxed text-foreground/90">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-semibold tabular-nums">{index + 1}</span>
                      {line}
                    </li>
                  ))}
                </ol>
              </Panel>
            )}
          </>
        }
      />
    </Page>
  );
}
