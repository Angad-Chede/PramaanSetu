import type { Metadata } from "next";
import { CheckCircle2, CircleAlert, Eye, Sparkles, TriangleAlert, Wand2 } from "lucide-react";

import { autosaveChallenge, requestAiDraft, saveChallengeAndReturn, submitChallenge } from "@/app/challenges/actions";
import { Disclosure, SubmitButton } from "@/components/app/forms";
import { Callout, Flash, LinkButton, Page, PageHeader, Panel, StateBadge, fieldLabel } from "@/components/app/kit";
import { all, apiGet, apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, IP_OPTION_LABELS, formatDateTime } from "@/lib/format";
import { requireSession } from "@/lib/session";
import type { Challenge, QualityFlag } from "@/lib/types";

import { BuilderForm, type BuilderValues } from "./_components/builder-form";

export const metadata: Metadata = { title: "Challenge Builder" };
export const dynamic = "force-dynamic";

type Checklist = {
  blocking_problems: { field: string; detail: string; fix: string }[];
  quality_flags: QualityFlag[];
  ready_to_submit: boolean;
  summary: string;
};

const STEPS = [
  { id: "step-1", label: "The problem", fields: ["title", "problem_statement"] },
  { id: "step-2", label: "Current situation", fields: ["current_situation"] },
  { id: "step-3", label: "Outcome and measures", fields: ["outcome_statement", "kpis"] },
  { id: "step-4", label: "Constraints", fields: ["constraints", "sector", "state_code", "district"] },
  { id: "step-5", label: "Pilot scope and deadlines", fields: ["pilot_scope", "application_deadline", "clarification_cutoff", "evaluation_deadline", "pilot_duration_weeks"] },
  { id: "step-6", label: "Terms and eligibility", fields: ["budget_ceiling_paise", "budget_ceiling_rupees", "ip_option", "commercial_terms", "criteria", "eligibility_rules"] },
];

function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditChallengePage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [, challenge, checklist] = await all(
    requireSession("/challenges/" + id + "/edit"),
    apiGetOrNotFound<Challenge>("/challenges/" + id),
    apiGet<Checklist>("/challenges/" + id + "/checklist"),
  );

  const editable = challenge.state === "Draft";
  const rules = (challenge.eligibility_rules ?? {}) as Record<string, unknown>;
  const meta = challenge.ai_draft_meta ?? {};
  const warnings = Array.isArray(meta.warnings) ? (meta.warnings as string[]) : [];
  const blocking = checklist.blocking_problems;

  const values: BuilderValues = {
    id: challenge.id,
    version: challenge.version,
    title: challenge.title ?? "",
    problem_statement: challenge.problem_statement ?? "",
    current_situation: challenge.current_situation ?? "",
    outcome_statement: challenge.outcome_statement ?? "",
    constraints: challenge.constraints ?? "",
    pilot_scope: challenge.pilot_scope ?? "",
    commercial_terms: challenge.commercial_terms ?? "",
    sector: challenge.sector ?? "",
    state_code: challenge.state_code ?? "",
    district: challenge.district ?? "",
    location_required: Boolean(challenge.location_required),
    application_deadline: toLocalInput(challenge.application_deadline),
    clarification_cutoff: toLocalInput(challenge.clarification_cutoff),
    evaluation_deadline: toLocalInput(challenge.evaluation_deadline),
    pilot_duration_weeks: challenge.pilot_duration_weeks,
    budget_ceiling_rupees: challenge.budget_ceiling ? challenge.budget_ceiling.paise / 100 : "",
    ip_option: challenge.ip_option ?? "startup_retains",
    min_turnover_rupees: Number(rules.min_turnover_paise ?? 0) / 100,
    min_experience_years: Number(rules.min_experience_years ?? 0),
    require_dpiit: rules.require_dpiit !== false,
    eligibility_notes: String(rules.notes ?? ""),
    kpis: challenge.kpis ?? [],
    criteria: challenge.criteria ?? [],
  };

  const stepProblems = (fields: string[]) =>
    blocking.filter((problem) => fields.some((field) => problem.field === field || problem.field.startsWith(field + "."))).length;

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/challenges/" + challenge.id, label: "Challenge record" }}
        eyebrow={
          <>
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              <Sparkles className="size-3.5 text-brand" />
              Challenge Builder
            </span>
            <span className="font-mono">{challenge.reference}</span>
            <StateBadge state={challenge.state} labels={CHALLENGE_STATE_LABELS} />
          </>
        }
        title={challenge.title || "Untitled challenge"}
        description="Every field is editable. A measure without a unit, a measurement method, a baseline and a target cannot be submitted, because a pilot cannot be judged against it."
        actions={
          <LinkButton href={"/challenges/" + challenge.id}>
            <Eye />
            View the record
          </LinkButton>
        }
      />

      <Flash searchParams={query} />

      {!editable && (
        <Callout tone="warning" title="This challenge is no longer a draft">
          It is {(CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state).toLowerCase()}. A published challenge can only change through a logged corrigendum, which notifies every startup that viewed or applied.
        </Callout>
      )}

      {challenge.return_comments && (
        <Callout tone="warning" title="Returned by the approver">
          {challenge.return_comments}
        </Callout>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 min-w-0 lg:order-1">
          <BuilderForm
            values={values}
            editable={editable}
            readyToSubmit={checklist.ready_to_submit}
            saveAction={saveChallengeAndReturn}
            submitAction={submitChallenge}
            autosaveAction={autosaveChallenge}
            ipOptions={Object.entries(IP_OPTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>

        <aside className="order-1 flex flex-col gap-4 lg:sticky lg:top-20 lg:order-2 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pb-2 lg:scrollbar-none">
          <section className="flex flex-col gap-4 rounded-3xl bg-card p-5 shadow-card">
            <div className="flex items-center gap-3">
              <span
                className={
                  "grid size-10 shrink-0 place-items-center rounded-2xl " +
                  (checklist.ready_to_submit ? "bg-success/12 text-success-ink" : "bg-warning/14 text-warning-ink")
                }
              >
                {checklist.ready_to_submit ? <CheckCircle2 className="size-5" /> : <CircleAlert className="size-5" />}
              </span>
              <div className="min-w-0">
                <p className="font-display text-[15px] font-semibold tracking-tight">{checklist.ready_to_submit ? "Ready to submit" : `${blocking.length} to fix before submitting`}</p>
                <p className="text-[13px] leading-snug text-muted-foreground">{checklist.summary}</p>
              </div>
            </div>

            <nav aria-label="Builder steps" className="flex flex-col">
              {STEPS.map((step, index) => {
                const count = stepProblems(step.fields);
                return (
                  <a
                    key={step.id}
                    href={"#" + step.id}
                    className="group flex items-center gap-3 rounded-xl px-2 py-2 text-sm transition-colors outline-none hover:bg-surface focus-visible:bg-surface"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-semibold tabular-nums group-hover:bg-card group-hover:shadow-lift">{index + 1}</span>
                    <span className="flex-1 text-foreground/85 group-hover:text-foreground">{step.label}</span>
                    {count > 0 ? (
                      <span className="rounded-full bg-destructive/12 px-1.5 text-[11px] font-semibold text-destructive-ink tabular-nums">{count}</span>
                    ) : (
                      <CheckCircle2 className="size-4 text-success/80" />
                    )}
                  </a>
                );
              })}
            </nav>

            {blocking.length > 0 && (
              <ul className="flex flex-col gap-2.5 border-t border-border/70 pt-4">
                {blocking.map((problem, index) => (
                  <li key={problem.field + index} className="flex gap-2 text-[13px] leading-snug">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    <span>
                      <span className="font-medium text-foreground">{fieldLabel(problem.field)}:</span> <span className="text-muted-foreground">{problem.detail} {problem.fix}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {checklist.quality_flags.length > 0 && (
            <Panel title="Quality checks" description="Advisory. You can submit with these open, but your approver sees them on the summary.">
              <ul className="flex flex-col gap-2.5">
                {checklist.quality_flags.map((flag) => (
                  <li key={flag.code + flag.field} className="flex gap-2 text-[13px] leading-snug text-muted-foreground">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    {flag.message}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {editable && (
            <form action={requestAiDraft} className="flex flex-col gap-3 rounded-3xl bg-surface/70 p-5">
              <input type="hidden" name="challenge_id" value={challenge.id} />
              <input type="hidden" name="problem_statement" value={challenge.problem_statement ?? ""} />
              <input type="hidden" name="current_situation" value={challenge.current_situation ?? ""} />
              <input type="hidden" name="constraints" value={challenge.constraints ?? ""} />
              <div>
                <p className="text-sm font-medium">Start the structure again</p>
                <p className="text-[13px] leading-snug text-muted-foreground">Redrafts the outcome, measures and rubric from the saved problem description.</p>
              </div>
              <SubmitButton
                variant="outline"
                size="sm"
                pendingLabel="Drafting"
                confirmTitle="Redraft the structure?"
                confirm="The drafter replaces the outcome, measures and rubric with a new proposal from the saved problem description. Save your edits first if you want to keep them."
                confirmLabel="Redraft"
              >
                <Wand2 />
                Redraft the structure
              </SubmitButton>
            </form>
          )}

          {Object.keys(meta).length > 0 && (
            <Disclosure
              summary={
                <span className="inline-flex items-center gap-2">
                  <Sparkles className="size-4 text-glyph" />
                  How this draft was produced
                </span>
              }
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt>Model</dt>
                <dd className="text-right font-mono text-foreground">{String(meta.model ?? "not recorded")}</dd>
                <dt>Prompt</dt>
                <dd className="text-right font-mono text-foreground">{String(meta.prompt_version ?? "not recorded")}</dd>
                <dt>Tokens</dt>
                <dd className="text-right text-foreground tabular-nums">
                  {String(meta.prompt_tokens ?? 0)} in, {String(meta.completion_tokens ?? 0)} out
                </dd>
                <dt>Generated</dt>
                <dd className="text-right text-foreground">{typeof meta.generated_at === "string" ? formatDateTime(meta.generated_at) : "not recorded"}</dd>
              </dl>
              {warnings.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-4">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              <p className="mt-3">The drafter may not produce a baseline or target you did not supply. Any such value is left blank and flagged for you to complete.</p>
            </Disclosure>
          )}
        </aside>
      </div>
    </Page>
  );
}
