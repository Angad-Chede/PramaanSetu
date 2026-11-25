import type { Metadata } from "next";
import { CircleAlert, CircleCheck, CircleX, FileSearch, Inbox, Scale, ShieldCheck, Sparkles } from "lucide-react";

import { overrideEligibility, runWorkflowStep } from "@/app/challenges/actions";
import { Disclosure, SelectField, SubmitButton, TextAreaField } from "@/components/app/forms";
import { Callout, EmptyState, Flash, LinkButton, Page, PageHeader, Panel, StateBadge, ToneBadge, type Tone } from "@/components/app/kit";
import { all, apiGetOrNotFound } from "@/lib/api";
import { APPLICATION_STATE_LABELS, CHALLENGE_STATE_LABELS, formatDateTime, money } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge, Eligibility, EligibilityRule } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Initials, ReviewNav, Split, SplitBar } from "../_review/shared";

export const metadata: Metadata = { title: "Applications and eligibility" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  reference: string;
  startup_id: string;
  startup_name: string | null;
  state: string;
  pilot_cost: { paise: number; display: string } | null;
  submitted_at: string | null;
  locked_at: string | null;
  eligibility: Eligibility | null;
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  Eligible: { label: "Eligible", tone: "success" },
  NeedsReview: { label: "Needs review", tone: "warning" },
  Ineligible: { label: "Ineligible", tone: "destructive" },
};

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function RuleRow({ rule }: { rule: EligibilityRule }) {
  const status = rule.passed ? "met" : rule.blocking ? "failed" : "review";
  const Icon = status === "met" ? CircleCheck : status === "failed" ? CircleX : CircleAlert;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)]">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-[18px]",
          status === "met" && "text-success",
          status === "failed" && "text-destructive",
          status === "review" && "text-warning",
        )}
      />
      <div className="flex flex-wrap items-center gap-1.5 self-start">
        <span className="text-sm font-medium text-foreground">{rule.name}</span>
        <span className="sr-only">{status === "met" ? "Met" : status === "failed" ? "Not met" : "Review"}</span>
        {rule.relaxed && (
          <ToneBadge tone="success" dot={false}>
            Relaxed
          </ToneBadge>
        )}
      </div>
      <div className="col-start-2 flex flex-col gap-0.5 sm:col-start-3">
        <p className="text-[13px] leading-relaxed text-pretty text-foreground/85">{rule.reason}</p>
        <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{rule.fix || "No action needed"}</p>
      </div>
    </li>
  );
}

export default async function ScreeningPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [session, challenge, applications] = await all(
    requireSession("/challenges/" + id + "/screening"),
    apiGetOrNotFound<Challenge>("/challenges/" + id),
    apiGetOrNotFound<{ items: Row[]; count: number }>("/challenges/" + id + "/applications"),
  );

  const canOverride = hasRole(session, "DO") && session.department_id === challenge.department_id;
  const screened = applications.items.filter((row) => row.eligibility);
  const counts = {
    Eligible: screened.filter((r) => r.eligibility?.outcome === "Eligible").length,
    NeedsReview: screened.filter((r) => r.eligibility?.outcome === "NeedsReview").length,
    Ineligible: screened.filter((r) => r.eligibility?.outcome === "Ineligible").length,
  };
  const unscreened = applications.items.length - screened.length;
  const relaxedCount = screened.filter((r) => r.eligibility?.relaxations_applied.length).length;
  const overriddenCount = screened.filter((r) => r.eligibility?.overridden_by).length;
  const canScreen = challenge.state === "ApplicationsClosed" && canOverride;

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/challenges/" + challenge.id, label: "Back to the challenge" }}
        eyebrow={
          <>
            <span className="font-mono text-[12px] tracking-tight">{challenge.reference}</span>
            <StateBadge state={challenge.state} labels={CHALLENGE_STATE_LABELS} />
          </>
        }
        title="Applications and eligibility"
        description="Every rule produces a sentence the applicant can act on. Where the turnover and experience relaxation applies to a recognised startup, it is applied automatically and the rule used is recorded."
      />
      <ReviewNav challengeId={challenge.id} active="screening" />
      <Flash searchParams={query} />

      <Split
        main={
          applications.items.length ? (
            <div className="flex flex-col gap-4">
              {applications.items.map((row) => {
                const eligibility = row.eligibility;
                const outcome = eligibility ? OUTCOME[eligibility.outcome] : null;
                const rules = eligibility?.rule_results ?? [];
                const met = rules.filter((rule) => rule.passed).length;
                const attention = rules.filter((rule) => !rule.passed);
                return (
                  <article key={row.id} id={row.id} className="overflow-hidden rounded-3xl bg-card shadow-card">
                    <header className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-center md:px-6">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Initials name={row.startup_name ?? "Applicant"} className="size-10" />
                        <div className="min-w-0">
                          <h2 className="truncate font-display text-[15px] font-semibold tracking-tight">{row.startup_name ?? "Applicant"}</h2>
                          <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
                            <span className="font-mono text-[12px]">{row.reference}</span>
                            <span aria-hidden>·</span>
                            <span className="tabular-nums">{row.pilot_cost ? money(row.pilot_cost) : "No cost quoted"}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StateBadge state={row.state} labels={APPLICATION_STATE_LABELS} />
                        {outcome ? (
                          <ToneBadge tone={outcome.tone}>{outcome.label}</ToneBadge>
                        ) : (
                          <ToneBadge tone="neutral">Not screened</ToneBadge>
                        )}
                      </div>
                    </header>

                    <div className="flex flex-col gap-4 p-5 md:p-6">
                      {eligibility ? (
                        <>
                          <div className="flex items-center gap-3">
                            <div className="flex h-1.5 flex-1 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                              {rules.map((rule) => (
                                <span
                                  key={rule.code}
                                  className={cn(
                                    "h-full flex-1",
                                    rule.passed ? "bg-success" : rule.blocking ? "bg-destructive" : "bg-warning",
                                  )}
                                />
                              ))}
                            </div>
                            <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                              {met} of {rules.length} rules met
                            </span>
                          </div>

                          {attention.length > 0 && (
                            <ul className="divide-y divide-border/70 rounded-2xl bg-surface/60 px-4 py-3">
                              {attention.map((rule) => (
                                <RuleRow key={rule.code} rule={rule} />
                              ))}
                            </ul>
                          )}

                          {eligibility.relaxations_applied.length > 0 && (
                            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
                              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-success" />
                              <span>
                                <span className="font-medium text-foreground">
                                  {sentenceCase(eligibility.relaxations_applied.map((relaxation) => relaxation.name.toLowerCase()).join(" and "))} relaxed
                                </span>{" "}
                                for this recognised startup. Quality and technical criteria are unchanged.
                              </span>
                            </p>
                          )}

                          <Disclosure summary={attention.length ? `All ${rules.length} rules with reasons` : `All ${rules.length} rules met. See the reasons`}>
                            <ul className="divide-y divide-border/70 pt-1">
                              {rules.map((rule) => (
                                <RuleRow key={rule.code} rule={rule} />
                              ))}
                            </ul>
                            {eligibility.relaxations_applied.length > 0 && (
                              <p className="mt-3 border-t border-border/70 pt-3 text-[12px] leading-relaxed">
                                Relaxation basis: {eligibility.relaxations_applied[0].citation}
                              </p>
                            )}
                          </Disclosure>

                          {eligibility.overridden_by && (
                            <Callout tone="warning" icon={Scale} title="This result was overridden">
                              {eligibility.override_reason}
                              <span className="mt-1 block text-[12px] opacity-80">The override is in the audit log and visible to the approver.</span>
                            </Callout>
                          )}

                          {canOverride && (
                            <Disclosure summary="Override this result">
                              <form action={overrideEligibility} className="flex flex-col gap-4 pt-1">
                                <input type="hidden" name="challenge_id" value={challenge.id} />
                                <input type="hidden" name="application_id" value={row.id} />
                                <SelectField
                                  id={"outcome_" + row.id}
                                  label="New outcome"
                                  name="outcome"
                                  defaultValue="Eligible"
                                  options={[
                                    { value: "Eligible", label: "Eligible" },
                                    { value: "NeedsReview", label: "Needs review" },
                                    { value: "Ineligible", label: "Ineligible" },
                                  ]}
                                />
                                <TextAreaField
                                  id={"justification_" + row.id}
                                  label="Written justification"
                                  name="justification"
                                  rows={3}
                                  required
                                  minLength={20}
                                  hint="At least 20 characters. The approver and any auditor will read this."
                                />
                                <div>
                                  <SubmitButton variant="secondary" pendingLabel="Recording">
                                    Record the override
                                  </SubmitButton>
                                </div>
                              </form>
                            </Disclosure>
                          )}
                        </>
                      ) : (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                          <FileSearch className="size-4 text-glyph" />
                          Not screened yet. Results appear here with a reason for every rule.
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Inbox}
              title="No applications yet"
              description="Applications appear here once startups submit. Screening runs after the deadline closes."
              action={<LinkButton href={"/challenges/" + challenge.id}>Back to the challenge</LinkButton>}
            />
          )
        }
        aside={
          <>
            {canScreen && (
              <Panel title="Run eligibility screening" description="The rules engine checks every locked application against the published criteria.">
                <form action={runWorkflowStep}>
                  <input type="hidden" name="challenge_id" value={challenge.id} />
                  <input type="hidden" name="action" value="screen" />
                  <input type="hidden" name="back" value={"/challenges/" + challenge.id + "/screening"} />
                  <SubmitButton variant="brand" className="w-full" pendingLabel="Screening">
                    Run screening now
                  </SubmitButton>
                </form>
              </Panel>
            )}

            <Panel title="Results" description={applications.count + (applications.count === 1 ? " application received" : " applications received")}>
              <div className="flex flex-col gap-5">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-4xl font-semibold tracking-tight tabular-nums">{counts.Eligible}</span>
                  <span className="text-sm text-muted-foreground">eligible to go to the panel</span>
                </div>
                <SplitBar
                  label={`${counts.Eligible} eligible, ${counts.NeedsReview} need review, ${counts.Ineligible} ineligible, ${unscreened} not screened`}
                  parts={[
                    { label: "Eligible", value: counts.Eligible, className: "bg-success", dot: "bg-success" },
                    { label: "Needs review", value: counts.NeedsReview, className: "bg-warning", dot: "bg-warning" },
                    { label: "Ineligible", value: counts.Ineligible, className: "bg-destructive", dot: "bg-destructive" },
                    ...(unscreened ? [{ label: "Not screened", value: unscreened, className: "bg-glyph/40", dot: "bg-glyph/40" }] : []),
                  ]}
                />
                <dl className="grid grid-cols-2 gap-3 border-t border-border/70 pt-4">
                  <div>
                    <dt className="text-[12px] text-muted-foreground">Relaxation applied</dt>
                    <dd className="font-display text-xl font-semibold tabular-nums">{relaxedCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted-foreground">Overridden</dt>
                    <dd className="font-display text-xl font-semibold tabular-nums">{overriddenCount}</dd>
                  </div>
                </dl>
              </div>
            </Panel>

            <Panel>
              <div className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-info/12 text-info-ink">
                  <ShieldCheck className="size-4" />
                </span>
                <div className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  <p className="font-medium text-foreground">How a result is decided</p>
                  <p>A blocking rule that is not met makes an application ineligible. A rule that needs judgement sends it to review.</p>
                  <p>An override needs a written justification and is recorded in the audit log.</p>
                  {screened[0]?.eligibility?.screened_at && (
                    <p className="text-[12px]">Last screened {formatDateTime(screened[0].eligibility.screened_at)}</p>
                  )}
                </div>
              </div>
            </Panel>
          </>
        }
      />
    </Page>
  );
}
