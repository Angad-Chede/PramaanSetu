import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, Database, Download, KeyRound, LineChart, Rows3, ShieldCheck, Target } from "lucide-react";

import { disputeMetric, issuePilotApiKey, submitMetrics } from "@/app/pilots/actions";
import { Disclosure, SelectField, SubmitButton, TextAreaField } from "@/components/app/forms";
import { Callout, EmptyState, Figure, FigureGrid, Flash, LinkButton, Meter, Page, PageHeader, Panel, ToneBadge } from "@/components/app/kit";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { decimal, formatDate } from "@/lib/format";
import { single } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Challenge, Pilot } from "@/lib/types";

import { CsvDrop } from "./_components/csv-drop";
import { TrendChart, type TrendPoint } from "./_components/trend-chart";

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
  primary_kpi?: { id: string; name: string; unit: string; direction: string; baseline_mean: number | null; target_value: number | null } | null;
  trend?: { period_start: string; mean: number; units: number }[];
};

const PHASES = [
  { value: "", label: "All" },
  { value: "baseline", label: "Baseline" },
  { value: "pilot", label: "Pilot" },
];

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MetricsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession("/pilots/" + id + "/metrics");
  const pilot = await apiGetOrNotFound<Pilot>("/pilots/" + id);
  const challenge = await apiGet<Challenge>("/challenges/" + pilot.challenge_id);
  const dashboard = await apiGetOptional<Dashboard>("/pilots/" + id + "/dashboard");

  const phase = single(query.phase);
  const search = new URLSearchParams({ limit: "500", include_disputed: "true" });
  if (phase) search.set("phase", phase);
  const metrics = await apiGet<{ items: MetricRow[]; count: number }>("/pilots/" + id + "/metrics?" + search.toString());

  const isStartup = session.startup_id === pilot.startup_id;
  const canSubmit = isStartup || (hasRole(session, "DO") && session.department_id === pilot.department_id);
  const canDispute = hasRole(session, "DO") && session.department_id === pilot.department_id;

  const kpis = challenge.kpis ?? [];
  const kpiNames = new Map(kpis.map((kpi) => [kpi.id, kpi]));
  const disputed = metrics.items.filter((row) => row.status !== "Accepted");
  const accepted = metrics.items.filter((row) => row.status === "Accepted");

  const primaryId = dashboard?.primary_kpi?.id ?? kpis.find((kpi) => kpi.is_primary)?.id ?? kpis[0]?.id;
  const primary = primaryId ? kpiNames.get(primaryId) : undefined;
  const trend = buildTrend(
    accepted.filter((row) => row.kpi_id === primaryId),
    dashboard?.trend ?? [],
  );
  const target = dashboard?.primary_kpi?.target_value ?? primary?.target_value ?? null;
  const baselineMean = dashboard?.primary_kpi?.baseline_mean ?? null;

  const completeness = dashboard?.completeness_percent ?? null;
  const completenessTone = completeness === null ? "neutral" : completeness >= 90 ? "success" : completeness >= 70 ? "warning" : "destructive";
  const base = "/pilots/" + pilot.id + "/metrics";

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/pilots/" + pilot.id, label: "Pilot " + pilot.reference }}
        eyebrow={
          <>
            <span>Measurements</span>
            {pilot.challenge_title && <span className="text-muted-foreground/70">· {pilot.challenge_title}</span>}
          </>
        }
        title="Measurements"
        description="One value per measure, per unit, per period. Submitting the same cell again replaces it rather than creating a duplicate, so a retried upload is always safe."
        meta={
          disputed.length > 0 ? (
            <ToneBadge tone="warning">
              {disputed.length} disputed
            </ToneBadge>
          ) : undefined
        }
        actions={
          <LinkButton href={"/api/v1/pilots/" + pilot.id + "/metrics/template.csv"} variant="outline" external>
            <Download />
            CSV template
          </LinkButton>
        }
      />

      <Flash searchParams={query} />

      <FigureGrid className="grid-cols-2 animate-enter [animation-delay:60ms]">
        <Figure label="Rows recorded" value={metrics.count.toLocaleString("en-IN")} icon={Rows3} hint={phase ? `${phase === "baseline" ? "Baseline" : "Pilot"} phase only` : "Every phase and measure"} />
        <Figure
          label="Against the plan"
          value={completeness === null ? "No plan" : decimal(Math.min(completeness, 999), 0) + "%"}
          icon={Target}
          tone={completenessTone}
          hint={dashboard?.plan ? `${dashboard.measurements_received} of ${dashboard.plan.planned_unit_periods} planned unit-periods` : "Set at design freeze"}
        />
        <Figure label="Plan" value={dashboard?.plan ? `${dashboard.plan.units} units` : "Not frozen"} icon={Database} hint={dashboard?.plan ? `Over ${dashboard.plan.duration_weeks} weeks` : "The design sets the plan"} />
        <Figure
          label="Disputed"
          value={disputed.length}
          icon={CircleAlert}
          tone={disputed.length ? "warning" : "success"}
          hint={disputed.length ? "Excluded until resolved" : "Every row is accepted"}
        />
      </FigureGrid>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {primary && trend.length > 1 && (
            <Panel
              title={primary.name}
              description={`Weekly mean of the primary measure across all units, in ${primary.unit}. ${primary.direction === "higher" ? "Higher" : "Lower"} is better.`}
              action={
                <div className="hidden items-center gap-3 text-[12px] text-muted-foreground sm:flex">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-3 rounded-full bg-glyph" />
                    Baseline
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-3 rounded-full bg-brand" />
                    Pilot
                  </span>
                </div>
              }
            >
              <TrendChart data={trend} target={target} baselineMean={baselineMean} unit={primary.unit} />
            </Panel>
          )}

          <Panel
            flush
            title="Recorded measurements"
            description="Disputed rows are excluded from interim views and from the Evidence Report until resolved."
            action={
              <nav aria-label="Filter by phase" className="flex rounded-full bg-surface p-0.5">
                {PHASES.map((option) => {
                  const active = (phase ?? "") === option.value;
                  return (
                    <Link
                      key={option.label}
                      href={option.value ? base + "?phase=" + option.value : base}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-full px-3 py-1 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-ios",
                        active ? "bg-card text-foreground shadow-lift" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </Link>
                  );
                })}
              </nav>
            }
          >
            {metrics.items.length ? (
              <>
                <div className="max-h-[560px] overflow-auto border-t border-border/70">
                  <Table className="min-w-[680px] text-[13px]">
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead className="pl-5 md:pl-6">Measure</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>Phase</TableHead>
                        <TableHead>Arm</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="pr-5 md:pr-6">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {metrics.items.slice(0, 200).map((row) => (
                        <TableRow key={row.id} className={cn(row.status !== "Accepted" && "bg-warning/[0.05]")}>
                          <TableCell className="max-w-40 truncate pl-5 md:pl-6" title={kpiNames.get(row.kpi_id)?.name}>
                            {kpiNames.get(row.kpi_id)?.name ?? row.kpi_id}
                          </TableCell>
                          <TableCell className="font-mono text-[12px]">{row.unit_ref}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDate(row.period_start)}>{formatDate(row.period_start).replace(/ \d{4}$/, "")}</TableCell>
                          <TableCell>
                            <span className={cn("inline-flex items-center gap-1.5", row.phase === "baseline" ? "text-muted-foreground" : "text-foreground")}>
                              <span className={cn("size-1.5 rounded-full", row.phase === "baseline" ? "bg-glyph" : "bg-brand")} />
                              {row.phase === "baseline" ? "Baseline" : "Pilot"}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{row.arm === "comparison" ? "Comparison" : "Pilot unit"}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{decimal(row.value, 3)}</TableCell>
                          <TableCell className="text-muted-foreground uppercase">{row.source}</TableCell>
                          <TableCell className="pr-5 md:pr-6">
                            {row.status === "Accepted" ? (
                              <ToneBadge tone="success">Accepted</ToneBadge>
                            ) : (
                              <ToneBadge tone="warning" className="max-w-40" >
                                <span className="truncate" title={row.dispute_reason ?? undefined}>{row.status}</span>
                              </ToneBadge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {metrics.items.length > 200 && (
                  <p className="border-t border-border/70 px-5 py-3 text-[13px] text-muted-foreground md:px-6">
                    Showing the first 200 of {metrics.count} rows. The validator workspace carries the full dataset.
                  </p>
                )}
              </>
            ) : (
              <div className="px-5 pb-5 md:px-6">
                <EmptyState
                  icon={LineChart}
                  title="No measurements yet"
                  description={canSubmit ? "Upload the CSV template or enter a few rows by hand. Each row is validated as it arrives." : "Measurements appear here as the startup and the department submit them."}
                />
              </div>
            )}
          </Panel>

        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-20">
          {dashboard?.plan && (
            <Panel title="Against the plan">
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-3xl font-semibold tracking-tight tabular-nums">{dashboard.measurements_received}</span>
                  <span className="text-[13px] text-muted-foreground tabular-nums">of {dashboard.plan.planned_unit_periods} planned</span>
                </div>
                <Meter
                  label="Measurements received against the pre-registered plan"
                  value={dashboard.measurements_received}
                  max={dashboard.plan.planned_unit_periods || 1}
                  tone={completenessTone}
                />
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  The plan is {dashboard.plan.units} units over {dashboard.plan.duration_weeks} weeks. Completeness below 90 percent costs points in the Evidence Confidence
                  Score and is stated as a limitation on the report.
                </p>
              </div>
            </Panel>
          )}

          {canSubmit && (
            <Panel title="Upload a file" description="A CSV using the template columns. Rejected rows come back with their line number and the reason; valid rows are stored.">
              <div className="flex flex-col gap-4">
                <CsvDrop action={"/api/v1/pilots/" + pilot.id + "/metrics/csv"} />
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Columns: <span className="font-mono">kpi_name, unit_ref, period_start, period_end, phase, arm, value</span>.
                </p>
                <Callout tone="info" title="Privacy on ingest" icon={ShieldCheck}>
                  The template has no fields for direct identifiers, and the validator refuses a column that looks like a phone number, email address or identification
                  number. Anonymise or aggregate before you upload.
                </Callout>
                {isStartup && (
                  <Disclosure
                    summary={
                      <span className="inline-flex items-center gap-2">
                        <KeyRound className="size-4 text-glyph" />
                        Post from your own system instead
                      </span>
                    }
                  >
                    <p className="mb-3">A pilot-scoped API key lets your system post measurements directly. The key is shown once and works only for this pilot.</p>
                    <form action={issuePilotApiKey}>
                      <input type="hidden" name="pilot_id" value={pilot.id} />
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Issuing">
                        Issue an API key
                      </SubmitButton>
                    </form>
                  </Disclosure>
                )}
              </div>
            </Panel>
          )}

          {canDispute && accepted.length > 0 && (
            <Panel title="Dispute a measurement" description="A disputed row is excluded from interim views and from the Evidence Report until the dispute is resolved.">
              <form action={disputeMetric} className="flex flex-col gap-4">
                <input type="hidden" name="pilot_id" value={pilot.id} />
                <SelectField
                  label="Which measurement"
                  name="submission_id"
                  required
                  options={accepted.slice(0, 100).map((row) => ({
                    value: row.id,
                    label: [kpiNames.get(row.kpi_id)?.name ?? "Measure", row.unit_ref, formatDate(row.period_start), decimal(row.value, 2)].join(" | "),
                  }))}
                />
                <TextAreaField id="dispute_reason" label="What is wrong with it" name="reason" rows={3} required minLength={10} />
                <div>
                  <SubmitButton
                    variant="secondary"
                    confirmTitle="Dispute this measurement?"
                    confirm="It is excluded from interim views and from the Evidence Report until the dispute is resolved."
                    confirmLabel="Mark as disputed"
                  >
                    Mark as disputed
                  </SubmitButton>
                </div>
              </form>
            </Panel>
          )}
        </aside>
      </div>

        {canSubmit && (
          <Panel title="Enter rows by hand" description="For a small number of readings. Leave a row blank to skip it.">
            <form action={submitMetrics} className="flex flex-col gap-4">
              <input type="hidden" name="pilot_id" value={pilot.id} />
              <div className="-mx-5 overflow-x-auto px-5 md:-mx-6 md:px-6">
                <table className="w-full min-w-[820px] border-separate border-spacing-x-1.5 border-spacing-y-1.5 text-left">
                  <thead>
                    <tr className="text-[12px] font-medium text-muted-foreground">
                      <th scope="col" className="w-8 font-medium" />
                      <th scope="col" className="font-medium">Measure</th>
                      <th scope="col" className="font-medium">Unit</th>
                      <th scope="col" className="font-medium">Period start</th>
                      <th scope="col" className="font-medium">Period end</th>
                      <th scope="col" className="font-medium">Phase</th>
                      <th scope="col" className="font-medium">Arm</th>
                      <th scope="col" className="font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2, 3, 4].map((index) => (
                      <tr key={index}>
                        <td className="text-center text-[12px] text-muted-foreground tabular-nums">{index + 1}</td>
                        <td className="min-w-44">
                          <label className="sr-only" htmlFor={"row_kpi_" + index}>
                            Measure for row {index + 1}
                          </label>
                          <NativeSelect id={"row_kpi_" + index} name="row_kpi_id" size="sm">
                            {kpis.map((kpi) => (
                              <NativeSelectOption key={kpi.id} value={kpi.id}>
                                {kpi.name}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </td>
                        <td className="w-28">
                          <label className="sr-only" htmlFor={"row_unit_" + index}>
                            Unit reference for row {index + 1}
                          </label>
                          <Input id={"row_unit_" + index} name="row_unit_ref" placeholder="DMA-01" className="h-8 font-mono text-[13px]" />
                        </td>
                        <td className="w-36">
                          <label className="sr-only" htmlFor={"row_start_" + index}>
                            Period start for row {index + 1}
                          </label>
                          <Input id={"row_start_" + index} name="row_period_start" type="date" className="h-8 text-[13px]" />
                        </td>
                        <td className="w-36">
                          <label className="sr-only" htmlFor={"row_end_" + index}>
                            Period end for row {index + 1}
                          </label>
                          <Input id={"row_end_" + index} name="row_period_end" type="date" className="h-8 text-[13px]" />
                        </td>
                        <td className="w-28">
                          <label className="sr-only" htmlFor={"row_phase_" + index}>
                            Phase for row {index + 1}
                          </label>
                          <NativeSelect id={"row_phase_" + index} name="row_phase" defaultValue="pilot" size="sm">
                            <NativeSelectOption value="baseline">Baseline</NativeSelectOption>
                            <NativeSelectOption value="pilot">Pilot</NativeSelectOption>
                          </NativeSelect>
                        </td>
                        <td className="w-36">
                          <label className="sr-only" htmlFor={"row_arm_" + index}>
                            Arm for row {index + 1}
                          </label>
                          <NativeSelect id={"row_arm_" + index} name="row_arm" defaultValue="treatment" size="sm">
                            <NativeSelectOption value="treatment">Pilot unit</NativeSelectOption>
                            <NativeSelectOption value="comparison">Comparison unit</NativeSelectOption>
                          </NativeSelect>
                        </td>
                        <td className="w-28">
                          <label className="sr-only" htmlFor={"row_value_" + index}>
                            Value for row {index + 1}
                          </label>
                          <Input id={"row_value_" + index} name="row_value" type="number" step="any" className="h-8 text-right text-[13px] tabular-nums" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <SubmitButton pendingLabel="Submitting">Submit these rows</SubmitButton>
              </div>
            </form>
          </Panel>
        )}
    </Page>
  );
}

function buildTrend(rows: MetricRow[], pilotTrend: { period_start: string; mean: number }[]): TrendPoint[] {
  // the dashboard aggregates the whole pilot phase server side; the row list is capped, so it only supplies the baseline
  const usePilotRows = pilotTrend.length === 0;
  const buckets = new Map<string, { baseline: number[]; pilot: number[] }>();
  const bucket = (key: string) => buckets.get(key) ?? buckets.set(key, { baseline: [], pilot: [] }).get(key)!;
  for (const row of rows) {
    if (row.phase === "baseline") bucket(row.period_start.slice(0, 10)).baseline.push(row.value);
    else if (usePilotRows) bucket(row.period_start.slice(0, 10)).pilot.push(row.value);
  }
  for (const point of pilotTrend) bucket(point.period_start.slice(0, 10)).pilot.push(point.mean);
  const mean = (values: number[]) => (values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)) : undefined);
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, entry]) => ({
      label: formatDate(key).replace(/ \d{4}$/, ""),
      baseline: mean(entry.baseline),
      pilot: mean(entry.pilot),
    }));
}
