import type { Metadata } from "next";
import { ArrowRight, Ban, CalendarClock, CheckCircle2, CircleDashed, EyeOff, Lock, ShieldAlert, Target } from "lucide-react";

import { declareConflict, submitScores } from "@/app/pilots/actions";
import { Disclosure, SelectField, SubmitButton, TextAreaField } from "@/components/app/forms";
import { Callout, Deadline, EmptyState, Flash, Page, PageHeader, Panel, StateBadge, ToneBadge, type Tone } from "@/components/app/kit";
import { all, apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, compactRupees, decimal, IP_OPTION_LABELS } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Split } from "@/app/(app)/challenges/[id]/_review/shared";

import { ScorePicker } from "./_components/score-picker";

export const metadata: Metadata = { title: "Score applications" };
export const dynamic = "force-dynamic";

type Workspace = {
  challenge: {
    id: string;
    reference: string;
    title: string;
    outcome_statement: string;
    state: string;
    evaluation_deadline: string | null;
  };
  criteria: { id: string; name: string; description: string; weight: number; anchors: Record<string, string> }[];
  kpis: {
    id: string;
    name: string;
    unit: string;
    direction: string;
    baseline_value: number | null;
    target_value: number | null;
    is_primary: boolean;
  }[];
  applications: {
    id: string;
    blind_label: string;
    proposal_summary: string;
    approach: string;
    kpi_commitments: { kpi_id: string; committed_value: number; note?: string }[];
    pilot_cost: { paise: number } | null;
    timeline_weeks: number;
    data_declaration: string;
    ip_declaration: string;
    submitted_at: string | null;
    conflict_declared: boolean;
    has_conflict: boolean | null;
    scored: boolean;
    locked: boolean;
    my_scores: { criterion_id: string; score: number; justification: string }[];
  }[];
  blinded: boolean;
  note: string;
};

type App = Workspace["applications"][number];

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function statusOf(application: App): { label: string; tone: Tone; icon: typeof CheckCircle2 } {
  if (application.has_conflict) return { label: "Conflict declared", tone: "destructive", icon: Ban };
  if (application.locked) return { label: "Locked", tone: "neutral", icon: Lock };
  if (application.scored) return { label: "Scored", tone: "success", icon: CheckCircle2 };
  if (!application.conflict_declared) return { label: "Declaration needed", tone: "warning", icon: ShieldAlert };
  return { label: "Ready to score", tone: "brand", icon: CircleDashed };
}

function letterOf(label: string) {
  const match = label.match(/([A-Z])$/);
  return match ? match[1] : label.slice(0, 1).toUpperCase();
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{children}</p>
);

export default async function EvaluationWorkspacePage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [, workspace] = await all(requireSession("/evaluation/" + id), apiGetOrNotFound<Workspace>("/evaluation/" + id));

  const kpiById = new Map(workspace.kpis.map((kpi) => [kpi.id, kpi]));
  const pending = workspace.applications.filter((application) => !application.scored && !application.has_conflict);
  const totalWeight = workspace.criteria.reduce((sum, c) => sum + c.weight, 0) || 1;

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/evaluation", label: "Back to my panel work" }}
        eyebrow={
          <>
            <span className="font-mono text-[12px] tracking-tight">{workspace.challenge.reference}</span>
            <StateBadge state={workspace.challenge.state} labels={CHALLENGE_STATE_LABELS} />
            {workspace.blinded && (
              <ToneBadge tone="warning" dot={false}>
                <EyeOff />
                Applicant identity hidden
              </ToneBadge>
            )}
          </>
        }
        title={workspace.challenge.title}
        description={workspace.challenge.outcome_statement}
      />
      <Flash searchParams={query} />

      <Split
        main={
          workspace.applications.length ? (
            workspace.applications.map((application) => {
              const status = statusOf(application);
              return (
                <article key={application.id} id={"app-" + application.id} className="scroll-mt-20 overflow-hidden rounded-3xl bg-card shadow-card">
                  <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-4 md:px-6">
                    <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-foreground font-display text-base font-semibold text-background">
                      {letterOf(application.blind_label)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-[17px] font-semibold tracking-tight">{application.blind_label}</h2>
                      <p className="text-[13px] text-muted-foreground">
                        {application.has_conflict
                          ? "Removed from your list after your declared conflict."
                          : application.locked
                            ? "Scores for this challenge are locked."
                            : application.scored
                              ? "Scored. You can revise until the scores lock."
                              : "Declare any conflict, then score every criterion."}
                      </p>
                    </div>
                    <div className="flex w-full flex-wrap gap-1.5 pl-[52px] sm:w-auto sm:justify-end sm:pl-0">
                      {application.conflict_declared && !application.has_conflict && <ToneBadge tone="success">No conflict</ToneBadge>}
                      <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
                    </div>
                  </header>

                  <div className="flex flex-col gap-6 p-5 md:p-6">
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label>Proposal</Label>
                        <p className="text-sm leading-relaxed whitespace-pre-line text-pretty text-foreground/90">{application.proposal_summary}</p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Approach</Label>
                        <p className="text-sm leading-relaxed whitespace-pre-line text-pretty text-foreground/90">{application.approach}</p>
                      </div>
                    </div>

                    {application.kpi_commitments.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <Label>Committed values</Label>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {application.kpi_commitments.map((commitment) => {
                            const kpi = kpiById.get(commitment.kpi_id);
                            const hasBaseline = kpi?.baseline_value !== null && kpi?.baseline_value !== undefined;
                            return (
                              <div key={commitment.kpi_id} className="flex flex-col gap-1 rounded-2xl bg-surface/60 px-4 py-3">
                                <span className="truncate text-[13px] text-muted-foreground">{kpi?.name ?? "Measure"}</span>
                                <span className="flex flex-wrap items-baseline gap-x-2">
                                  {hasBaseline && (
                                    <>
                                      <span className="text-sm text-muted-foreground tabular-nums">{kpi!.baseline_value}</span>
                                      <ArrowRight className="size-3 self-center text-glyph" />
                                    </>
                                  )}
                                  <span className="font-display text-lg font-semibold tracking-tight tabular-nums">
                                    {decimal(commitment.committed_value, 2)}
                                  </span>
                                  <span className="text-[12px] text-muted-foreground">{kpi?.unit ?? ""}</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <dl className="grid grid-cols-2 gap-4 rounded-2xl border border-border/70 px-4 py-3 sm:grid-cols-3">
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-[12px] text-muted-foreground">Pilot cost</dt>
                        <dd className="text-sm font-medium tabular-nums">{application.pilot_cost ? compactRupees(application.pilot_cost.paise) : "Not quoted"}</dd>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-[12px] text-muted-foreground">Timeline</dt>
                        <dd className="text-sm font-medium tabular-nums">{application.timeline_weeks} weeks</dd>
                      </div>
                      <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-1">
                        <dt className="text-[12px] text-muted-foreground">Intellectual property</dt>
                        <dd className="text-sm font-medium">{IP_OPTION_LABELS[application.ip_declaration] ?? application.ip_declaration.replace(/_/g, " ")}</dd>
                      </div>
                    </dl>

                    <Disclosure summary="Data handling declaration">
                      <p className="whitespace-pre-line">{application.data_declaration}</p>
                    </Disclosure>

                    {!application.conflict_declared ? (
                      <form action={declareConflict} className="flex flex-col gap-4 rounded-2xl bg-warning/[0.07] p-4 ring-1 ring-warning/25 md:p-5">
                        <input type="hidden" name="application_id" value={application.id} />
                        <input type="hidden" name="challenge_id" value={workspace.challenge.id} />
                        <div className="flex gap-3">
                          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                          <div>
                            <p className="text-sm font-medium">Conflict of interest declaration</p>
                            <p className="text-[13px] leading-relaxed text-muted-foreground">
                              Required before scoring. Declare a conflict if you, or a body you are connected with, has any interest in this
                              applicant or in the outcome.
                            </p>
                          </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <SelectField
                            id={"has_conflict_" + application.id}
                            label="Do you have a conflict?"
                            name="has_conflict"
                            defaultValue="no"
                            required
                            options={[
                              { value: "no", label: "No, I have no conflict of interest" },
                              { value: "yes", label: "Yes, I have a conflict" },
                            ]}
                          />
                          <TextAreaField
                            id={"statement_" + application.id}
                            label="If yes, describe the relationship"
                            name="statement"
                            rows={2}
                            hint="Required when you declare a conflict."
                          />
                        </div>
                        <div>
                          <SubmitButton variant="secondary" pendingLabel="Recording">
                            Record the declaration
                          </SubmitButton>
                        </div>
                      </form>
                    ) : application.has_conflict ? (
                      <Callout tone="warning" icon={Ban} title="You cannot score this application">
                        You declared a conflict of interest on it.
                      </Callout>
                    ) : application.locked ? (
                      <Callout icon={Lock} title="Scores are locked">
                        Ask the approver to reopen scoring if a correction is needed. The reopening is recorded with a reason.
                      </Callout>
                    ) : (
                      <form action={submitScores} className="flex flex-col gap-4 border-t border-border/60 pt-6">
                        <input type="hidden" name="application_id" value={application.id} />
                        <input type="hidden" name="challenge_id" value={workspace.challenge.id} />
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="font-display text-[15px] font-semibold tracking-tight">Your scores</h3>
                          <span className="text-[12px] text-muted-foreground">1 to 5 against the anchors</span>
                        </div>
                        {workspace.criteria.map((criterion) => {
                          const existing = application.my_scores.find((score) => score.criterion_id === criterion.id);
                          const pickerId = "score_" + application.id + "_" + criterion.id;
                          return (
                            <div key={criterion.id} className="grid gap-4 rounded-2xl bg-surface/50 p-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                              <input type="hidden" name="criterion_id" value={criterion.id} />
                              <div className="flex flex-col gap-2">
                                <div className="flex items-baseline justify-between gap-2">
                                  <label htmlFor={pickerId} className="text-sm font-medium">
                                    {criterion.name}
                                  </label>
                                  <span className="shrink-0 text-[12px] whitespace-nowrap text-muted-foreground tabular-nums">Weight {criterion.weight}</span>
                                </div>
                                <ScorePicker
                                  id={pickerId}
                                  name="criterion_score"
                                  label={criterion.name + " score"}
                                  defaultValue={existing ? existing.score : 3}
                                  anchors={criterion.anchors}
                                />
                              </div>
                              <TextAreaField
                                id={"justification_" + application.id + "_" + criterion.id}
                                label="Why this score"
                                name="criterion_justification"
                                rows={3}
                                required
                                minLength={10}
                                defaultValue={existing?.justification ?? ""}
                                hint="At least 10 characters, pointing to something specific in the proposal."
                              />
                            </div>
                          );
                        })}
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-[13px] text-muted-foreground">Applicants eventually see your justifications, anonymised.</p>
                          <SubmitButton variant="brand" pendingLabel="Saving" className="shrink-0">
                            {application.scored ? "Update my scores" : "Submit my scores"}
                          </SubmitButton>
                        </div>
                      </form>
                    )}
                  </div>
                </article>
              );
            })
          ) : (
            <EmptyState icon={CheckCircle2} title="Nothing to score" description="No eligible application is waiting for your score on this challenge." />
          )
        }
        aside={
          <>
            <Panel>
              <div className="flex flex-col gap-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-serif text-[40px] font-normal tracking-[-0.03em] tabular-nums">{pending.length}</span>
                  <span className="text-sm text-muted-foreground">still to score</span>
                </div>
                {workspace.challenge.evaluation_deadline ? (
                  <div className="text-[13px]">
                    <Deadline value={workspace.challenge.evaluation_deadline} label="Scoring closes" />
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <CalendarClock className="size-3.5" />
                    No scoring deadline set
                  </p>
                )}
                {workspace.applications.length > 0 && (
                  <nav aria-label="Applications" className="flex flex-col gap-1 border-t border-border/70 pt-3">
                    {workspace.applications.map((application) => {
                      const status = statusOf(application);
                      return (
                        <a
                          key={application.id}
                          href={"#app-" + application.id}
                          className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm transition-colors hover:bg-surface"
                        >
                          <span className="grid size-6 place-items-center rounded-lg bg-surface text-[11px] font-semibold">{letterOf(application.blind_label)}</span>
                          <span className="flex-1 truncate">{application.blind_label}</span>
                          <status.icon
                            className={cn(
                              "size-4",
                              status.tone === "success" && "text-success",
                              status.tone === "warning" && "text-warning",
                              status.tone === "destructive" && "text-destructive",
                              status.tone === "brand" && "text-brand",
                              status.tone === "neutral" && "text-glyph",
                            )}
                            aria-label={status.label}
                          />
                        </a>
                      );
                    })}
                  </nav>
                )}
              </div>
            </Panel>

            <Panel title="The rubric" description={workspace.note}>
              <div className="flex flex-col gap-4">
                <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
                  {workspace.criteria.map((criterion, index) => (
                    <span
                      key={criterion.id}
                      className={cn("h-full", ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-5", "bg-chart-4", "bg-glyph"][index % 6])}
                      style={{ width: (criterion.weight / totalWeight) * 100 + "%" }}
                    />
                  ))}
                </div>
                <ul className="flex flex-col gap-1">
                  {workspace.criteria.map((criterion, index) => (
                    <li key={criterion.id}>
                      <Disclosure
                        summary={
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span className={cn("size-2 shrink-0 rounded-full", ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-5", "bg-chart-4", "bg-glyph"][index % 6])} />
                            <span className="truncate">{criterion.name}</span>
                            <span className="ml-auto pl-2 text-[12px] font-normal text-muted-foreground tabular-nums">{criterion.weight}</span>
                          </span>
                        }
                        className="bg-transparent"
                      >
                        <p className="mb-2">{criterion.description}</p>
                        {Object.keys(criterion.anchors ?? {}).length > 0 && (
                          <dl className="flex flex-col gap-1.5">
                            {Object.entries(criterion.anchors)
                              .sort(([a], [b]) => Number(a) - Number(b))
                              .map(([score, anchor]) => (
                                <div key={score} className="flex gap-2">
                                  <dt className="w-4 shrink-0 font-semibold text-foreground tabular-nums">{score}</dt>
                                  <dd>{anchor}</dd>
                                </div>
                              ))}
                          </dl>
                        )}
                      </Disclosure>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>

            <Panel title="What is being bought" description="The measures the pilot is judged against.">
              <ul className="flex flex-col gap-3">
                {workspace.kpis.map((kpi) => (
                  <li key={kpi.id} className="flex flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium leading-snug">{kpi.name}</span>
                      {kpi.is_primary && <ToneBadge tone="brand">Primary</ToneBadge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                      <span className="tabular-nums">{kpi.baseline_value ?? "To be measured"}</span>
                      <ArrowRight className="size-3 text-glyph" />
                      <span className="inline-flex items-center gap-1 font-medium text-foreground tabular-nums">
                        <Target className="size-3 text-brand" />
                        {kpi.target_value ?? "Not set"}
                      </span>
                      <span>
                        {kpi.unit}, {kpi.direction === "lower" ? "lower is better" : "higher is better"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </>
        }
      />
    </Page>
  );
}
