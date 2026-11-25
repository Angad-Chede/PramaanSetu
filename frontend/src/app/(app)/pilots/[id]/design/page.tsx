import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, FlaskConical, History, Lock, RefreshCw, Sparkles, Target } from "lucide-react";

import { freezeDesign, recordAmendment, refreshSimulationView, runSimulation } from "@/app/pilots/actions";
import { CheckField, ConfirmCheckbox, Disclosure, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/app/forms";
import {
  Callout,
  EmptyState,
  Flash,
  KeyValues,
  Meter,
  Page,
  PageHeader,
  Panel,
  ToneBadge,
  type Tone,
} from "@/components/app/kit";
import { Gauge } from "@/components/ui/gauge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { all, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ANALYSIS_METHOD_LABELS, compactRupees, decimal, formatDateTime, money, percent } from "@/lib/format";
import { single } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { DesignOutcome, Pilot, SimulationRun } from "@/lib/types";

import { LifecycleTrack } from "../_components/lifecycle";
import { pilotStages } from "../_components/stages";
import { DesignSpaceChart, PowerCurveChart, type SimDesign } from "./_components/sim-charts";

export const metadata: Metadata = { title: "Pilot Flight Simulator" };
export const dynamic = "force-dynamic";

type Defaults = {
  inputs: Record<string, number | string>;
  primary_kpi: {
    id: string;
    name: string;
    unit: string;
    kind: string;
    direction: string;
    baseline_value: number | null;
    target_value: number | null;
  };
  budget_ceiling: { paise: number } | null;
  target_power: number;
  guidance: string[];
};

type RunSummary = { id: string; status: string; created_at: string; power: number | null };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function powerTone(power: number): Tone {
  if (power >= 0.8) return "success";
  if (power >= 0.5) return "warning";
  return "destructive";
}

const SERIES_COLORS = ["var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function seriesFor(design: DesignOutcome, index: number): SimDesign {
  const key =
    design.label === "Proposed design" ? "proposed" : design.label === "Recommended design" ? "recommended" : "option" + index;
  const color = key === "proposed" ? "var(--chart-2)" : key === "recommended" ? "var(--chart-1)" : SERIES_COLORS[index % SERIES_COLORS.length];
  return {
    key,
    label: design.label === "Proposed design" ? "Proposed" : design.label === "Recommended design" ? "Recommended" : design.label,
    weeks: design.duration_weeks,
    units: design.units,
    power: design.power,
    mde: design.minimum_detectable_effect,
    costPaise: design.expected_cost_paise,
    withinBudget: design.within_budget,
    color,
  };
}

export default async function DesignPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const queryRun = single(query.run);
  const [session, pilot, defaults, runs, queriedRun] = await all(
    requireSession("/pilots/" + id + "/design"),
    apiGetOrNotFound<Pilot>("/pilots/" + id),
    apiGetOptional<Defaults>("/pilots/" + id + "/simulations/defaults"),
    apiGetOptional<{ items: RunSummary[] }>("/pilots/" + id + "/simulations?limit=10"),
    queryRun ? apiGetOptional<SimulationRun>("/simulations/" + queryRun) : Promise.resolve(null),
  );

  // without a run in the URL, show the latest one, which needs the list first
  let run = queriedRun;
  const latestRun = runs?.items[0]?.id;
  if (!queryRun && latestRun) {
    run = await apiGetOptional<SimulationRun>("/simulations/" + latestRun);
  }

  const canDesign = hasRole(session, "DO") && session.department_id === pilot.department_id;
  const frozen = Boolean(pilot.design?.frozen);
  const inputs = (run?.inputs ?? defaults?.inputs ?? {}) as Record<string, number>;
  const results = run?.results ?? null;
  const unit = defaults?.primary_kpi.unit ?? pilot.design?.unit ?? "the measure";
  const targetPower = defaults?.target_power ?? 0.8;
  const budget = defaults?.budget_ceiling?.paise ?? null;

  const series = results ? results.comparison.map((design, index) => seriesFor(design, index)) : [];
  const claimed = Math.abs(Number(inputs.claimed_effect ?? 0));
  const realism = Number(inputs.realism_factor ?? 0.7);
  const alpha = Number(inputs.alpha ?? 0.05);

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/pilots/" + pilot.id, label: "Back to the pilot" }}
        eyebrow={
          <>
            <span className="font-mono text-[12px]">{pilot.reference}</span>
            {frozen ? (
              <ToneBadge tone="success" dot={false}>
                <Lock className="size-3" />
                Plan frozen
              </ToneBadge>
            ) : (
              <ToneBadge tone="warning">Plan not frozen</ToneBadge>
            )}
            {defaults?.budget_ceiling ? <ToneBadge tone="neutral" dot={false}>Budget ceiling {compactRupees(defaults.budget_ceiling.paise)}</ToneBadge> : null}
          </>
        }
        title="Pilot Flight Simulator"
        description="One question, answered before the pilot starts: if the solution really delivers the improvement it claims, will this design detect it, and at what cost?"
      />

      <Flash searchParams={query} />

      <LifecycleTrack stages={pilotStages(pilot)} active="design" />

      {frozen && pilot.design ? (
        <section className="relative overflow-hidden rounded-3xl bg-card shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-success/6 px-5 py-4 md:px-6">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full bg-success/14 text-success-ink">
                <Lock className="size-4" />
              </span>
              <div>
                <h2 className="font-display text-[15px] font-semibold tracking-tight">The pre-registered plan</h2>
                <p className="text-[13px] text-muted-foreground">Frozen {formatDateTime(pilot.design.frozen_at)}. It changes only through a recorded amendment.</p>
              </div>
            </div>
            <ToneBadge tone="success">Locked</ToneBadge>
          </div>
          <div className="flex flex-col gap-5 p-5 md:p-6">
            <KeyValues
              columns={3}
              items={[
                { label: "Primary measure", value: pilot.design.primary_kpi_name },
                { label: "Pass mark", value: decimal(pilot.design.pass_mark, 2) + " " + pilot.design.unit },
                { label: "Duration and units", value: pilot.design.duration_weeks + " weeks, " + pilot.design.units + " units" },
                { label: "Analysis method", value: ANALYSIS_METHOD_LABELS[pilot.design.analysis_method] ?? pilot.design.analysis_method },
                {
                  label: "Expected power at freeze",
                  value: pilot.design.expected_power === null ? "Not recorded" : percent(pilot.design.expected_power),
                },
                { label: "Expected cost", value: pilot.design.expected_cost ? money(pilot.design.expected_cost) : "Not recorded" },
              ]}
            />
            <p className="text-[13px] text-muted-foreground">
              Every amendment is recorded on the Evidence Report. An approved amendment costs 2 points of protocol adherence, an unapproved deviation costs 5.
            </p>
            {canDesign ? (
              <Disclosure summary="Record an amendment to the frozen plan">
                <form action={recordAmendment} className="flex max-w-2xl flex-col gap-4 pt-1">
                  <input type="hidden" name="pilot_id" value={pilot.id} />
                  <TextAreaField
                    label="What changed, and why"
                    name="description"
                    rows={3}
                    required
                    minLength={20}
                    hint="At least 20 characters. This appears on the Evidence Report."
                  />
                  {hasRole(session, "DA") ? <CheckField name="approved" label="Approved by the competent authority" /> : null}
                  <SubmitButton variant="secondary" className="self-start">
                    Record the amendment
                  </SubmitButton>
                </form>
              </Disclosure>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          {run && run.status !== "Succeeded" ? (
            <Callout
              tone="info"
              icon={RefreshCw}
              title={"Simulation " + run.status.toLowerCase()}
              action={
                <form action={refreshSimulationView}>
                  <input type="hidden" name="pilot_id" value={pilot.id} />
                  <input type="hidden" name="run_id" value={run.id} />
                  <SubmitButton size="sm" variant="secondary">
                    Check again
                  </SubmitButton>
                </form>
              }
            >
              {run.error ?? "Results for the default configuration appear within a few seconds."}
            </Callout>
          ) : null}

          {results ? (
            <>
              <section className="overflow-hidden rounded-3xl bg-card shadow-card">
                <div className="grid gap-0 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
                  <div className="flex flex-col items-center justify-center gap-2 border-b border-border/70 bg-surface/40 p-6 md:border-r md:border-b-0">
                    <Gauge
                      value={Math.round(results.proposed.power * 100)}
                      max={100}
                      target={Math.round(targetPower * 100)}
                      suffix="%"
                      size={220}
                      thickness={14}
                      thresholds={[
                        { upTo: 50, tone: "destructive" },
                        { upTo: 79.99, tone: "warning" },
                        { upTo: 100, tone: "success" },
                      ]}
                      label="Chance of detection"
                      caption={`${Math.round(results.proposed.power * 100)} pilots in 100 would detect the claimed improvement`}
                    />
                  </div>
                  <div className="flex flex-col gap-5 p-5 md:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="font-display text-[15px] font-semibold tracking-tight">What the proposed design would do</h2>
                        <p className="text-[13px] text-muted-foreground">
                          {results.proposed.duration_weeks} weeks across {results.proposed.units} units, from {results.iterations.toLocaleString("en-IN")} simulated pilots
                        </p>
                      </div>
                      <ToneBadge tone={powerTone(results.proposed.power)}>
                        {results.proposed.power >= targetPower ? "Strong enough to decide" : "Underpowered"}
                      </ToneBadge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5 rounded-2xl bg-surface/70 p-4">
                        <span className="text-[13px] font-medium text-muted-foreground">Smallest detectable change</span>
                        <span className="font-display text-[26px] leading-none font-semibold tracking-tight tabular-nums">
                          {decimal(results.proposed.minimum_detectable_effect, 2)}
                        </span>
                        <span className="text-[12px] text-muted-foreground">{unit}</span>
                      </div>
                      <div className="flex flex-col gap-1.5 rounded-2xl bg-surface/70 p-4">
                        <span className="text-[13px] font-medium text-muted-foreground">Expected cost</span>
                        <span className="font-display text-[26px] leading-none font-semibold tracking-tight tabular-nums">
                          <span className="mr-1 text-sm font-medium text-muted-foreground">INR</span>
                          {compactRupees(results.proposed.expected_cost_paise).replace("INR ", "")}
                        </span>
                        <CostRange design={results.proposed} budget={budget} />
                      </div>
                    </div>
                    {run?.explanation?.length ? (
                      <ul className="flex flex-col gap-2">
                        {run.explanation.map((line) => (
                          <li key={line} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                            <Check className="mt-1 size-3.5 shrink-0 text-success" />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {results.proposed.notes.length ? (
                      <Callout tone="warning">
                        <ul className="flex flex-col gap-1.5">
                          {results.proposed.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </Callout>
                    ) : null}
                  </div>
                </div>
              </section>

              <section
                className={cn(
                  "relative overflow-hidden rounded-3xl p-5 shadow-card md:p-6",
                  results.recommendation_found ? "bg-[#111113] text-white dark:bg-card" : "bg-card",
                )}
              >
                {results.recommendation_found && (
                  <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(252,76,1,0.35),transparent)]" />
                )}
                <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex max-w-xl flex-col gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-[13px] font-medium",
                        results.recommendation_found ? "text-brand" : "text-warning-ink",
                      )}
                    >
                      {results.recommendation_found ? <Sparkles className="size-3.5" /> : <Target className="size-3.5" />}
                      Recommendation
                    </span>
                    <p className={cn("font-display text-xl leading-snug font-semibold tracking-tight text-balance", !results.recommendation_found && "text-foreground")}>
                      {results.recommendation_message}
                    </p>
                    <p className={cn("text-[13px]", results.recommendation_found ? "text-white/60 dark:text-muted-foreground" : "text-muted-foreground")}>
                      The smallest design that reaches {Math.round(targetPower * 100)} percent power within the published budget ceiling.
                    </p>
                  </div>
                  {results.recommendation ? (
                    <dl className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
                      {[
                        { label: "Weeks", value: results.recommendation.duration_weeks },
                        { label: "Units", value: results.recommendation.units },
                        { label: "Power", value: Math.round(results.recommendation.power * 100) + "%" },
                        { label: "Cost", value: compactRupees(results.recommendation.expected_cost_paise).replace("INR ", "") },
                      ].map((item) => (
                        <div key={item.label} className="min-w-28 rounded-2xl bg-white/[0.07] px-4 py-3 ring-1 ring-white/10 dark:bg-surface dark:ring-0">
                          <dt className="text-[12px] text-white/55 dark:text-muted-foreground">{item.label}</dt>
                          <dd className="font-display text-lg font-semibold tracking-tight tabular-nums">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              </section>

              <Panel
                title="How each design behaves"
                description="A design below the target power is not a cheaper pilot. It is a pilot whose result you will not be able to interpret."
              >
                <Tabs defaultValue="curve" className="gap-4">
                  <TabsList>
                    <TabsTrigger value="curve">Detection curve</TabsTrigger>
                    <TabsTrigger value="space">Cost and power</TabsTrigger>
                  </TabsList>
                  <TabsContent value="curve" className="flex flex-col gap-3">
                    <PowerCurveChart
                      designs={series}
                      alpha={alpha}
                      targetPower={targetPower}
                      expectedEffect={claimed * realism}
                      claimedEffect={claimed}
                      unit={unit}
                    />
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                      The chance each design detects a true improvement of a given size in {unit}. Curves are the closed-form approximation from each design&apos;s smallest
                      detectable change; the headline figures come from the {results.iterations.toLocaleString("en-IN")}-run simulation. The realistic effect is the claim
                      of {decimal(claimed, 2)} shrunk by the realism factor of {decimal(realism, 2)}.
                    </p>
                  </TabsContent>
                  <TabsContent value="space" className="flex flex-col gap-3">
                    <DesignSpaceChart designs={series} budgetPaise={budget} targetPower={targetPower} />
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                      Expected cost in lakh against power. The shaded green area is where a design is both strong enough and affordable.
                    </p>
                  </TabsContent>
                </Tabs>
              </Panel>

              <Panel title="Designs side by side" flush>
                <Table containerClassName="border-t border-border/70">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5 md:pl-6">Design</TableHead>
                      <TableHead className="min-w-36">Power</TableHead>
                      <TableHead className="text-right">Detects</TableHead>
                      <TableHead className="text-right">Expected cost</TableHead>
                      <TableHead className="pr-5 md:pr-6">In budget</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.comparison.map((design, index) => {
                      const tone = powerTone(design.power);
                      const color = series[index]?.color;
                      return (
                        <TableRow key={design.label + index} className={design.label === "Recommended design" ? "bg-brand/[0.04]" : undefined}>
                          <TableCell className="pl-5 font-medium whitespace-nowrap md:pl-6">
                            <span className="flex items-start gap-2">
                              <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: color }} />
                              <span className="flex flex-col">
                                {design.label}
                                <span className="text-[12px] font-normal text-muted-foreground tabular-nums">
                                  {design.duration_weeks} weeks, {design.units} units
                                </span>
                              </span>
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <Meter value={design.power * 100} tone={tone} className="w-16" label={design.label + " power"} />
                              <span className="tabular-nums">{Math.round(design.power * 100)}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{decimal(design.minimum_detectable_effect, 2)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap tabular-nums">
                            <div>{compactRupees(design.expected_cost_paise)}</div>
                            <div className="text-[12px] text-muted-foreground">
                              {compactRupees(design.cost_p5_paise).replace("INR ", "")} to {compactRupees(design.cost_p95_paise).replace("INR ", "")}
                            </div>
                          </TableCell>
                          <TableCell className="pr-5 md:pr-6">
                            {design.within_budget ? <ToneBadge tone="success">Yes</ToneBadge> : <ToneBadge tone="destructive">No</ToneBadge>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className="border-t border-border/70 px-5 py-4 text-[12px] leading-relaxed text-muted-foreground md:px-6">
                  Engine {results.engine_version}, {results.grid_searched} candidate designs screened in {results.runtime_ms} milliseconds with seed{" "}
                  <span className="font-mono">{results.seed}</span>, so the result can be reproduced exactly. The closed-form power for the proposed design is{" "}
                  {percent(results.analytical_power)}, within {decimal(results.analytical_gap * 100, 1)} percentage points of the simulated figure.
                </p>
              </Panel>

              {canDesign && !frozen ? (
                <Panel
                  title="Freeze the design"
                  description="Freezing pre-registers the plan. After this the success bar cannot move, which is what makes the result at the end defensible."
                >
                  <form action={freezeDesign} className="flex flex-col gap-5">
                    <input type="hidden" name="pilot_id" value={pilot.id} />
                    <input type="hidden" name="simulation_run_id" value={run?.id ?? ""} />
                    <input type="hidden" name="comparison_units" value={Number(inputs.comparison_units ?? 0)} />
                    <input type="hidden" name="alpha" value={Number(inputs.alpha ?? 0.05)} />
                    <div className="grid gap-4 sm:grid-cols-3">
                      <TextField
                        id="freeze_duration"
                        label="Weeks"
                        name="duration_weeks"
                        type="number"
                        min={1}
                        max={52}
                        required
                        defaultValue={results.recommendation?.duration_weeks ?? results.proposed.duration_weeks}
                      />
                      <TextField
                        id="freeze_units"
                        label="Units"
                        name="units"
                        type="number"
                        min={2}
                        max={500}
                        required
                        defaultValue={results.recommendation?.units ?? results.proposed.units}
                      />
                      <TextField
                        id="freeze_frequency"
                        label="Measurements per week"
                        name="measurements_per_week"
                        type="number"
                        min={1}
                        max={7}
                        defaultValue={Number(inputs.measurements_per_week ?? 1)}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField
                        label="Pass mark"
                        name="pass_mark"
                        type="number"
                        step="any"
                        required
                        defaultValue={defaults?.primary_kpi.target_value ?? ""}
                        hint={"The value on " + (defaults?.primary_kpi.name ?? "the primary measure") + " the pilot must reach to count as a success."}
                      />
                      <SelectField
                        label="Analysis method"
                        name="analysis_method"
                        required
                        defaultValue={
                          Number(inputs.comparison_units ?? 0) > 0 ? "welch_did" : defaults?.primary_kpi.kind === "proportion" ? "two_proportion" : "paired_t"
                        }
                        options={Object.entries(ANALYSIS_METHOD_LABELS).map(([value, label]) => ({ value, label }))}
                      />
                    </div>
                    <ConfirmCheckbox
                      name="acknowledge"
                      label="I confirm this plan is final"
                      help="The primary measure, pass mark, duration, unit count and analysis method are locked once frozen. Changing any of them afterwards requires an amendment approved by the competent authority, and every amendment costs protocol adherence points on the Evidence Confidence Score."
                    />
                    <SubmitButton
                      variant="brand"
                      size="lg"
                      className="self-start"
                      pendingLabel="Freezing"
                      confirmTitle="Freeze this design?"
                      confirm="After freezing, the plan can only change through a recorded, approved amendment."
                    >
                      <Lock />
                      Freeze the design
                    </SubmitButton>
                  </form>
                </Panel>
              ) : null}
            </>
          ) : !run ? (
            <EmptyState
              icon={FlaskConical}
              title="No simulation has run yet"
              description="Set the design on the right and run it. The simulator plays the whole pilot ten thousand times and tells you how often it would detect a real improvement."
            />
          ) : null}

          {runs && runs.items.length > 1 ? (
            <Panel title="Earlier runs" description="Every run stores its inputs and its seed, so any result can be reproduced." flush>
              <ul className="divide-y divide-border/70 border-t border-border/70">
                {runs.items.map((item) => {
                  const current = item.id === run?.id;
                  return (
                    <li key={item.id}>
                      <Link
                        href={"/pilots/" + pilot.id + "/design?run=" + item.id}
                        aria-current={current ? "true" : undefined}
                        className={cn(
                          "flex items-center gap-4 px-5 py-3 text-sm transition-colors hover:bg-surface/70 focus-visible:bg-surface focus-visible:outline-none md:px-6",
                          current && "bg-surface/60",
                        )}
                      >
                        <History className="size-4 shrink-0 text-glyph" />
                        <span className="font-mono text-[12px] text-muted-foreground">{item.id.slice(0, 8)}</span>
                        <span className="hidden text-muted-foreground sm:inline">{formatDateTime(item.created_at)}</span>
                        <span className="ml-auto flex items-center gap-3">
                          {item.power === null ? (
                            <span className="text-muted-foreground">{item.status}</span>
                          ) : (
                            <>
                              <Meter value={item.power * 100} tone={powerTone(item.power)} className="hidden w-20 sm:block" label="Power" />
                              <span className="w-10 text-right tabular-nums">{Math.round(item.power * 100)}%</span>
                            </>
                          )}
                          {current ? <ToneBadge tone="brand">Showing</ToneBadge> : <ArrowRight className="size-4 text-glyph" />}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          {defaults ? (
            <section className="flex flex-col gap-5 rounded-3xl bg-card p-5 shadow-card md:p-6">
              <div className="flex flex-col gap-1">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-ink">
                  <FlaskConical className="size-3.5" />
                  Run a simulation
                </span>
                <h2 className="font-display text-lg font-semibold tracking-tight">{defaults.primary_kpi.name}</h2>
                <p className="text-[13px] text-muted-foreground">
                  In {defaults.primary_kpi.unit}. The simulator runs the whole pilot ten thousand times.
                </p>
              </div>

              <form action={runSimulation} className="flex flex-col gap-5">
                <input type="hidden" name="pilot_id" value={pilot.id} />

                <FieldGroup title="The design">
                  <div className="grid grid-cols-2 gap-3">
                    <TextField label="Weeks" name="duration_weeks" type="number" min={1} max={52} required defaultValue={Number(inputs.duration_weeks ?? 8)} />
                    <TextField label="Units" name="units" type="number" min={2} max={500} required defaultValue={Number(inputs.units ?? 20)} />
                  </div>
                  <p className="-mt-1 text-[12px] text-muted-foreground">Units are sites, wards, facilities or cases.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <TextField label="Per week" name="measurements_per_week" type="number" min={1} max={7} defaultValue={Number(inputs.measurements_per_week ?? 1)} />
                    <TextField label="Shortest run" name="min_duration_weeks" type="number" min={1} max={52} defaultValue={Number(inputs.min_duration_weeks ?? 4)} />
                  </div>
                  <p className="-mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    Measuring more often reduces noise. The recommendation never goes below the shortest pilot you would run, in weeks.
                  </p>
                </FieldGroup>

                <FieldGroup title="Baseline and claim">
                  <div className="grid grid-cols-2 gap-3">
                    <TextField label="Baseline" name="baseline_mean" type="number" step="any" defaultValue={Number(inputs.baseline_mean ?? 0)} />
                    <TextField label="Variability" name="baseline_sd" type="number" step="any" min={0.0001} defaultValue={Number(inputs.baseline_sd ?? 1)} />
                  </div>
                  <TextField
                    label="Improvement claimed"
                    name="claimed_effect"
                    type="number"
                    step="any"
                    defaultValue={Number(inputs.claimed_effect ?? 0)}
                    hint="Signed. Negative when lower is better. Variability is the spread across units, not the average."
                  />
                </FieldGroup>

                <FieldGroup title="Comparison and cost">
                  <TextField
                    label="Comparison units"
                    name="comparison_units"
                    type="number"
                    min={0}
                    max={500}
                    defaultValue={Number(inputs.comparison_units ?? 0)}
                    hint="Similar units not receiving the solution. Zero if none are available."
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <TextField
                      label="Per unit per week, INR"
                      name="cost_per_unit_week_rupees"
                      type="number"
                      min={0}
                      defaultValue={Number(inputs.cost_per_unit_week_paise ?? 0) / 100}
                    />
                    <TextField label="Fixed cost, INR" name="fixed_cost_rupees" type="number" min={0} defaultValue={Number(inputs.fixed_cost_paise ?? 0) / 100} />
                  </div>
                </FieldGroup>

                <Disclosure summary="Model assumptions">
                  <div className="flex flex-col gap-4 pt-1">
                    <TextField
                      label="Realism factor"
                      name="realism_factor"
                      type="number"
                      step="0.05"
                      min={0.05}
                      max={1}
                      defaultValue={Number(inputs.realism_factor ?? 0.7)}
                      hint="Claimed effects are usually optimistic. 0.7 assumes 70 percent of the claim is real. Set to 1 only with independent evidence."
                    />
                    <TextField
                      label="Uncertainty in the claim"
                      name="effect_uncertainty"
                      type="number"
                      step="0.05"
                      min={0}
                      max={1}
                      defaultValue={Number(inputs.effect_uncertainty ?? 0.25)}
                      hint="As a share of the claimed effect."
                    />
                    <TextField
                      label="Share of variation that is period to period"
                      name="within_unit_share"
                      type="number"
                      step="0.05"
                      min={0.05}
                      max={0.95}
                      defaultValue={Number(inputs.within_unit_share ?? 0.5)}
                      hint="The rest is stable difference between units, which cancels in a paired design."
                    />
                    <SelectField
                      label="How confident are you in the baseline?"
                      name="baseline_confidence"
                      defaultValue={String(inputs.baseline_confidence ?? "measured")}
                      options={[
                        { value: "measured", label: "Measured from real data" },
                        { value: "estimated_high", label: "Estimated, fairly confident" },
                        { value: "estimated_low", label: "Estimated, not confident" },
                      ]}
                      hint="An estimated baseline inflates the assumed noise, so the simulator does not flatter a design built on a guess."
                    />
                  </div>
                </Disclosure>

                <Disclosure summary="Compare up to three other designs" defaultOpen>
                  <div className="flex flex-col gap-2 pt-1">
                    <div className="grid grid-cols-[2rem_1fr_1fr] gap-2 px-1 text-[12px] font-medium text-muted-foreground">
                      <span />
                      <span>Weeks</span>
                      <span>Units</span>
                    </div>
                    {[0, 1, 2].map((index) => (
                      <div key={index} className="grid grid-cols-[2rem_1fr_1fr] items-center gap-2">
                        <span className="grid size-6 place-items-center rounded-full bg-card text-[11px] font-semibold text-muted-foreground tabular-nums shadow-lift">
                          {index + 1}
                        </span>
                        <input
                          aria-label={"Option " + (index + 1) + " weeks"}
                          id={"what_if_weeks_" + index}
                          name="what_if_weeks"
                          type="number"
                          min={1}
                          max={52}
                          defaultValue={index === 0 ? 12 : ""}
                          className="h-9 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
                        />
                        <input
                          aria-label={"Option " + (index + 1) + " units"}
                          id={"what_if_units_" + index}
                          name="what_if_units"
                          type="number"
                          min={2}
                          max={500}
                          defaultValue={index === 0 ? 30 : ""}
                          className="h-9 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
                        />
                      </div>
                    ))}
                  </div>
                </Disclosure>

                <SubmitButton variant="brand" size="lg" className="w-full" pendingLabel="Running ten thousand pilots">
                  <FlaskConical />
                  Run ten thousand pilots
                </SubmitButton>
              </form>

              <ul className="flex flex-col gap-2 border-t border-border/70 pt-4">
                {defaults.guidance.map((line) => (
                  <li key={line} className="flex gap-2 text-[12px] leading-relaxed text-muted-foreground">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-glyph" />
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <Callout tone="warning" title="This pilot cannot be simulated yet">
              The challenge needs a primary measure with a baseline and a target, and the proposal needs a committed value, before a design can be tested.
            </Callout>
          )}
        </aside>
      </div>
    </Page>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

/** The p5 to p95 cost band drawn against the budget ceiling. */
function CostRange({ design, budget }: { design: DesignOutcome; budget: number | null }) {
  const scale = Math.max(budget ?? 0, design.cost_p95_paise) * 1.08 || 1;
  const left = (design.cost_p5_paise / scale) * 100;
  const width = ((design.cost_p95_paise - design.cost_p5_paise) / scale) * 100;
  const mid = (design.expected_cost_paise / scale) * 100;
  const ceiling = budget ? (budget / scale) * 100 : null;
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="relative h-2 rounded-full bg-recess" aria-hidden>
        <div className="absolute inset-y-0 rounded-full bg-brand/35" style={{ left: left + "%", width: width + "%" }} />
        <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-brand" style={{ left: mid + "%" }} />
        {ceiling !== null && <div className="absolute -inset-y-1 w-0.5 rounded-full bg-destructive" style={{ left: ceiling + "%" }} />}
      </div>
      <span className="text-[12px] text-muted-foreground">
        Between {compactRupees(design.cost_p5_paise)} and {compactRupees(design.cost_p95_paise)}
        {budget ? ", red line is the ceiling" : ""}
      </span>
    </div>
  );
}
