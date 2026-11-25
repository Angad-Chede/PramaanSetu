import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, CircleSlash, Download, FileJson, Landmark, Repeat, Scale, ShieldAlert, TrendingUp, X } from "lucide-react";

import { projectScale, recordDecision } from "@/app/pilots/actions";
import { CheckField, Disclosure, SubmitButton, TextAreaField, TextField } from "@/components/app/forms";
import { Callout, Flash, KeyValues, LinkButton, Page, PageHeader, Panel, ToneBadge, type Tone, bandToneOf } from "@/components/app/kit";
import { Gauge } from "@/components/ui/gauge";
import { all, apiGetOptional, apiGetOrNotFound, apiPost } from "@/lib/api";
import { compactRupees, decimal, formatDateTime, money, signed } from "@/lib/format";
import { single } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { EvidenceReport, Pilot } from "@/lib/types";

import { ECS_THRESHOLDS, ForestPlot } from "../_run/stats";

export const metadata: Metadata = { title: "Pathway and decision" };
export const dynamic = "force-dynamic";

type Route = { code: string; name: string; rationale: string; conditions: string[]; reference: string };

type Pathway = {
  recommended: Route;
  alternatives: Route[];
  rule_inputs: Record<string, unknown>;
  caveat: string;
  marketplace: { category: string; listed: boolean; qualified_vendor_count: number; detail: string };
};

type Dependency = {
  score: number;
  level: string;
  exit_plan_required: boolean;
  message: string;
  factors: { code: string; label: string; weight: number; present: boolean; mitigation: string }[];
};

type Projection = {
  units: number;
  total_cost_paise: number;
  benefit_low: number;
  benefit_expected: number;
  benefit_high: number;
  benefit_unit: string;
  monetised_low_paise: number | null;
  monetised_expected_paise: number | null;
  monetised_high_paise: number | null;
  payback_months: number | null;
  assumptions: string[];
  measure?: string;
  effect_used?: { low: number; expected: number; high: number };
  note?: string;
};

type Decision = {
  decision: string;
  reason: string;
  estimated_value: { paise: number; display: string };
  pathway: Pathway | Record<string, never>;
  vendor_dependency: Dependency | Record<string, never>;
  scale_projection?: Projection | Record<string, never>;
  handoff_file_id: string | null;
  decided_at: string;
};

const DECISIONS: { value: string; title: string; detail: string; icon: typeof TrendingUp; tone: Tone }[] = [
  { value: "Scale", title: "Scale", detail: "Take this to procurement on the recommended route.", icon: TrendingUp, tone: "success" },
  { value: "ExtendPilot", title: "Extend the pilot", detail: "Gather more evidence before committing.", icon: Repeat, tone: "warning" },
  { value: "Close", title: "Close", detail: "Do not proceed on this evidence.", icon: CircleSlash, tone: "neutral" },
];

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DecisionPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [session, pilot, report, existing] = await all(
    requireSession("/pilots/" + id + "/decision"),
    apiGetOrNotFound<Pilot>("/pilots/" + id),
    apiGetOptional<EvidenceReport>("/pilots/" + id + "/evidence"),
    apiGetOptional<Decision>("/pilots/" + id + "/decision"),
  );

  const estimatedValue = Number(single(query.value) ?? 0);
  const units = Number(single(query.units) ?? 0);
  const costPerUnit = Number(single(query.cost) ?? 0);

  const validated = Boolean(report && report.status.startsWith("SignedOff"));
  const canDecide = hasRole(session, "DA") && session.department_id === pilot.department_id;
  const analysis = report?.analysis ?? {};

  // the projection is pure arithmetic on the validated interval, so it is run on request
  const [pathway, dependency, projection] = await all(
    validated ? apiGetOptional<Pathway>("/pilots/" + id + "/pathway?estimated_value_rupees=" + (estimatedValue || 0)) : Promise.resolve(null),
    validated ? apiGetOptional<Dependency>("/pilots/" + id + "/vendor-dependency") : Promise.resolve(null),
    validated && canDecide && units > 0
      ? apiPost<Projection>("/pilots/" + id + "/scale-simulations", {
          units,
          cost_per_unit_rupees: costPerUnit,
          value_per_effect_unit_rupees: estimatedValue,
        }).catch((): Projection | null => null)
      : Promise.resolve<Projection | null>(null),
  );
  const storedProjection = existing?.scale_projection && "units" in existing.scale_projection ? (existing.scale_projection as Projection) : null;
  const recorded = existing ? DECISIONS.find((d) => d.value === existing.decision) : undefined;

  return (
    <Page>
      <PageHeader
        back={{ href: "/pilots/" + pilot.id, label: "Pilot " + pilot.reference }}
        eyebrow="Scale decision"
        title="Procurement pathway and decision"
        description="A route is recommended from the rule inputs shown. The final choice rests with the competent authority, advised by the department legal and finance cells."
        meta={
          <>
            {report ? (
              <ToneBadge tone={bandToneOf(report.band)}>
                Evidence {decimal(report.confidence_score ?? 0, 1)} of 100, {report.band ?? "no band"}
              </ToneBadge>
            ) : (
              <ToneBadge tone="warning">No Evidence Report</ToneBadge>
            )}
            {existing && <ToneBadge tone="success">Decision recorded: {recorded?.title ?? existing.decision}</ToneBadge>}
          </>
        }
      />

      <Flash searchParams={query} />

      {!validated && (
        <Panel>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-warning/12 text-warning-ink">
                <ShieldAlert className="size-5" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="font-display text-[17px] font-semibold tracking-tight">A scale decision needs a signed-off Evidence Report</p>
                <p className="text-sm text-muted-foreground">
                  {report ? `The report for this pilot is ${report.status.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}.` : "No Evidence Report has been produced for this pilot yet."} The
                  platform enforces this rule, not just the interface.
                </p>
              </div>
            </div>
            <LinkButton href={"/pilots/" + pilot.id + "/evidence"} variant="outline" className="shrink-0">
              Open the Evidence Report
              <ArrowRight />
            </LinkButton>
          </div>
        </Panel>
      )}

      {existing && (
        <Panel className="animate-enter [animation-delay:60ms]">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-4">
                <span
                  className={cn(
                    "grid size-14 shrink-0 place-items-center rounded-2xl",
                    recorded?.tone === "success" ? "bg-success/12 text-success-ink" : recorded?.tone === "warning" ? "bg-warning/14 text-warning-ink" : "bg-surface text-glyph",
                  )}
                >
                  {recorded ? <recorded.icon className="size-6" /> : <Scale className="size-6" />}
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-medium text-muted-foreground">The decision on record</span>
                  <span className="font-serif text-[32px] font-normal tracking-[-0.025em]">{recorded?.title ?? existing.decision}</span>
                  <span className="text-[13px] text-muted-foreground">Recorded {formatDateTime(existing.decided_at)}</span>
                </div>
              </div>
              <div className="flex flex-col md:items-end">
                <span className="text-[13px] font-medium text-muted-foreground">Estimated scale-up value</span>
                <span className="font-serif text-[32px] font-normal tracking-[-0.025em] tabular-nums">{compactRupees(existing.estimated_value.paise).replace("INR ", "₹ ")}</span>
                <span className="text-[13px] text-muted-foreground tabular-nums">{money(existing.estimated_value)}</span>
              </div>
            </div>
            <div className="rounded-2xl bg-surface/60 p-4 md:p-5">
              <p className="mb-1.5 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Reasons</p>
              <p className="text-[15px] leading-relaxed whitespace-pre-line text-pretty">{existing.reason}</p>
            </div>
            {existing.handoff_file_id && (
              <div className="flex flex-col gap-3 rounded-2xl bg-brand/[0.06] p-4 ring-1 ring-brand/15 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Procurement handoff pack</span>
                  <span className="text-[13px] text-muted-foreground">Challenge, agreement, Evidence Report, route and an outcome-based specification.</span>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <LinkButton href={"/api/v1/pilots/" + pilot.id + "/handoff.pdf"} variant="brand" external>
                    <Download />
                    Download the pack
                  </LinkButton>
                  <LinkButton href={"/api/v1/pilots/" + pilot.id + "/handoff.json"} variant="outline" external>
                    <FileJson />
                    JSON
                  </LinkButton>
                </div>
              </div>
            )}
            {storedProjection && <ProjectionView projection={storedProjection} title="Rollout projection on record" />}
          </div>
        </Panel>
      )}

      {validated && report && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-6">
            {pathway && (
              <Panel title="Recommended procurement route" description="Generated from the rule inputs below.">
                <div className="flex flex-col gap-5">
                  <div className="relative overflow-hidden rounded-2xl bg-brand/[0.06] p-5 ring-1 ring-brand/25">
                    <div className="flex items-start gap-4">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-brand-foreground shadow-lift">
                        <Landmark className="size-5" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-2">
                        <h3 className="font-display text-lg leading-snug font-semibold tracking-tight text-balance">{pathway.recommended.name}</h3>
                        <p className="text-sm text-muted-foreground">{pathway.recommended.rationale}</p>
                      </div>
                    </div>
                    {pathway.recommended.conditions.length > 0 && (
                      <ul className="mt-4 flex flex-col gap-2 border-t border-brand/15 pt-4">
                        {pathway.recommended.conditions.map((condition) => (
                          <li key={condition} className="flex gap-2.5 text-sm">
                            <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                            {condition}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-4 text-[12px] text-muted-foreground">Reference: {pathway.recommended.reference}</p>
                  </div>

                  <Disclosure summary="Rule inputs and the other routes considered">
                    <div className="flex flex-col gap-5 pt-1">
                      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-border/70 sm:grid-cols-2">
                        {Object.entries(pathway.rule_inputs).map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between gap-3 bg-card px-3 py-2.5">
                            <dt className="text-[13px] text-muted-foreground first-letter:uppercase">{key.replace(/_paise$/, "").replace(/_/g, " ")}</dt>
                            <dd className="text-[13px] font-medium text-foreground tabular-nums">{key.endsWith("paise") ? compactRupees(Number(value)) : String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="text-[13px]">
                        Marketplace check: {pathway.marketplace.detail} ({pathway.marketplace.listed ? "listed" : "not listed"}, {pathway.marketplace.qualified_vendor_count} qualified
                        vendor{pathway.marketplace.qualified_vendor_count === 1 ? "" : "s"}).
                      </p>
                      {pathway.alternatives.length > 0 && (
                        <ul className="flex flex-col gap-3">
                          {pathway.alternatives.map((option) => (
                            <li key={option.code} className="rounded-xl bg-card p-4">
                              <p className="font-medium text-foreground">{option.name}</p>
                              <p className="mt-1 text-[13px]">{option.rationale}</p>
                              <p className="mt-1.5 text-[12px] opacity-80">Reference: {option.reference}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </Disclosure>

                  <Callout tone="neutral">{pathway.caveat}</Callout>
                </div>
              </Panel>
            )}

            {dependency && (
              <Panel
                title="Vendor Dependency Score"
                description="Higher means more dependency. Above 60, an exit plan must be on record before a scale decision can be approved."
              >
                <div className="grid items-center gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
                  <div className="flex flex-col items-center">
                    <Gauge
                      value={dependency.score}
                      max={100}
                      size={180}
                      thickness={12}
                      target={60}
                      thresholds={[
                        { upTo: 30, tone: "success" },
                        { upTo: 60, tone: "warning" },
                        { upTo: 100, tone: "destructive" },
                      ]}
                      label={dependency.level + " dependency"}
                    />
                  </div>
                  <div className="flex flex-col gap-3">
                    <p className="text-[15px] leading-relaxed text-pretty">{dependency.message}</p>
                    {dependency.exit_plan_required && <ToneBadge tone="destructive">Exit plan required</ToneBadge>}
                  </div>
                </div>
                <ul className="mt-6 flex flex-col divide-y divide-border/70 border-t border-border/70">
                  {dependency.factors.map((factor) => (
                    <li key={factor.code} className="flex gap-3 py-3.5">
                      <span
                        className={cn(
                          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
                          factor.present ? "bg-destructive/12 text-destructive-ink" : "bg-success/12 text-success-ink",
                        )}
                      >
                        {factor.present ? <X className="size-3.5" strokeWidth={2.5} /> : <Check className="size-3.5" strokeWidth={2.5} />}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-sm font-medium">{factor.label}</span>
                          <span className={cn("shrink-0 text-[13px] tabular-nums", factor.present ? "font-semibold text-destructive-ink" : "text-muted-foreground")}>
                            {factor.present ? "+" : ""}
                            {factor.weight}
                          </span>
                        </div>
                        <span className="text-[13px] text-muted-foreground">
                          {factor.present ? factor.mitigation || "No mitigation recorded" : "Not present"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {canDecide && (
              <Panel title="Project the rollout" description="The conservative case uses the cautious end of the validated interval. Plan against that case, not the optimistic one.">
                <form action={projectScale} className="flex flex-col gap-4">
                  <input type="hidden" name="pilot_id" value={pilot.id} />
                  <div className="grid gap-4 sm:grid-cols-3">
                    <TextField label="Units to roll out to" name="units" type="number" min={1} defaultValue={units || 96} />
                    <TextField label="Cost per unit, rupees" name="cost_per_unit_rupees" type="number" min={0} defaultValue={costPerUnit || 185000} />
                    <TextField
                      label="Value per unit of change"
                      name="value_per_effect_unit_rupees"
                      type="number"
                      min={0}
                      defaultValue={42000}
                      hint="Optional, in rupees. Monetises the benefit."
                    />
                  </div>
                  <div>
                    <SubmitButton variant="secondary" pendingLabel="Projecting">
                      Project the rollout
                    </SubmitButton>
                  </div>
                </form>
                {projection && <ProjectionView projection={projection} title="Projection" className="mt-6" />}
              </Panel>
            )}

            {canDecide && !existing && (
              <Panel title="Record the decision" description="Every decision is recorded with its reasons and appears in the audit trail.">
                <form action={recordDecision} className="flex flex-col gap-5">
                  <input type="hidden" name="pilot_id" value={pilot.id} />
                  {projection && <input type="hidden" name="scale_projection" value={JSON.stringify(projection)} />}

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">Decision</legend>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {DECISIONS.map((option) => (
                        <label
                          key={option.value}
                          className="group relative flex cursor-pointer flex-col gap-2 rounded-2xl bg-surface p-4 ring-1 ring-transparent transition-[background-color,box-shadow] duration-200 ease-ios hover:bg-surface-hover has-checked:bg-card has-checked:shadow-lift has-checked:ring-2 has-checked:ring-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring"
                        >
                          <input type="radio" name="decision" value={option.value} defaultChecked={option.value === "Scale"} required className="peer sr-only" />
                          <option.icon className="size-5 text-glyph group-has-checked:text-foreground" />
                          <span className="text-sm font-semibold">{option.title}</span>
                          <span className="text-[13px] leading-snug text-muted-foreground">{option.detail}</span>
                          <span className="absolute top-3.5 right-3.5 grid size-5 place-items-center rounded-full ring-1 ring-border group-has-checked:bg-foreground group-has-checked:ring-foreground">
                            <Check className="size-3 text-background opacity-0 group-has-checked:opacity-100" strokeWidth={3} />
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <TextAreaField label="Reasons" name="reason" rows={5} required minLength={20} hint="At least 20 characters. State what in the evidence led to this decision." />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label="Estimated scale-up value, rupees"
                      name="estimated_value_rupees"
                      type="number"
                      min={0}
                      defaultValue={estimatedValue || 28000000}
                      required
                    />
                    <TextField label="Qualified vendors for this category" name="qualified_vendor_count" type="number" min={0} optional hint="Leave blank to use the marketplace check." />
                  </div>

                  {dependency?.exit_plan_required && (
                    <div className="rounded-2xl bg-warning/10 px-4 py-3.5">
                      <CheckField
                        name="exit_plan_on_record"
                        label="An exit plan is on record for this solution"
                        hint={`Required because the Vendor Dependency Score is ${dependency.score}, above the threshold of 60.`}
                      />
                    </div>
                  )}

                  <Callout tone="info" title="What recording a Scale decision does">
                    It produces a procurement handoff pack with the challenge, the agreement, the Evidence Report, the pathway recommendation and an outcome-based
                    specification, as a PDF and as JSON for the marketplace adapter. The specification names no product and no vendor.
                  </Callout>

                  <div>
                    <SubmitButton
                      variant="brand"
                      size="lg"
                      pendingLabel="Recording"
                      confirmTitle="Record this decision?"
                      confirm="It appears in the audit trail and, for a Scale decision, produces the procurement handoff pack."
                    >
                      Record the decision
                    </SubmitButton>
                  </div>
                </form>
              </Panel>
            )}
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
            <Panel title="What the pilot measured">
              <div className="flex flex-col gap-5">
                <div className="flex justify-center">
                  <Gauge
                    value={report.confidence_score ?? 0}
                    max={100}
                    decimals={1}
                    size={180}
                    thickness={12}
                    thresholds={ECS_THRESHOLDS}
                    label="Evidence Confidence Score"
                    caption={report.band ? report.band + " band" : "No band issued"}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] text-muted-foreground">{String(analysis.primary_kpi_name ?? "")}</span>
                  <span className="font-serif text-[30px] font-normal tracking-[-0.025em] tabular-nums">
                    {signed(Number(analysis.effect), 3)} <span className="text-sm font-normal text-muted-foreground">{String(analysis.primary_kpi_unit ?? "")}</span>
                  </span>
                </div>
                {Number.isFinite(Number(analysis.ci_low)) && (
                  <div className="rounded-xl bg-surface/60 px-3 py-2">
                    <ForestPlot compact effect={Number(analysis.effect)} low={Number(analysis.ci_low)} high={Number(analysis.ci_high)} direction={String(analysis.effect_direction ?? "lower")} />
                    <p className="mt-1 text-center text-[11px] text-muted-foreground tabular-nums">
                      95 percent interval {decimal(Number(analysis.ci_low), 3)} to {decimal(Number(analysis.ci_high), 3)}
                    </p>
                  </div>
                )}
                <KeyValues
                  columns={2}
                  items={[
                    { label: "Band", value: report.band ?? "Not issued" },
                    { label: "Validator", value: report.validator_name ?? "Recorded" },
                  ]}
                />
                <Link href={"/pilots/" + pilot.id + "/evidence"} className="group inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
                  Open the Evidence Report
                  <ArrowRight className="size-3.5 transition-transform duration-200 ease-ios group-hover:translate-x-0.5" />
                </Link>
              </div>
            </Panel>
          </aside>
        </div>
      )}
    </Page>
  );
}

function ProjectionView({ projection, title, className }: { projection: Projection; title: string; className?: string }) {
  const cases = [
    { key: "low", label: "Conservative", benefit: projection.benefit_low, money: projection.monetised_low_paise, note: "Plan against this", highlight: true },
    { key: "expected", label: "Expected", benefit: projection.benefit_expected, money: projection.monetised_expected_paise, note: "Point estimate" },
    { key: "high", label: "Optimistic", benefit: projection.benefit_high, money: projection.monetised_high_paise, note: "Upper bound" },
  ];
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-[15px] font-semibold tracking-tight">{title}</h3>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {projection.units} units · {compactRupees(projection.total_cost_paise)} rollout cost
          {projection.payback_months != null && <> · payback {decimal(projection.payback_months, 1)} months</>}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {cases.map((item) => (
          <div key={item.key} className={cn("flex flex-col gap-1 rounded-2xl p-4", item.highlight ? "bg-card shadow-lift ring-1 ring-foreground/10" : "bg-surface/70")}>
            <span className="flex items-center justify-between text-[12px] font-medium text-muted-foreground">
              {item.label}
              {item.highlight && <ToneBadge tone="brand" dot={false}>{item.note}</ToneBadge>}
            </span>
            <span className="font-serif text-[30px] font-normal tracking-[-0.025em] tabular-nums">{decimal(item.benefit, 1)}</span>
            <span className="text-[12px] leading-snug text-muted-foreground">{projection.benefit_unit}</span>
            {item.money != null && <span className="mt-1 text-[13px] font-medium tabular-nums">{compactRupees(item.money)} benefit</span>}
          </div>
        ))}
      </div>
      {projection.assumptions?.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted-foreground">
          {projection.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
