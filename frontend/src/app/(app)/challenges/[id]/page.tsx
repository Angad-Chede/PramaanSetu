import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  ClipboardList,
  Download,
  Eye,
  FileSearch,
  Gavel,
  IndianRupee,
  MessagesSquare,
  PencilLine,
  ScrollText,
  Timer,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

import { decideChallenge, issueCorrigendum, runWorkflowStep } from "@/app/challenges/actions";
import { Disclosure, SubmitButton, TextAreaField, TextField } from "@/components/app/forms";
import {
  Deadline,
  Figure,
  FigureGrid,
  Flash,
  KeyValues,
  LinkButton,
  Page,
  PageHeader,
  Panel,
  StateBadge,
  ToneBadge,
} from "@/components/app/kit";
import { Button } from "@/components/ui/button";
import { apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, IP_OPTION_LABELS, compactRupees, formatDate, formatDateTime, money, relativeDeadline } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge, Match } from "@/lib/types";

import { Lifecycle } from "../_components/lifecycle";
import { MeasuresList, RubricView } from "../_components/measures";

export const metadata: Metadata = { title: "Challenge" };
export const dynamic = "force-dynamic";

/** What the officer can do next, in the order the workflow expects. */
const NEXT_STEP: Record<string, { action: string; label: string; detail: string; roles: string[] }> = {
  Published: {
    action: "close-applications",
    label: "Close applications now",
    detail: "Closing locks every submitted application at the current server time. Applications also close by themselves at the deadline.",
    roles: ["DO"],
  },
  ApplicationsClosed: {
    action: "screen",
    label: "Run eligibility screening",
    detail: "The rules engine checks every application against the published criteria and records a reason for each rule.",
    roles: ["DO"],
  },
  Screening: {
    action: "start-evaluation",
    label: "Start evaluation",
    detail: "The panel must be assigned first. Round one is blind to the applicant identity.",
    roles: ["DO"],
  },
  Evaluation: {
    action: "lock-scores",
    label: "Lock the scores",
    detail: "Locking stops further editing. Only the approver can reopen scoring, and the reopening is recorded.",
    roles: ["DO"],
  },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ChallengePage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession("/challenges/" + id);
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + id);
  const matches = hasRole(session, "DO", "DA")
    ? await apiGetOptional<{ items: Match[]; note: string }>("/challenges/" + id + "/matches?limit=10")
    : null;

  const isOwner = session.department_id === challenge.department_id;
  const next = NEXT_STEP[challenge.state];
  const canRunNext = Boolean(next && hasRole(session, ...next.roles) && isOwner);
  const canCorrect = ["Published", "ApplicationsClosed", "Screening"].includes(challenge.state) && hasRole(session, "DO", "DA") && isOwner;
  const canCancel = hasRole(session, "DA") && isOwner && Boolean(challenge.available_actions?.includes("cancel"));

  const related: { href: string; label: string; detail: string; icon: LucideIcon; show: boolean }[] = [
    { href: `/challenges/${id}/clarifications`, label: "Questions and answers", detail: `${challenge.clarifications?.length ?? 0} published`, icon: MessagesSquare, show: true },
    { href: `/challenges/${id}/panel`, label: "Evaluation panel", detail: "Evaluators and validators", icon: Users, show: isOwner },
    { href: `/challenges/${id}/screening`, label: "Applications and eligibility", detail: `${challenge.application_count ?? 0} received`, icon: ClipboardList, show: isOwner },
    { href: `/challenges/${id}/ranking`, label: "Scores, flags and shortlist", detail: "Ranked with disagreement flags", icon: Trophy, show: isOwner },
    { href: `/challenges/${id}/audit`, label: "Audit trail", detail: "Hash-chained history", icon: ScrollText, show: isOwner },
    { href: `/challenges-board/${id}`, label: "How applicants see this", detail: "The public listing", icon: Eye, show: true },
  ];

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/challenges", label: "Challenges" }}
        eyebrow={
          <>
            <span className="font-mono text-foreground/80">{challenge.reference}</span>
            <StateBadge state={challenge.state} labels={CHALLENGE_STATE_LABELS} />
            {challenge.sector && <ToneBadge dot={false}>{challenge.sector}</ToneBadge>}
          </>
        }
        title={challenge.title || "Untitled challenge"}
        description={challenge.outcome_statement || "No outcome statement yet."}
        meta={challenge.department_name ? <span>{challenge.department_name}</span> : undefined}
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={"/api/v1/challenges/" + challenge.id + "/summary.pdf"}>
                <Download />
                One-page summary
              </a>
            </Button>
            {challenge.state === "Draft" && hasRole(session, "DO") && (
              <LinkButton href={`/challenges/${challenge.id}/edit`} variant="brand">
                <PencilLine />
                Edit the draft
              </LinkButton>
            )}
            {challenge.state === "InReview" && hasRole(session, "DA") && (
              <LinkButton href={`/challenges/${challenge.id}/review`} variant="brand">
                <Gavel />
                Review for approval
              </LinkButton>
            )}
          </>
        }
      />

      <Flash searchParams={query} />

      <div className="rounded-3xl bg-card p-4 shadow-card md:p-5">
        <Lifecycle state={challenge.state} />
      </div>

      {canRunNext && next && (
        <section className="relative flex flex-col gap-4 overflow-hidden rounded-3xl bg-foreground p-5 text-background shadow-float md:flex-row md:items-center md:p-6">
          <div aria-hidden className="pointer-events-none absolute -top-20 -left-10 size-56 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand)_45%,transparent),transparent)]" />
          <div className="relative flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-[12px] font-medium tracking-wide uppercase opacity-60">Next step</p>
            <p className="font-display text-lg font-semibold tracking-tight">{next.label}</p>
            <p className="max-w-2xl text-[13px] leading-relaxed opacity-70">{next.detail}</p>
          </div>
          <div className="relative flex flex-wrap items-center gap-2">
            {challenge.state === "Screening" && (
              <Button asChild variant="ghost" className="text-background/80 hover:bg-background/10 hover:text-background">
                <Link href={`/challenges/${challenge.id}/panel`}>Assign the panel first</Link>
              </Button>
            )}
            <form action={runWorkflowStep}>
              <input type="hidden" name="challenge_id" value={challenge.id} />
              <input type="hidden" name="action" value={next.action} />
              <input type="hidden" name="back" value={"/challenges/" + challenge.id} />
              <SubmitButton variant="brand" pendingLabel="Working">
                {next.label}
                <ArrowRight />
              </SubmitButton>
            </form>
          </div>
        </section>
      )}

      <FigureGrid className="grid-cols-2">
        <Figure label="Budget ceiling" icon={IndianRupee} tone="brand" value={challenge.budget_ceiling && challenge.budget_ceiling.paise > 0 ? compactRupees(challenge.budget_ceiling.paise).replace("INR ", "₹") : "Not set"} hint={challenge.budget_ceiling ? money(challenge.budget_ceiling) : "Not published"} />
        <Figure label="Applications received" icon={ClipboardList} tone="info" value={challenge.application_count ?? 0} hint={challenge.state === "Published" ? "Still open" : "Locked at close"} />
        <Figure label="Indicative pilot" icon={Timer} value={`${challenge.pilot_duration_weeks} wk`} hint="Final length set by the simulator" />
        <Figure
          label="Applications close"
          icon={CalendarClock}
          tone={challenge.application_deadline && !relativeDeadline(challenge.application_deadline).includes("overdue") ? "success" : "neutral"}
          value={challenge.application_deadline ? formatDate(challenge.application_deadline) : "Not set"}
          hint={challenge.application_deadline ? relativeDeadline(challenge.application_deadline) : "Set in the builder"}
        />
      </FigureGrid>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="The problem">
            <div className="flex flex-col gap-5">
              <p className="max-w-[72ch] text-[15px] leading-relaxed text-pretty whitespace-pre-line text-foreground/90">
                {challenge.problem_statement || "Not written yet."}
              </p>
              {[
                ["How it is handled today", challenge.current_situation],
                ["Constraints", challenge.constraints],
                ["Pilot scope", challenge.pilot_scope],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-1.5 border-t border-border/70 pt-5">
                    <h3 className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
                    <p className="max-w-[72ch] text-sm leading-relaxed text-pretty whitespace-pre-line text-foreground/85">{value}</p>
                  </div>
                ))}
            </div>
          </Panel>

          <Panel
            title="Measures"
            description="Each carries a unit, a measurement method, a baseline and a target. The primary measure decides the pilot design and the Evidence Report."
          >
            <MeasuresList kpis={challenge.kpis ?? []} />
          </Panel>

          <Panel title="Evaluation rubric" description="Published with the challenge, so applicants know exactly what is judged.">
            <RubricView criteria={challenge.criteria ?? []} />
          </Panel>

          {challenge.corrigenda && challenge.corrigenda.length > 0 && (
            <Panel title="Corrigenda" description="The only permitted change to a published challenge. Every startup that viewed or applied is notified.">
              <ol className="flex flex-col gap-3">
                {challenge.corrigenda.map((corrigendum) => (
                  <li key={corrigendum.number} className="rounded-2xl bg-surface/70 p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold">Corrigendum {corrigendum.number}</p>
                      {corrigendum.issued_at && <span className="text-[12px] text-muted-foreground">{formatDateTime(corrigendum.issued_at)}</span>}
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">{corrigendum.summary}</p>
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {Object.entries(corrigendum.changes).map(([field, change]) => (
                        <li key={field} className="flex flex-wrap items-center gap-2 text-[13px]">
                          <span className="font-medium capitalize">{field.replace(/_/g, " ")}</span>
                          <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-destructive-ink line-through decoration-1">{change.from}</span>
                          <ArrowRight className="size-3 text-glyph" />
                          <span className="rounded-md bg-success/12 px-1.5 py-0.5 text-success-ink">{change.to}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          {canCorrect && (
            <Panel
              title="Issue a corrigendum"
              description="A published challenge is otherwise immutable. A corrigendum is logged and notifies every startup that viewed or applied."
            >
              <form action={issueCorrigendum} className="flex flex-col gap-5">
                <input type="hidden" name="challenge_id" value={challenge.id} />
                <TextAreaField label="What is changing, and why" name="summary" rows={3} required minLength={10} />
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField label="New application deadline" name="application_deadline" type="datetime-local" optional />
                  <TextField label="New budget ceiling in rupees" name="budget_ceiling_rupees" type="number" min={0} optional />
                </div>
                <TextAreaField label="Revised pilot scope" name="pilot_scope" rows={3} optional />
                <div className="flex justify-end">
                  <SubmitButton
                    variant="secondary"
                    confirmTitle="Publish this corrigendum?"
                    confirm="Every startup that viewed or applied will be notified, and the change is logged for good."
                    confirmLabel="Publish it"
                  >
                    Publish the corrigendum
                  </SubmitButton>
                </div>
              </form>
            </Panel>
          )}

          {canCancel && (
            <section className="rounded-3xl p-5 ring-1 ring-destructive/25 md:p-6">
              <h2 className="font-display text-[15px] font-semibold tracking-tight text-destructive-ink">Cancel this challenge</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">Only possible before a pilot agreement is signed, and only with a recorded reason.</p>
              <form action={decideChallenge} className="mt-4 flex flex-col gap-4">
                <input type="hidden" name="challenge_id" value={challenge.id} />
                <input type="hidden" name="action" value="cancel" />
                <TextAreaField label="Reason for cancellation" name="reason" rows={3} required minLength={10} />
                <div className="flex justify-end">
                  <SubmitButton
                    variant="destructive"
                    confirmTitle="Cancel this challenge?"
                    confirm="Applicants will be notified with your reason. This cannot be undone."
                    confirmLabel="Cancel the challenge"
                  >
                    Cancel the challenge
                  </SubmitButton>
                </div>
              </form>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-6 xl:sticky xl:top-20">
          <Panel title="The record">
            <KeyValues
              columns={1}
              items={[
                { label: "Department", value: challenge.department_name ?? "Not recorded" },
                { label: "Application deadline", value: <Deadline value={challenge.application_deadline} label="Closes" /> },
                { label: "Questions close", value: challenge.clarification_cutoff ? formatDateTime(challenge.clarification_cutoff) : "Not set" },
                { label: "Intellectual property", value: IP_OPTION_LABELS[challenge.ip_option ?? ""] ?? "Not selected" },
                { label: "Published", value: challenge.published_at ? formatDateTime(challenge.published_at) : "Not yet" },
                {
                  label: "Approval",
                  value: challenge.approved_by ? (
                    <span className="inline-flex items-center gap-1.5 text-success-ink">
                      <BadgeCheck className="size-4" />
                      Approved and recorded
                    </span>
                  ) : (
                    "Not yet approved"
                  ),
                },
              ]}
            />
          </Panel>

          <Panel flush title="Related pages">
            <ul className="flex flex-col px-2 pb-2">
              {related
                .filter((item) => item.show)
                .map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-150 outline-none hover:bg-surface focus-visible:bg-surface"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-surface text-glyph transition-colors group-hover:bg-card group-hover:text-foreground group-hover:shadow-lift">
                        <item.icon className="size-4" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">{item.label}</span>
                        <span className="truncate text-[12px] text-muted-foreground">{item.detail}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-glyph transition-transform duration-200 ease-ios group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
            </ul>
          </Panel>

          {matches && matches.items.length > 0 && (
            <Panel title="Matched startups" description="Ranked by meaning, keywords, sector and location. Matching decides who is invited, never who may apply.">
              <ol className="flex flex-col gap-4">
                {matches.items.slice(0, 6).map((match) => (
                  <li key={match.startup_id} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-semibold tabular-nums">{match.rank}</span>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{match.startup_name ?? "Unnamed startup"}</p>
                      <span className="font-display text-sm font-semibold tabular-nums">{(match.score * 100).toFixed(0)}</span>
                    </div>
                    <div className="ml-9 h-1 overflow-hidden rounded-full bg-recess">
                      <div className="h-full rounded-full bg-brand" style={{ width: Math.min(100, match.score * 100) + "%" }} />
                    </div>
                    {match.reasons.length > 0 && (
                      <ul className="ml-9 flex flex-col gap-0.5 text-[12px] leading-snug text-muted-foreground">
                        {match.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">{matches.note}</p>
            </Panel>
          )}

          {challenge.template_versions && Object.keys(challenge.template_versions).length > 0 && (
            <Disclosure
              summary={
                <span className="inline-flex items-center gap-2">
                  <FileSearch className="size-4 text-glyph" />
                  Templates used
                </span>
              }
            >
              <p className="mb-2">Recorded on the challenge, so a reviewer years later can reconstruct exactly what was published.</p>
              <ul className="flex flex-col gap-1">
                {Object.entries(challenge.template_versions).map(([kind, version]) => (
                  <li key={kind} className="flex justify-between gap-3">
                    <span className="capitalize">{kind.replace(/_/g, " ")}</span>
                    <span className="font-mono text-foreground">v{version}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </aside>
      </div>
    </Page>
  );
}
