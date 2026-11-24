import type { Metadata } from "next";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarClock, Construction, FileSignature, Gavel, LockKeyhole, MapPin, MessageCircleQuestion, ShieldCheck, Target, Timer, Wallet } from "lucide-react";

import { askClarification } from "@/app/challenges/actions";
import { startApplication } from "@/app/pilots/actions";
import { SubmitButton, TextAreaField } from "@/components/app/forms";
import { Callout, EmptyState, Flash, LinkButton, Page, PageHeader, Panel, ToneBadge } from "@/components/app/kit";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { IP_OPTION_LABELS, compactRupees, formatDateTime, isOverdue, relativeDeadline } from "@/lib/format";
import { getSession, hasRole } from "@/lib/session";
import type { Application } from "@/lib/types";
import { cn } from "@/lib/utils";

import { SectorIcon } from "../_components/sector";

export const metadata: Metadata = { title: "Challenge" };
export const dynamic = "force-dynamic";

type PublicChallenge = {
  id: string;
  reference: string;
  title: string;
  outcome_statement: string;
  problem_statement: string;
  current_situation: string;
  constraints: string;
  pilot_scope: string;
  commercial_terms: string;
  sector: string | null;
  state_code: string | null;
  district: string | null;
  department_name: string | null;
  budget_ceiling: { paise: number } | null;
  pilot_duration_weeks: number;
  application_deadline: string | null;
  clarification_cutoff: string | null;
  location_required: boolean;
  ip_option: string;
  eligibility_notes: string;
  state: string;
  kpis: {
    name: string;
    unit: string;
    direction: string;
    direction_label: string;
    baseline_value: number | null;
    target_value: number | null;
    baseline_method: string;
    is_primary: boolean;
  }[];
  criteria: { name: string; weight: number; description: string; anchors: Record<string, string> }[];
  clarifications: { question: string; answer: string | null; published_at: string | null }[];
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const WEIGHT_COLORS = ["bg-brand", "bg-info", "bg-success", "bg-warning", "bg-chart-4", "bg-glyph"];

const AFTER: TimelineItem[] = [
  { id: "lock", title: "Your last version is locked", description: "At the deadline, to the second.", status: "upcoming" },
  { id: "screen", title: "Eligibility screening", description: "A reason is recorded against every published rule.", status: "upcoming" },
  { id: "panel", title: "Blind panel scoring", description: "At least three experts score your proposal without knowing who you are.", status: "upcoming" },
  { id: "design", title: "Pilot designed before it starts", description: "The Pilot Flight Simulator sizes the pilot so the result can be trusted.", status: "upcoming" },
  { id: "pay", title: "Milestone payments", description: "Service level timers escalate on their own if a payment stalls.", status: "upcoming" },
];

export default async function PublicChallengePage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const session = await getSession();
  const challenge = await apiGetOrNotFound<PublicChallenge>("/public/challenges/" + id);

  const isStartup = hasRole(session, "SU");
  const closed = isOverdue(challenge.application_deadline) || challenge.state !== "Published";
  const questionsClosed = isOverdue(challenge.clarification_cutoff);

  let existing: Application | null = null;
  if (isStartup && session?.startup_id) {
    const mine = await apiGetOptional<{ items: { id: string; challenge_id: string }[] }>("/startups/" + session.startup_id + "/applications");
    const match = mine?.items.find((row) => row.challenge_id === challenge.id);
    if (match) existing = (await apiGetOptional<Application>("/applications/" + match.id)) ?? null;
  }

  const kpis = [...challenge.kpis].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const totalWeight = challenge.criteria.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
  const daysLeft = challenge.application_deadline ? Math.max(0, Math.ceil((new Date(challenge.application_deadline).getTime() - Date.now()) / 86400000)) : null;
  const budget = challenge.budget_ceiling && challenge.budget_ceiling.paise > 0 ? compactRupees(challenge.budget_ceiling.paise).replace("INR ", "₹") : "Not published";

  const facts = [
    { icon: Wallet, label: "Budget ceiling", value: budget },
    { icon: Timer, label: "Pilot length", value: challenge.pilot_duration_weeks + " weeks" },
    {
      icon: MapPin,
      label: "Location",
      value: challenge.location_required ? "Restricted to " + (challenge.state_code ?? "the named state") : "Open to any state",
    },
    { icon: FileSignature, label: "Intellectual property", value: IP_OPTION_LABELS[challenge.ip_option] ?? challenge.ip_option },
    {
      icon: MessageCircleQuestion,
      label: "Questions close",
      value: challenge.clarification_cutoff ? formatDateTime(challenge.clarification_cutoff) : "Not set",
    },
  ];

  const applyAction = (
    isStartup && !closed ? (
                existing ? (
                  <LinkButton href={"/my-applications/" + existing.id} variant="brand" size="lg" className="w-full">
                    Open your application
                    <ArrowRight />
                  </LinkButton>
                ) : (
                  <form action={startApplication}>
                    <input type="hidden" name="challenge_id" value={challenge.id} />
                    <SubmitButton variant="brand" size="lg" className="w-full" pendingLabel="Starting">
                      Apply to this challenge
                    </SubmitButton>
                  </form>
                )
              ) : !session ? (
                <LinkButton href={"/signin?next=" + encodeURIComponent("/challenges-board/" + challenge.id)} variant="brand" size="lg" className="w-full">
                  Sign in to apply
                  <ArrowRight />
                </LinkButton>
              ) : closed ? (
                <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] text-muted-foreground">This challenge no longer takes applications.</p>
              ) : null
  );

  return (
    <Page className={cn(!session && "pt-10 md:pt-14")}>
      <PageHeader
        back={{ href: "/challenges-board", label: "Challenge board" }}
        eyebrow={
          <>
            <SectorIcon sector={challenge.sector} size="sm" />
            <span className="text-foreground">{challenge.sector ?? "Any sector"}</span>
            <span aria-hidden className="hidden text-border sm:inline">/</span>
            <span>{challenge.department_name}</span>
            <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px]">{challenge.reference}</span>
          </>
        }
        title={challenge.title}
        description={challenge.outcome_statement}
        actions={applyAction ? <div className="w-full sm:w-auto lg:hidden [&_a]:w-full [&_button]:w-full">{applyAction}</div> : undefined}
        meta={
          <>
            {closed ? <ToneBadge tone="destructive">Applications closed</ToneBadge> : <ToneBadge tone="success">Open for applications</ToneBadge>}
            {[challenge.district, challenge.state_code].filter(Boolean).length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {[challenge.district, challenge.state_code].filter(Boolean).join(", ")}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Target className="size-3.5" />
              {challenge.kpis.length} measure{challenge.kpis.length === 1 ? "" : "s"}
            </span>
          </>
        }
      />

      <Flash searchParams={query} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="The problem">
            <div className="flex flex-col gap-5 text-[15px] leading-relaxed text-pretty whitespace-pre-line text-foreground/85">
              <p>{challenge.problem_statement}</p>
              {challenge.current_situation && (
                <div className="rounded-2xl bg-surface/70 p-4">
                  <h3 className="text-[13px] font-semibold text-foreground">How it is handled today</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{challenge.current_situation}</p>
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title="What will be measured"
            description="Your application commits to a value on each of these. The primary measure decides the pilot design and the Evidence Report."
          >
            <ul className="flex flex-col gap-3">
              {kpis.map((kpi) => {
                const lower = kpi.direction === "lower";
                const Direction = lower ? ArrowDownRight : ArrowUpRight;
                return (
                  <li key={kpi.name} className={cn("rounded-2xl p-4", kpi.is_primary ? "bg-brand/[0.06] ring-1 ring-brand/20" : "bg-surface/70")}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground">{kpi.name}</h3>
                          {kpi.is_primary && <ToneBadge tone="brand">Primary</ToneBadge>}
                        </div>
                        <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{kpi.baseline_method}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 rounded-xl bg-card px-3.5 py-2.5 shadow-card">
                        <div className="flex flex-col">
                          <span className="text-[11px] text-muted-foreground">Baseline</span>
                          <span className="font-display text-base font-semibold tabular-nums">{kpi.baseline_value ?? "TBD"}</span>
                        </div>
                        <span className={cn("grid size-6 place-items-center rounded-full", "bg-success/12 text-success-ink")}>
                          <Direction className="size-3.5" />
                        </span>
                        <div className="flex flex-col">
                          <span className="text-[11px] text-muted-foreground">Target</span>
                          <span className="font-display text-base font-semibold tabular-nums">{kpi.target_value ?? "Not set"}</span>
                        </div>
                        <span className="self-end pb-0.5 text-[12px] text-muted-foreground">{kpi.unit}</span>
                      </div>
                    </div>
                    <p className="mt-3 text-[12px] font-medium text-muted-foreground">{kpi.direction_label}</p>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel
            title="How your application will be judged"
            description="Round one is blind: evaluators do not see who you are. Each criterion is scored from 1 to 5 against the anchors, with a written justification."
          >
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {challenge.criteria.map((criterion, index) => (
                <span key={criterion.name} className={cn("h-full first:rounded-l-full last:rounded-r-full", WEIGHT_COLORS[index % WEIGHT_COLORS.length])} style={{ width: (criterion.weight / totalWeight) * 100 + "%" }} />
              ))}
            </div>
            <Accordion type="single" collapsible className="mt-3">
              {challenge.criteria.map((criterion, index) => (
                <AccordionItem key={criterion.name} value={criterion.name}>
                  <AccordionTrigger>
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <span className={cn("size-2.5 shrink-0 rounded-full", WEIGHT_COLORS[index % WEIGHT_COLORS.length])} />
                      <span className="truncate">{criterion.name}</span>
                      <span className="ml-auto shrink-0 pr-2 font-mono text-[12px] text-muted-foreground tabular-nums">{criterion.weight}%</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{criterion.description}</p>
                    {criterion.anchors && Object.keys(criterion.anchors).length > 0 && (
                      <ol className="mt-3 flex flex-col gap-1.5">
                        {Object.entries(criterion.anchors)
                          .sort(([a], [b]) => Number(a) - Number(b))
                          .map(([score, anchor]) => (
                            <li key={score} className="flex gap-3 rounded-xl bg-surface/70 px-3 py-2 text-[13px]">
                              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-card font-mono text-[11px] font-semibold text-foreground shadow-lift">{score}</span>
                              <span className="leading-relaxed text-muted-foreground">{anchor}</span>
                            </li>
                          ))}
                      </ol>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Panel>

          {(challenge.constraints || challenge.pilot_scope || challenge.commercial_terms) && (
            <Panel title="Constraints and scope">
              <div className="flex flex-col divide-y divide-border/70">
                {[
                  { icon: Construction, title: "Constraints", body: challenge.constraints },
                  { icon: Target, title: "Pilot scope", body: challenge.pilot_scope },
                  { icon: Gavel, title: "Commercial terms", body: challenge.commercial_terms },
                ]
                  .filter((block) => block.body)
                  .map((block) => (
                    <div key={block.title} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-glyph">
                        <block.icon className="size-4" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <h3 className="text-[13px] font-semibold text-foreground">{block.title}</h3>
                        <p className="text-[13px] leading-relaxed text-pretty whitespace-pre-line text-muted-foreground">{block.body}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </Panel>
          )}

          <Panel id="questions" title="Questions and answers" description="Answers are published to every applicant at once and the asker is never named.">
            {challenge.clarifications.length ? (
              <ol className="flex flex-col divide-y divide-border/70">
                {challenge.clarifications.map((item, index) => (
                  <li key={index} className="flex flex-col gap-2 py-4 first:pt-0">
                    <p className="text-[12px] text-muted-foreground">Published {formatDateTime(item.published_at)}</p>
                    <p className="text-sm font-semibold text-foreground">{item.question}</p>
                    <p className="max-w-prose text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{item.answer}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon={MessageCircleQuestion} title="No answered questions yet" description="Questions from applicants appear here with their answers, for everyone at once." className="py-8" />
            )}

            {isStartup && !questionsClosed ? (
              <form action={askClarification} className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-5">
                <input type="hidden" name="challenge_id" value={challenge.id} />
                <TextAreaField
                  label="Ask a question"
                  name="question"
                  rows={3}
                  required
                  minLength={10}
                  hint="Your name is stored but never shown. The answer is published to every applicant."
                />
                <div>
                  <SubmitButton variant="secondary" pendingLabel="Sending">
                    Send the question
                  </SubmitButton>
                </div>
              </form>
            ) : questionsClosed ? (
              <p className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <LockKeyhole className="size-3.5" />
                The question window closed on {formatDateTime(challenge.clarification_cutoff)}.
              </p>
            ) : null}
          </Panel>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <section className="overflow-hidden rounded-3xl bg-card shadow-card">
            <div className="relative overflow-hidden bg-[#0e0e10] p-5 text-white">
              <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-[radial-gradient(closest-side,rgba(252,76,1,0.45),transparent)]" />
              <div className="relative flex flex-col gap-1">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white/60">
                  <CalendarClock className="size-3.5" />
                  {closed ? "Applications closed" : "Applications close"}
                </span>
                {closed ? (
                  <span className="font-display text-2xl font-semibold tracking-tight">Closed</span>
                ) : (
                  <span className="font-display text-[40px] leading-none font-semibold tracking-tight tabular-nums">
                    {daysLeft ?? "No date"}
                    {daysLeft !== null && <span className="ml-1.5 text-base font-medium text-white/60">{daysLeft === 1 ? "day left" : "days left"}</span>}
                  </span>
                )}
                <span className="mt-1 text-[13px] text-white/60">
                  {challenge.application_deadline ? formatDateTime(challenge.application_deadline) : "No deadline set"}
                  {challenge.application_deadline && !closed && <> ({relativeDeadline(challenge.application_deadline)})</>}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-4 p-5">
              {applyAction}
              {isStartup && existing && closed && (
                <LinkButton href={"/my-applications/" + existing.id} variant="secondary" className="w-full">
                  View your application
                </LinkButton>
              )}

              <dl className="flex flex-col divide-y divide-border/70">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <fact.icon className="mt-0.5 size-4 shrink-0 text-glyph" />
                    <dt className="text-[13px] text-muted-foreground">{fact.label}</dt>
                    <dd className="ml-auto max-w-[60%] text-right text-[13px] font-medium text-pretty text-foreground tabular-nums">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <Panel title="Who can apply">
            <p className="text-[13px] leading-relaxed text-pretty whitespace-pre-line text-muted-foreground">
              {challenge.eligibility_notes || "Open to startups recognised by the Department for Promotion of Industry and Internal Trade."}
            </p>
            <Callout tone="success" icon={ShieldCheck} title="Startup relaxation" className="mt-4">
              Prior turnover and experience criteria are relaxed automatically for a recognised startup, and the rule used is recorded against your application. Quality and technical criteria are never relaxed.
            </Callout>
          </Panel>

          <Panel title="What happens after you apply">
            <Timeline items={AFTER} />
          </Panel>
        </aside>
      </div>
    </Page>
  );
}
