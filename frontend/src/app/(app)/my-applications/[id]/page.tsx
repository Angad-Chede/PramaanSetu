import type { Metadata } from "next";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, Check, CircleAlert, CircleCheck, CircleX, Lock, Save, Send, ShieldCheck, Trophy } from "lucide-react";

import { saveApplication, submitApplication, withdrawApplication } from "@/app/pilots/actions";
import { AutosaveForm, CheckField, Disclosure, SubmitButton, TextAreaField, TextField } from "@/components/app/forms";
import { Callout, Deadline, Flash, LinkButton, Meter, Page, PageHeader, Panel, ProblemList, StateBadge, ToneBadge } from "@/components/app/kit";
import { Gauge } from "@/components/ui/gauge";
import { all, apiGet, apiGetOrNotFound } from "@/lib/api";
import { APPLICATION_STATE_LABELS, IP_OPTION_LABELS, compactRupees, decimal, formatDateTime, isOverdue, money } from "@/lib/format";
import { requireSession } from "@/lib/session";
import type { Application, Challenge } from "@/lib/types";
import { cn } from "@/lib/utils";

import { OUTCOME_TONE, STAGES, stageIndex } from "../_components/progress";

export const metadata: Metadata = { title: "My application" };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const LOCKED_STATES = ["Locked", "Screened", "UnderEvaluation", "Shortlisted", "NotShortlisted", "Withdrawn"];

export default async function MyApplicationPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [, application] = await all(requireSession("/my-applications/" + id), apiGetOrNotFound<Application>("/applications/" + id));
  const challenge = await apiGet<Challenge>("/challenges/" + application.challenge_id);

  const deadlinePassed = isOverdue(challenge.application_deadline);
  const closed = deadlinePassed || LOCKED_STATES.includes(application.state);
  const commitmentsByKpi = new Map(application.kpi_commitments.map((commitment) => [commitment.kpi_id, commitment]));
  const ceiling = challenge.budget_ceiling && challenge.budget_ceiling.paise > 0 ? challenge.budget_ceiling : null;
  const costShare = ceiling && application.pilot_cost ? application.pilot_cost.paise / ceiling.paise : null;
  const current = stageIndex(application.state);
  const withdrawn = application.state === "Withdrawn";
  const eligibility = application.eligibility;

  return (
    <Page>
      <PageHeader
        back={{ href: "/my-applications", label: "My applications" }}
        eyebrow={
          <>
            <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px]">{application.reference}</span>
            <StateBadge state={application.state} labels={APPLICATION_STATE_LABELS} />
            {eligibility && (
              <ToneBadge tone={OUTCOME_TONE[eligibility.outcome] ?? "neutral"}>
                {eligibility.outcome === "NeedsReview" ? "Eligibility needs review" : eligibility.outcome}
              </ToneBadge>
            )}
          </>
        }
        title={challenge.title}
        description={challenge.outcome_statement}
        actions={
          <LinkButton href={"/challenges-board/" + challenge.id} variant="secondary">
            <BookOpen />
            Read the challenge
          </LinkButton>
        }
      />

      <Flash searchParams={query} />

      <ol className="grid grid-cols-5 gap-2 rounded-3xl bg-card p-4 shadow-card md:p-5" aria-label="Application progress">
        {STAGES.map((stage, index) => {
          const done = !withdrawn && index < current;
          const here = !withdrawn && index === current;
          return (
            <li key={stage.key} className="flex flex-col gap-2.5">
              <span
                className={cn(
                  "h-1.5 rounded-full",
                  done ? "bg-foreground/70" : here ? (application.state === "Shortlisted" ? "bg-success" : application.state === "NotShortlisted" ? "bg-destructive/70" : "bg-brand") : "bg-recess",
                )}
              />
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "hidden size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold sm:grid",
                    done ? "bg-foreground text-background" : here ? "bg-brand/14 text-brand-ink" : "bg-surface text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
                </span>
                <span className={cn("text-[11px] leading-tight sm:text-[13px]", here ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {stage.key === "result" && application.state === "Shortlisted"
                    ? "Shortlisted"
                    : stage.key === "result" && application.state === "NotShortlisted"
                      ? "Not shortlisted"
                      : stage.label}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {application.my_result && (
            <Panel title="Your evaluation result" description={application.my_result.note}>
              <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)] md:items-center">
                <div className="flex flex-col items-center gap-1">
                  <Gauge
                    value={application.my_result.weighted_score}
                    max={100}
                    decimals={1}
                    size={200}
                    needle={false}
                    label="Weighted score"
                    caption={"Rank " + application.my_result.rank}
                    tone="brand"
                  />
                </div>
                <ul className="flex flex-col gap-3">
                  {application.my_result.criteria.map((criterion) => (
                    <li key={criterion.name} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="truncate font-medium text-foreground">{criterion.name}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          <span className="font-semibold text-foreground">{decimal(criterion.mean, 2)}</span> of 5, weight {criterion.weight}
                        </span>
                      </div>
                      <Meter value={criterion.mean} max={5} tone={criterion.mean >= 4 ? "success" : "brand"} label={criterion.name} />
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}

          {eligibility && (
            <Panel title="Eligibility result" description="Every published rule, with the reason recorded against it.">
              {eligibility.relaxations_applied.length > 0 && (
                <Callout tone="success" icon={ShieldCheck} title="Startup relaxation applied" className="mb-4">
                  <p>
                    {(() => {
                      const names = eligibility.relaxations_applied.map((relaxation) => relaxation.name.toLowerCase()).join(" and ");
                      return names.charAt(0).toUpperCase() + names.slice(1);
                    })()}{" "}
                    relaxed because your startup is recognised. Quality and technical criteria are unchanged.
                  </p>
                  <p className="mt-1.5 text-[12px] opacity-80">{eligibility.relaxations_applied[0].citation}</p>
                </Callout>
              )}
              <ul className="flex flex-col divide-y divide-border/70">
                {eligibility.rule_results.map((rule) => {
                  const Icon = rule.passed ? CircleCheck : rule.blocking ? CircleX : CircleAlert;
                  return (
                    <li key={rule.code} className="flex gap-3 py-3.5 first:pt-0 last:pb-0">
                      <Icon className={cn("mt-0.5 size-[18px] shrink-0", rule.passed ? "text-success" : rule.blocking ? "text-destructive" : "text-warning")} />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{rule.name}</span>
                          <ToneBadge tone={rule.passed ? "success" : rule.blocking ? "destructive" : "warning"} dot={false}>
                            {rule.passed ? "Met" : rule.blocking ? "Not met" : "Review"}
                          </ToneBadge>
                          {rule.relaxed && <ToneBadge tone="info" dot={false}>Relaxed</ToneBadge>}
                        </div>
                        <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{rule.reason}</p>
                        {!rule.passed && <p className="text-[13px] font-medium text-foreground">{rule.fix || "No action needed"}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {eligibility.clarification_window_ends && (
                <p className="mt-4 text-[13px]">
                  <Deadline value={eligibility.clarification_window_ends} label="You can raise a clarification until" />
                </p>
              )}
            </Panel>
          )}

          {!closed ? (
            <AutosaveForm action={saveApplication} className="flex flex-col gap-6">
              <input type="hidden" name="application_id" value={application.id} />
              <input type="hidden" name="version" value={application.version} />

              {application.blocking_problems.length > 0 && <ProblemList problems={application.blocking_problems} title="Complete these before submitting" />}

              <Panel title="Your proposal" description="Written for an officer who is not a specialist. Evaluators read this blind in round one.">
                <div className="flex flex-col gap-5">
                  <TextAreaField
                    label="What are you proposing?"
                    name="proposal_summary"
                    rows={5}
                    required
                    minLength={80}
                    defaultValue={application.proposal_summary}
                    hint="Two or three sentences a non-technical officer can understand. At least 80 characters."
                  />
                  <TextAreaField
                    label="How will it work during the pilot?"
                    name="approach"
                    rows={7}
                    required
                    minLength={80}
                    defaultValue={application.approach}
                    hint="Deployment, operation, support, and how each measure will be recorded."
                  />
                </div>
              </Panel>

              <Panel title="What you commit to" description="Enter the value you commit to reach by the end of the pilot for each published measure.">
                <ul className="flex flex-col gap-3">
                  {(challenge.kpis ?? []).map((kpi) => {
                    const commitment = commitmentsByKpi.get(kpi.id);
                    const Direction = kpi.direction === "lower" ? ArrowDownRight : ArrowUpRight;
                    return (
                      <li key={kpi.id} className={cn("rounded-2xl p-4", kpi.is_primary ? "bg-brand/[0.06] ring-1 ring-brand/20" : "bg-surface/70")}>
                        <input type="hidden" name="commit_kpi_id" value={kpi.id} />
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-semibold text-foreground">{kpi.name}</h3>
                              {kpi.is_primary && <ToneBadge tone="brand">Primary</ToneBadge>}
                            </div>
                            <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{kpi.baseline_method}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 rounded-xl bg-card px-3 py-2 text-[12px] text-muted-foreground shadow-card">
                            <span>
                              Baseline <span className="font-semibold text-foreground tabular-nums">{kpi.baseline_value ?? "TBD"}</span>
                            </span>
                            <Direction className="size-3.5 text-success" />
                            <span>
                              Target <span className="font-semibold text-foreground tabular-nums">{kpi.target_value ?? "not set"}</span>
                            </span>
                            <span>{kpi.unit}</span>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
                          <TextField
                            id={"commit_value_" + kpi.id}
                            label={"Committed value, " + kpi.unit}
                            name="commit_value"
                            type="number"
                            step="any"
                            required
                            defaultValue={commitment?.committed_value ?? ""}
                            hint={kpi.direction_label}
                          />
                          <TextField id={"commit_note_" + kpi.id} label="Note" optional name="commit_note" defaultValue={commitment?.note ?? ""} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>

              <Panel title="Cost, timeline and declarations">
                <div className="flex flex-col gap-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <TextField
                      label="Total pilot cost in rupees"
                      name="pilot_cost_rupees"
                      type="number"
                      min={0}
                      required
                      defaultValue={application.pilot_cost ? application.pilot_cost.paise / 100 : ""}
                      hint={ceiling ? "At or below the published ceiling of " + money(ceiling) + "." : "Inclusive of all taxes."}
                    />
                    <TextField
                      label="Weeks needed for the pilot"
                      name="timeline_weeks"
                      type="number"
                      min={1}
                      max={104}
                      required
                      defaultValue={application.timeline_weeks || challenge.pilot_duration_weeks}
                      hint={"The challenge plans " + challenge.pilot_duration_weeks + " weeks."}
                    />
                  </div>

                  <TextAreaField
                    label="What data do you need, and where will it be stored?"
                    name="data_declaration"
                    rows={4}
                    required
                    defaultValue={application.data_declaration}
                    hint="State the datasets, the storage location, which must be in India, and the retention period."
                  />

                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-3 text-sm font-medium text-foreground">Intellectual property option you accept</legend>
                    <div className="grid gap-2 md:grid-cols-3">
                      {Object.entries(IP_OPTION_LABELS).map(([value, label]) => (
                        <label
                          key={value}
                          className="group relative flex cursor-pointer flex-col gap-1 rounded-2xl bg-surface/70 p-4 ring-1 ring-transparent transition-[background-color,box-shadow] duration-200 ease-ios hover:bg-surface has-checked:bg-card has-checked:shadow-card has-checked:ring-foreground/80 has-focus-visible:ring-2 has-focus-visible:ring-ring"
                        >
                          <input type="radio" name="ip_declaration" value={value} defaultChecked={(application.ip_declaration || "startup_retains") === value} className="peer sr-only" />
                          <span className="absolute top-4 right-4 grid size-4 place-items-center rounded-full border border-glyph/50 peer-checked:border-foreground peer-checked:bg-foreground">
                            <span className="size-1.5 rounded-full bg-background" />
                          </span>
                          <span className="pr-6 text-[13px] leading-snug text-pretty text-foreground">{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="rounded-2xl bg-surface/70 p-4">
                    <CheckField
                      name="conflict_declaration"
                      defaultChecked={application.conflict_declaration}
                      label="No conflict of interest"
                      hint="I confirm that no director, employee or adviser of this startup holds a position in the department publishing this challenge, and that no conflict of interest exists in relation to this application."
                    />
                  </div>
                </div>
              </Panel>

              <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-3xl bg-card/90 p-3 pl-5 shadow-float backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[13px] text-muted-foreground">
                  {application.submitted_at ? "Last submitted " + formatDateTime(application.submitted_at) : "Not submitted yet. Drafts are kept until you submit."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton variant="secondary" formAction={saveApplication} pendingLabel="Saving">
                    <Save />
                    Save draft
                  </SubmitButton>
                  <SubmitButton
                    variant="brand"
                    formAction={submitApplication}
                    pendingLabel="Submitting"
                    confirmTitle={application.submitted_at ? "Resubmit this application?" : "Submit this application?"}
                    confirm="You can keep editing until the deadline, and the last submitted version is the one that counts."
                    confirmLabel={application.submitted_at ? "Save and resubmit" : "Save and submit"}
                  >
                    <Send />
                    {application.submitted_at ? "Save and resubmit" : "Save and submit"}
                  </SubmitButton>
                </div>
              </div>
            </AutosaveForm>
          ) : (
            <Panel
              title="Your proposal"
              action={
                <ToneBadge dot={false}>
                  <Lock className="size-3" />
                  Read only
                </ToneBadge>
              }
            >
              <Callout tone="neutral" icon={Lock} className="mb-5">
                {deadlinePassed
                  ? "The deadline has passed and your last submitted version is locked."
                  : "This application is " + (APPLICATION_STATE_LABELS[application.state] ?? application.state).toLowerCase() + " and can no longer be edited."}
              </Callout>
              <div className="flex flex-col gap-5">
                <div>
                  <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Proposal</p>
                  <p className="mt-1.5 max-w-prose text-sm leading-relaxed whitespace-pre-line text-foreground/85">{application.proposal_summary}</p>
                </div>
                <div>
                  <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Approach</p>
                  <p className="mt-1.5 max-w-prose text-sm leading-relaxed whitespace-pre-line text-foreground/85">{application.approach}</p>
                </div>
              </div>
            </Panel>
          )}

          {(application.state === "Draft" || application.state === "Submitted") && (
            <Disclosure
              summary={
                <span className="inline-flex items-center gap-2 text-destructive-ink">
                  <AlertTriangle className="size-4" />
                  Withdraw this application
                </span>
              }
            >
              <form action={withdrawApplication} className="flex flex-col items-start gap-3">
                <input type="hidden" name="application_id" value={application.id} />
                <p>Withdrawing removes your application from consideration. You cannot undo it, but you can apply again before the deadline.</p>
                <SubmitButton variant="destructive" confirmTitle="Withdraw this application?" confirm="You can apply again before the deadline." confirmLabel="Withdraw">
                  Withdraw the application
                </SubmitButton>
              </form>
            </Disclosure>
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Panel title="Status">
            <dl className="flex flex-col gap-4 text-[13px]">
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">Applications close</dt>
                <dd className="text-foreground">
                  <Deadline value={challenge.application_deadline} label="" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Last submitted</dt>
                <dd className="text-right text-foreground">{application.submitted_at ? formatDateTime(application.submitted_at) : "Not yet"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Locked at the deadline</dt>
                <dd className="text-right text-foreground">{application.locked_at ? formatDateTime(application.locked_at) : "Not yet"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Shortlist position</dt>
                <dd className="inline-flex items-center gap-1.5 text-right font-medium text-foreground">
                  {application.shortlist_rank ? (
                    <>
                      <Trophy className="size-3.5 text-warning" />
                      Rank {application.shortlist_rank}
                    </>
                  ) : (
                    <span className="font-normal text-muted-foreground">Not shortlisted</span>
                  )}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Cost against the ceiling">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-serif text-[30px] font-normal tracking-[-0.025em] tabular-nums">
                {application.pilot_cost ? compactRupees(application.pilot_cost.paise).replace("INR ", "₹") : "Not quoted"}
              </span>
              <span className="text-[13px] text-muted-foreground">of {ceiling ? compactRupees(ceiling.paise).replace("INR ", "₹") : "no published ceiling"}</span>
            </div>
            {costShare !== null && (
              <>
                <Meter className="mt-3 h-2" value={Math.min(costShare, 1) * 100} tone={costShare > 1 ? "destructive" : costShare > 0.9 ? "warning" : "success"} label="Quoted cost as a share of the ceiling" />
                <p className={cn("mt-2 text-[12px]", costShare > 1 ? "font-medium text-destructive-ink" : "text-muted-foreground")}>
                  {costShare > 1 ? "Above the ceiling. Bring it under " + money(ceiling) + " to stay eligible." : Math.round(costShare * 100) + " percent of the published ceiling"}
                </p>
              </>
            )}
            <dl className="mt-4 flex flex-col gap-2 border-t border-border/70 pt-4 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Budget ceiling</dt>
                <dd className="text-right tabular-nums">{ceiling ? money(ceiling) : "Not published"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Your quoted cost</dt>
                <dd className="text-right tabular-nums">{application.pilot_cost ? money(application.pilot_cost) : "Not quoted"}</dd>
              </div>
            </dl>
          </Panel>
        </aside>
      </div>
    </Page>
  );
}
