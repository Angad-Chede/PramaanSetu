import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, FileSignature, LineChart, Lock, PauseCircle, ShieldCheck, Wallet, XOctagon } from "lucide-react";

import { pilotTransition } from "@/app/pilots/actions";
import { Disclosure, SubmitButton, TextAreaField } from "@/components/app/forms";
import {
  Callout,
  Flash,
  Hash,
  KeyValues,
  LinkButton,
  Meter,
  Page,
  PageHeader,
  Panel,
  StateBadge,
  ToneBadge,
} from "@/components/app/kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { all, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import {
  ANALYSIS_METHOD_LABELS,
  IP_OPTION_LABELS,
  PILOT_STATE_LABELS,
  decimal,
  formatDate,
  formatDateTime,
  money,
  percent,
} from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import type { Pilot } from "@/lib/types";

import { LifecycleTrack } from "./_components/lifecycle";
import { pilotStages } from "./_components/stages";
import { TrendChart } from "./_components/trend-chart";

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

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function when(value: string | null | undefined) {
  return value ? formatDateTime(value) : <span className="text-muted-foreground">Not yet</span>;
}

function shortDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

export default async function PilotPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [session, pilot, dashboard] = await all(
    requireSession("/pilots/" + id),
    apiGetOrNotFound<Pilot>("/pilots/" + id),
    apiGetOptional<Dashboard>("/pilots/" + id + "/dashboard"),
  );

  const isDepartment = session.department_id === pilot.department_id;
  const isStartup = session.startup_id === pilot.startup_id;
  const actions = pilot.available_actions ?? [];
  const design = pilot.design;
  const agreement = pilot.agreement;
  const stages = pilotStages(pilot, {
    periodsCompleted: dashboard?.periods_completed,
    periodsPlanned: dashboard?.plan ? dashboard.periods_planned : undefined,
  });

  const canPause = isDepartment && actions.includes("pause") && hasRole(session, "DO");
  const canResume = isDepartment && actions.includes("resume") && hasRole(session, "DO");
  const canComplete = isDepartment && actions.includes("complete") && hasRole(session, "DO");
  const canTerminate = isDepartment && actions.includes("terminate") && hasRole(session, "DA");
  const showLifecycle = isDepartment && (actions.includes("pause") || actions.includes("resume") || actions.includes("complete") || actions.includes("terminate"));

  const kpi = dashboard?.primary_kpi ?? null;
  const baseline = kpi?.baseline_mean ?? null;
  const milestones = pilot.milestones ?? [];
  const paidPaise = milestones.filter((milestone) => milestone.state === "Paid").reduce((sum, milestone) => sum + milestone.amount_paise, 0);
  const totalPaise = pilot.total_value?.paise ?? milestones.reduce((sum, milestone) => sum + milestone.amount_paise, 0);
  const completeness = dashboard?.completeness_percent ?? 0;

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: isStartup ? "/my-pilots" : "/pilots", label: isStartup ? "My pilots" : "All pilots" }}
        eyebrow={
          <>
            <span className="font-mono text-[12px]">{pilot.reference}</span>
            <StateBadge state={pilot.state} labels={PILOT_STATE_LABELS} />
            {design ? (
              design.frozen ? (
                <ToneBadge tone="success" dot={false}>
                  <Lock className="size-3" />
                  Plan pre-registered
                </ToneBadge>
              ) : (
                <ToneBadge tone="warning">Plan not frozen</ToneBadge>
              )
            ) : (
              <ToneBadge tone="warning">No plan yet</ToneBadge>
            )}
          </>
        }
        title={pilot.challenge_title ?? "Pilot"}
        description={
          <>
            Run by <span className="font-medium text-foreground">{pilot.startup_name ?? "the startup"}</span>. Every measurement is compared against a plan frozen before any data was collected.
          </>
        }
        actions={
          <>
            <LinkButton href={"/pilots/" + pilot.id + "/metrics"} variant="secondary">
              <LineChart />
              Measurements
            </LinkButton>
            <LinkButton href={"/pilots/" + pilot.id + "/milestones"} variant="default">
              <Wallet />
              Milestones and payments
            </LinkButton>
          </>
        }
      />

      <Flash searchParams={query} />

      {pilot.state === "Paused" && (
        <Callout tone="warning" icon={PauseCircle} title="This pilot is paused">
          {pilot.pause_reason ?? "No reason was recorded."}
        </Callout>
      )}
      {pilot.state === "Terminated" && (
        <Callout tone="destructive" icon={XOctagon} title="This pilot was terminated">
          {pilot.termination_reason ?? "No reason was recorded."}
        </Callout>
      )}

      <LifecycleTrack stages={stages} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {dashboard && dashboard.plan ? (
            <Panel
              title="Progress against the pre-registered plan"
              description="The plan was frozen before data collection started, so the success bar cannot move after the results are seen."
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <ProgressFigure
                  label="Periods completed"
                  value={dashboard.periods_completed}
                  of={dashboard.periods_planned}
                  tone={dashboard.periods_completed >= dashboard.periods_planned ? "success" : "brand"}
                />
                <ProgressFigure
                  label="Measurements received"
                  value={dashboard.measurements_received}
                  of={dashboard.plan.planned_unit_periods}
                  tone={completeness >= 90 ? "success" : completeness >= 70 ? "warning" : "destructive"}
                />
                <div className="flex flex-col justify-between gap-3 rounded-2xl bg-surface/70 p-4">
                  <span className="text-[13px] font-medium text-muted-foreground">Data completeness</span>
                  <span className="font-display text-[26px] leading-none font-semibold tracking-tight tabular-nums">
                    {completeness}
                    <span className="text-base text-muted-foreground"> percent</span>
                  </span>
                  <ToneBadge tone={completeness >= 90 ? "success" : completeness >= 70 ? "warning" : "destructive"}>
                    {completeness >= 90 ? "Meets the 90 percent bar" : "Below 90 percent"}
                  </ToneBadge>
                </div>
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
                Completeness below 90 percent costs points in the Evidence Confidence Score and is stated as a limitation on the report.
              </p>

              {kpi && dashboard.trend.length ? (
                <div className="mt-6 flex flex-col gap-4">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className="font-display text-[15px] font-semibold tracking-tight">{kpi.name} by period</h3>
                      <p className="text-[13px] text-muted-foreground">
                        {kpi.unit}, {kpi.direction === "lower" ? "lower is better" : "higher is better"}
                      </p>
                    </div>
                    <ToneBadge tone="neutral" dot={false}>
                      Running view, not a result
                    </ToneBadge>
                  </div>
                  <TrendChart
                    unit={kpi.unit}
                    baseline={baseline}
                    passMark={dashboard.plan.pass_mark ?? null}
                    points={dashboard.trend.map((point) => ({ label: shortDate(point.period_start), mean: point.mean, units: point.units }))}
                  />
                  <Disclosure summary="Period by period figures">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Period starting</TableHead>
                          <TableHead className="text-right">Mean across units</TableHead>
                          <TableHead className="text-right">Units reporting</TableHead>
                          <TableHead className="text-right">Against baseline</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dashboard.trend.map((point) => {
                          const change = baseline !== null ? point.mean - baseline : null;
                          const better = change !== null && (kpi.direction === "lower" ? change < 0 : change > 0);
                          return (
                            <TableRow key={point.period_start}>
                              <TableCell className="whitespace-nowrap">{formatDate(point.period_start)}</TableCell>
                              <TableCell className="text-right tabular-nums">{decimal(point.mean, 2)}</TableCell>
                              <TableCell className="text-right tabular-nums">{point.units}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {change === null ? (
                                  <span className="text-muted-foreground">No baseline</span>
                                ) : (
                                  <span className={better ? "font-medium text-success-ink" : "text-foreground"}>
                                    {change > 0 ? "+" : ""}
                                    {decimal(change, 2)}
                                    {better ? " better" : ""}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Disclosure>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    The Evidence Report runs the analysis that was pre-registered, on the locked dataset, once the pilot is complete.
                  </p>
                </div>
              ) : null}
            </Panel>
          ) : null}

          <Panel
            title="The pre-registered plan"
            description="Frozen before data collection. Any change after that is an amendment, and every amendment costs protocol adherence points."
            action={
              <LinkButton href={"/pilots/" + pilot.id + "/design"} size="sm" variant="secondary">
                Open the simulator
              </LinkButton>
            }
          >
            {design ? (
              <div className="flex flex-col gap-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <PlanStat label="Primary measure" value={design.primary_kpi_name || "Not recorded"} />
                  <PlanStat label="Pass mark" value={decimal(design.pass_mark, 2)} hint={design.unit} accent />
                  <PlanStat
                    label="Expected power at freeze"
                    value={design.expected_power === null ? "Not recorded" : Math.round(design.expected_power * 100) + "%"}
                    hint={design.expected_power === null ? undefined : percent(design.expected_power)}
                  />
                </div>
                <KeyValues
                  columns={3}
                  items={[
                    { label: "Duration", value: design.duration_weeks + " weeks" },
                    { label: "Units", value: design.units },
                    { label: "Measurement frequency", value: design.measurements_per_week + " per week" },
                    { label: "Analysis method", value: ANALYSIS_METHOD_LABELS[design.analysis_method] ?? design.analysis_method, wide: false },
                    {
                      label: "Smallest detectable change",
                      value: design.minimum_detectable_effect === null ? "Not recorded" : decimal(design.minimum_detectable_effect, 2) + " " + design.unit,
                    },
                    { label: "Frozen", value: when(design.frozen_at) },
                  ]}
                />
                {design.amendments.length ? (
                  <Callout tone="warning" title="Amendments to the frozen plan">
                    <ul className="flex flex-col gap-1.5">
                      {design.amendments.map((amendment, index) => (
                        <li key={index}>
                          {amendment.description}{" "}
                          <span className="opacity-80">
                            ({amendment.approved ? "approved" : "not approved"}, {formatDate(amendment.at)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Callout>
                ) : (
                  <p className="text-[13px] text-muted-foreground">No amendments since the plan was frozen.</p>
                )}
              </div>
            ) : (
              <Callout tone="warning" title="No plan has been frozen">
                A pilot without a pre-registered plan cannot produce defensible evidence. Run the Pilot Flight Simulator and freeze a design before the pilot starts.
              </Callout>
            )}
          </Panel>

          <Panel
            title="The agreement"
            description="Every version is kept and diffable. Acceptance records the user, the time and the hash of the exact document accepted."
            action={
              <LinkButton href={"/pilots/" + pilot.id + "/agreement"} size="sm" variant="secondary">
                Open the agreement
              </LinkButton>
            }
          >
            {agreement ? (
              <KeyValues
                items={[
                  { label: "Version", value: agreement.number },
                  {
                    label: "Intellectual property",
                    value: agreement.ip_option ? IP_OPTION_LABELS[agreement.ip_option] ?? agreement.ip_option : "Not recorded",
                  },
                  { label: "Approved", value: when(agreement.approved_at) },
                  { label: "Accepted", value: when(agreement.accepted_at) },
                  { label: "Signature reference", value: agreement.esign_reference ?? "Not signed yet" },
                  { label: "Document hash", value: <Hash value={agreement.sha256 ?? null} /> },
                ]}
              />
            ) : (
              <Callout tone="warning" title="No agreement has been drafted">
                The officer drafts the agreement from the Template Kit, the approver approves it, and the startup accepts it. The pilot cannot start until then.
              </Callout>
            )}
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20 lg:self-start">
          <Panel title="The record">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-muted-foreground">Paid so far</span>
                  <span className="text-[13px] text-muted-foreground tabular-nums">
                    {totalPaise ? Math.round((paidPaise / totalPaise) * 100) : 0}%
                  </span>
                </div>
                <span className="font-display text-2xl font-semibold tracking-tight tabular-nums">{money({ paise: paidPaise })}</span>
                <Meter value={paidPaise} max={totalPaise || 1} tone="brand" label="Share of the pilot value paid" />
                <span className="text-[12px] text-muted-foreground tabular-nums">of {pilot.total_value ? money(pilot.total_value) : "a value not yet set"}</span>
              </div>
              <KeyValues
                columns={1}
                items={[
                  { label: "Reference", value: <span className="font-mono text-[13px]">{pilot.reference}</span> },
                  { label: "State", value: PILOT_STATE_LABELS[pilot.state] ?? pilot.state },
                  { label: "Startup", value: pilot.startup_name ?? "Not recorded" },
                  { label: "Started", value: when(pilot.started_at) },
                  { label: "Ended", value: when(pilot.ended_at) },
                  {
                    label: "Cybersecurity checklist",
                    value: pilot.cyber_completed_at ? (
                      <ToneBadge tone="success" dot={false}>
                        <ShieldCheck className="size-3" />
                        Complete
                      </ToneBadge>
                    ) : (
                      <ToneBadge tone="warning">Not complete</ToneBadge>
                    ),
                  },
                ]}
              />
            </div>
          </Panel>

          {dashboard?.next_milestone ? (
            <Link
              href={"/pilots/" + pilot.id + "/milestones"}
              className="group flex flex-col gap-3 rounded-3xl bg-card p-5 shadow-card outline-none transition-[translate,box-shadow] duration-200 ease-ios hover:-translate-y-0.5 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                  <CalendarClock className="size-3.5" />
                  Next milestone
                </span>
                <ArrowUpRight className="size-4 text-glyph transition-transform duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              <p className="font-medium text-foreground">
                <span className="text-muted-foreground tabular-nums">{dashboard.next_milestone.seq}.</span> {dashboard.next_milestone.title}
              </p>
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-muted-foreground">Due {formatDate(dashboard.next_milestone.due_date)}</span>
                <span className="font-medium tabular-nums">{money({ paise: dashboard.next_milestone.amount_paise })}</span>
              </div>
            </Link>
          ) : null}

          {milestones.length ? (
            <Panel title="Payment schedule" flush>
              <ol className="flex flex-col border-t border-border/70">
                {milestones.map((milestone) => (
                  <li key={milestone.id} className="flex items-center gap-3 border-b border-border/50 px-5 py-3 last:border-b-0">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {milestone.seq}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{milestone.title}</span>
                    <StateBadge state={milestone.overdue ? "Overdue" : milestone.state} labels={{ [milestone.state]: milestone.state_label, Overdue: "Overdue" }} />
                  </li>
                ))}
              </ol>
            </Panel>
          ) : null}

          {showLifecycle ? (
            <Panel title="Lifecycle actions" description="Every one of these is recorded with a reason.">
              <div className="flex flex-col gap-3">
                {canComplete ? (
                  <form action={pilotTransition}>
                    <input type="hidden" name="pilot_id" value={pilot.id} />
                    <input type="hidden" name="action" value="complete" />
                    <SubmitButton
                      className="w-full"
                      confirmTitle="Mark this pilot complete?"
                      confirm="The dataset is then analysed against the pre-registered plan."
                    >
                      Mark the pilot complete
                    </SubmitButton>
                  </form>
                ) : null}
                {canPause ? (
                  <Disclosure summary="Pause this pilot">
                    <form action={pilotTransition} className="flex flex-col gap-3 pt-1">
                      <input type="hidden" name="pilot_id" value={pilot.id} />
                      <input type="hidden" name="action" value="pause" />
                      <TextAreaField id="pause_reason" label="Reason for pausing" name="reason" rows={3} required minLength={10} />
                      <SubmitButton variant="secondary">Pause the pilot</SubmitButton>
                    </form>
                  </Disclosure>
                ) : null}
                {canResume ? (
                  <Disclosure summary="Resume this pilot">
                    <form action={pilotTransition} className="flex flex-col gap-3 pt-1">
                      <input type="hidden" name="pilot_id" value={pilot.id} />
                      <input type="hidden" name="action" value="resume" />
                      <TextAreaField id="resume_reason" label="Reason for resuming" name="reason" rows={3} required minLength={10} />
                      <SubmitButton variant="secondary">Resume the pilot</SubmitButton>
                    </form>
                  </Disclosure>
                ) : null}
                {canTerminate ? (
                  <Disclosure summary="Terminate under the exit clause">
                    <form action={pilotTransition} className="flex flex-col gap-3 pt-1">
                      <input type="hidden" name="pilot_id" value={pilot.id} />
                      <input type="hidden" name="action" value="terminate" />
                      <TextAreaField id="terminate_reason" label="Reason, citing the exit clause" name="reason" rows={3} required minLength={10} />
                      <SubmitButton
                        variant="destructive"
                        confirmTitle="Terminate this pilot?"
                        confirm="Milestones already accepted remain payable and the startup must hand over a data export within 15 days."
                      >
                        Terminate the pilot
                      </SubmitButton>
                    </form>
                  </Disclosure>
                ) : null}
              </div>
            </Panel>
          ) : null}

          {isStartup && actions.includes("request-changes") ? (
            <Panel title="Request a change to the agreement" description="The department sees your request and can issue a revised version.">
              <form action={pilotTransition} className="flex flex-col gap-3">
                <input type="hidden" name="pilot_id" value={pilot.id} />
                <input type="hidden" name="action" value="request-changes" />
                <TextAreaField id="change_reason" label="What needs to change, and why" name="reason" rows={3} required minLength={10} />
                <SubmitButton variant="secondary">
                  <FileSignature />
                  Send the request
                </SubmitButton>
              </form>
            </Panel>
          ) : null}

          <Link
            href={"/challenges/" + pilot.challenge_id}
            className="group inline-flex items-center gap-1.5 self-start rounded-full px-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            The challenge behind this pilot
            <ArrowUpRight className="size-3.5 transition-transform duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </aside>
      </div>
    </Page>
  );
}

function ProgressFigure({ label, value, of, tone }: { label: string; value: number; of: number; tone: "success" | "brand" | "warning" | "destructive" }) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-2xl bg-surface/70 p-4">
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span className="font-display text-[26px] leading-none font-semibold tracking-tight tabular-nums">
        {value.toLocaleString("en-IN")}
        <span className="text-base text-muted-foreground"> of {of.toLocaleString("en-IN")}</span>
      </span>
      <Meter value={value} max={of || 1} tone={tone} label={label} />
    </div>
  );
}

function PlanStat({ label, value, hint, accent = false }: { label: string; value: React.ReactNode; hint?: string; accent?: boolean }) {
  return (
    <div className={accent ? "flex flex-col gap-1.5 rounded-2xl bg-brand/8 p-4" : "flex flex-col gap-1.5 rounded-2xl bg-surface/70 p-4"}>
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span className="font-display text-lg leading-tight font-semibold tracking-tight text-pretty tabular-nums">{value}</span>
      {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
    </div>
  );
}
