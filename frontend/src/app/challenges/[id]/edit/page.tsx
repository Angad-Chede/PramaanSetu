import type { Metadata } from "next";
import Link from "next/link";

import {
  requestAiDraft,
  saveChallengeAndReturn,
  submitChallenge,
} from "@/app/challenges/actions";
import { AutosaveForm, Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  Field,
  PageHeader,
  Pill,
  ProblemList,
  Section,
} from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, IP_OPTION_LABELS } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { requireSession } from "@/lib/session";
import type { Challenge, QualityFlag } from "@/lib/types";

export const metadata: Metadata = { title: "Edit challenge" };
export const dynamic = "force-dynamic";

type Checklist = {
  blocking_problems: { field: string; detail: string; fix: string }[];
  quality_flags: QualityFlag[];
  ready_to_submit: boolean;
  summary: string;
};

const SECTORS = [
  "Water",
  "Urban solid waste",
  "Urban mobility",
  "Public health",
  "Agriculture",
  "Energy",
  "Education",
  "Disaster management",
];

const EMPTY_KPI = {
  id: "",
  name: "",
  unit: "",
  kind: "continuous",
  direction: "lower" as const,
  baseline_value: null,
  baseline_sd: null,
  baseline_source: "",
  baseline_method: "",
  baseline_plan: "",
  target_value: null,
  is_primary: false,
  direction_label: "",
  problems: [],
};

const EMPTY_CRITERION = {
  id: "",
  name: "",
  description: "",
  weight: 0,
  anchors: {} as Record<string, string>,
  round_number: 1,
};

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

export default async function EditChallengePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession("/challenges/" + params.id + "/edit");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + params.id);
  const checklist = await apiGet<Checklist>("/challenges/" + params.id + "/checklist");

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);

  const kpis = challenge.kpis?.length ? challenge.kpis : [EMPTY_KPI, EMPTY_KPI];
  const criteria = challenge.criteria?.length
    ? challenge.criteria
    : [EMPTY_CRITERION, EMPTY_CRITERION, EMPTY_CRITERION];
  const primaryIndex = Math.max(
    0,
    kpis.findIndex((kpi) => kpi.is_primary),
  );
  const rules = (challenge.eligibility_rules ?? {}) as Record<string, unknown>;
  const editable = challenge.state === "Draft";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={challenge.title || "Untitled challenge"}
        subtitle="Every field here is editable. A measure without a unit, a measurement method, a baseline and a target cannot be submitted, because a pilot cannot be judged against it."
        meta={
          <>
            <Pill>{challenge.reference}</Pill>
            <Pill tone={editable ? "neutral" : "warn"}>
              {CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state}
            </Pill>
          </>
        }
        actions={<Link href={"/challenges/" + challenge.id} className="btn btn-secondary">View the record</Link>}
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Saved">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="This could not be saved">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {!editable ? (
        <div className="mb-5">
          <Callout tone="warn" title="This challenge is no longer a draft">
            It is in state {CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state}. A published
            challenge can only be changed by a logged corrigendum, which notifies every startup that
            viewed or applied to it.
          </Callout>
        </div>
      ) : null}

      {challenge.return_comments ? (
        <div className="mb-5">
          <Callout tone="warn" title="Returned by the approver">
            {challenge.return_comments}
          </Callout>
        </div>
      ) : null}

      {challenge.ai_draft_meta && Object.keys(challenge.ai_draft_meta).length ? (
        <div className="mb-5">
          <Disclosure summary="How this draft was produced">
            <ul className="space-y-1">
              <li>Model: {String(challenge.ai_draft_meta.model ?? "not recorded")}</li>
              <li>Prompt version: {String(challenge.ai_draft_meta.prompt_version ?? "not recorded")}</li>
              <li>
                Tokens: {String(challenge.ai_draft_meta.prompt_tokens ?? 0)} in,{" "}
                {String(challenge.ai_draft_meta.completion_tokens ?? 0)} out
              </li>
              <li>Generated: {String(challenge.ai_draft_meta.generated_at ?? "not recorded")}</li>
            </ul>
            {Array.isArray(challenge.ai_draft_meta.warnings) &&
            (challenge.ai_draft_meta.warnings as string[]).length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {(challenge.ai_draft_meta.warnings as string[]).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2">
              The drafter may not produce a baseline or target you did not supply. Any such value is
              left blank and flagged for you to complete.
            </p>
          </Disclosure>
        </div>
      ) : null}

      <Section
        title="Before you submit"
        description={checklist.summary}
        actions={
          editable ? (
            <form action={requestAiDraft}>
              <input type="hidden" name="challenge_id" value={challenge.id} />
              <input type="hidden" name="problem_statement" value={challenge.problem_statement ?? ""} />
              <input type="hidden" name="current_situation" value={challenge.current_situation ?? ""} />
              <input type="hidden" name="constraints" value={challenge.constraints ?? ""} />
              <SubmitButton variant="secondary" pendingLabel="Drafting...">
                Redraft the structure
              </SubmitButton>
            </form>
          ) : null
        }
      >
        {checklist.blocking_problems.length ? (
          <ProblemList problems={checklist.blocking_problems} />
        ) : (
          <Callout tone="good" title="Ready to submit">
            Every measure and criterion is complete. Submitting sends a one-page summary to your
            approver.
          </Callout>
        )}

        {checklist.quality_flags.length ? (
          <div className="mt-4">
            <Callout tone="warn" title="Quality checks">
              <ul className="space-y-2">
                {checklist.quality_flags.map((flag) => (
                  <li key={flag.code + flag.field}>{flag.message}</li>
                ))}
              </ul>
              <p className="mt-2 text-ink-muted">
                These are advisory. You can submit with them outstanding, but the approver sees them
                on the summary.
              </p>
            </Callout>
          </div>
        ) : null}
      </Section>

      <AutosaveForm action={saveChallengeAndReturn} className="space-y-5">
        <input type="hidden" name="challenge_id" value={challenge.id} />
        <input type="hidden" name="version" value={challenge.version} />

        <Section title="Step 1. The problem" description="What is going wrong, who is affected and how often.">
          <div className="max-w-form space-y-4">
            <Field label="Title" name="title" required help="Name the outcome and the place, not the technology.">
              <input id="title" name="title" defaultValue={challenge.title} disabled={!editable} required />
            </Field>
            <Field label="Problem description" name="problem_statement" required>
              <textarea
                id="problem_statement"
                name="problem_statement"
                rows={7}
                defaultValue={challenge.problem_statement}
                disabled={!editable}
              />
            </Field>
          </div>
        </Section>

        <Section title="Step 2. The current situation" description="How the service is run today, and where its data comes from.">
          <div className="max-w-form">
            <Field
              label="How it is handled today"
              name="current_situation"
              help="The current process, the data already collected and who collects it."
            >
              <textarea
                id="current_situation"
                name="current_situation"
                rows={5}
                defaultValue={challenge.current_situation}
                disabled={!editable}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Step 3. The outcome and how it is measured"
          description="State the change you want in the measure, with a number. Avoid words such as improve or optimise with nothing behind them."
        >
          <div className="max-w-form">
            <Field label="Outcome statement" name="outcome_statement" required>
              <textarea
                id="outcome_statement"
                name="outcome_statement"
                rows={4}
                defaultValue={challenge.outcome_statement}
                disabled={!editable}
              />
            </Field>
          </div>

          <h3 className="mt-6">Measures</h3>
          <p className="help mb-3">
            Between 1 and 5. Exactly one is the primary measure: the pilot design and the Evidence
            Report are built around it.
          </p>

          <div className="space-y-4">
            {kpis.map((kpi, index) => (
              <fieldset key={index} className="rounded border border-line bg-paper-soft p-4">
                <legend className="px-1 text-sm font-semibold text-ink">Measure {index + 1}</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" name={"kpi_name_" + index} required>
                    <input
                      id={"kpi_name_" + index}
                      name="kpi_name"
                      defaultValue={kpi.name}
                      disabled={!editable}
                    />
                  </Field>
                  <Field label="Unit" name={"kpi_unit_" + index} required help="For example percent, hours, rupees per case.">
                    <input
                      id={"kpi_unit_" + index}
                      name="kpi_unit"
                      defaultValue={kpi.unit}
                      disabled={!editable}
                    />
                  </Field>
                  <Field label="Kind" name={"kpi_kind_" + index}>
                    <select id={"kpi_kind_" + index} name="kpi_kind" defaultValue={kpi.kind} disabled={!editable}>
                      <option value="continuous">A continuous quantity</option>
                      <option value="proportion">A rate or percentage</option>
                    </select>
                  </Field>
                  <Field label="Which direction is better?" name={"kpi_direction_" + index}>
                    <select
                      id={"kpi_direction_" + index}
                      name="kpi_direction"
                      defaultValue={kpi.direction}
                      disabled={!editable}
                    >
                      <option value="lower">Lower is better</option>
                      <option value="higher">Higher is better</option>
                    </select>
                  </Field>
                  <Field
                    label="Baseline value"
                    name={"kpi_baseline_" + index}
                    help="Leave blank only if you will collect the baseline before the pilot starts."
                  >
                    <input
                      id={"kpi_baseline_" + index}
                      name="kpi_baseline"
                      type="number"
                      step="any"
                      defaultValue={kpi.baseline_value ?? ""}
                      disabled={!editable}
                    />
                  </Field>
                  <Field
                    label="Baseline variability"
                    name={"kpi_baseline_sd_" + index}
                    help="How much this measure varies between units. The simulator needs it to size the pilot."
                  >
                    <input
                      id={"kpi_baseline_sd_" + index}
                      name="kpi_baseline_sd"
                      type="number"
                      step="any"
                      defaultValue={kpi.baseline_sd ?? ""}
                      disabled={!editable}
                    />
                  </Field>
                  <Field label="Target value" name={"kpi_target_" + index} required>
                    <input
                      id={"kpi_target_" + index}
                      name="kpi_target"
                      type="number"
                      step="any"
                      defaultValue={kpi.target_value ?? ""}
                      disabled={!editable}
                    />
                  </Field>
                  <Field label="Where the data comes from" name={"kpi_baseline_source_" + index}>
                    <input
                      id={"kpi_baseline_source_" + index}
                      name="kpi_baseline_source"
                      defaultValue={kpi.baseline_source}
                      disabled={!editable}
                    />
                  </Field>
                </div>

                <div className="mt-4 space-y-4">
                  <Field
                    label="How is it measured?"
                    name={"kpi_baseline_method_" + index}
                    required
                    help="Be precise enough that a validator could reproduce the number from the source."
                  >
                    <textarea
                      id={"kpi_baseline_method_" + index}
                      name="kpi_baseline_method"
                      rows={3}
                      defaultValue={kpi.baseline_method}
                      disabled={!editable}
                    />
                  </Field>
                  <Field
                    label="Baseline collection plan"
                    name={"kpi_baseline_plan_" + index}
                    help="Only needed if the baseline value is blank."
                  >
                    <input
                      id={"kpi_baseline_plan_" + index}
                      name="kpi_baseline_plan"
                      defaultValue={kpi.baseline_plan}
                      disabled={!editable}
                    />
                  </Field>
                  <div className="flex items-center gap-2">
                    <input
                      id={"primary_kpi_" + index}
                      type="radio"
                      name="primary_kpi"
                      value={String(index)}
                      defaultChecked={index === primaryIndex}
                      disabled={!editable}
                      className="h-4 w-4"
                    />
                    <label htmlFor={"primary_kpi_" + index} className="font-normal">
                      This is the primary measure
                    </label>
                  </div>
                </div>

                {kpi.problems.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-bad">
                    {kpi.problems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </fieldset>
            ))}
          </div>
        </Section>

        <Section title="Step 4. Constraints" description="What the solution must respect, whatever it is.">
          <div className="max-w-form space-y-4">
            <Field label="Constraints" name="constraints">
              <textarea
                id="constraints"
                name="constraints"
                rows={5}
                defaultValue={challenge.constraints}
                disabled={!editable}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sector" name="sector">
                <select id="sector" name="sector" defaultValue={challenge.sector ?? ""} disabled={!editable}>
                  <option value="">Open to all sectors</option>
                  {SECTORS.map((sector) => (
                    <option key={sector} value={sector}>
                      {sector}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="State code" name="state_code" help="Two letters, for example MH.">
                <input
                  id="state_code"
                  name="state_code"
                  defaultValue={challenge.state_code ?? ""}
                  maxLength={4}
                  disabled={!editable}
                />
              </Field>
              <Field label="District" name="district">
                <input id="district" name="district" defaultValue={challenge.district ?? ""} disabled={!editable} />
              </Field>
              <div className="flex items-center gap-2 pt-6">
                <input
                  id="location_required"
                  name="location_required"
                  type="checkbox"
                  defaultChecked={challenge.location_required}
                  disabled={!editable}
                  className="h-4 w-4"
                />
                <label htmlFor="location_required" className="font-normal">
                  Restrict applicants to this state
                </label>
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="Step 5. The pilot scope and the deadlines"
          description="Name the area, the units and the period. Keep the pilot small enough to run and large enough to measure."
        >
          <div className="max-w-form space-y-4">
            <Field label="Pilot scope" name="pilot_scope" required>
              <textarea
                id="pilot_scope"
                name="pilot_scope"
                rows={5}
                defaultValue={challenge.pilot_scope}
                disabled={!editable}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Application deadline" name="application_deadline" required>
                <input
                  id="application_deadline"
                  name="application_deadline"
                  type="datetime-local"
                  defaultValue={toLocalInput(challenge.application_deadline)}
                  disabled={!editable}
                />
              </Field>
              <Field label="Questions close on" name="clarification_cutoff">
                <input
                  id="clarification_cutoff"
                  name="clarification_cutoff"
                  type="datetime-local"
                  defaultValue={toLocalInput(challenge.clarification_cutoff)}
                  disabled={!editable}
                />
              </Field>
              <Field label="Evaluation deadline" name="evaluation_deadline">
                <input
                  id="evaluation_deadline"
                  name="evaluation_deadline"
                  type="datetime-local"
                  defaultValue={toLocalInput(challenge.evaluation_deadline)}
                  disabled={!editable}
                />
              </Field>
              <Field label="Indicative pilot length in weeks" name="pilot_duration_weeks">
                <input
                  id="pilot_duration_weeks"
                  name="pilot_duration_weeks"
                  type="number"
                  min={1}
                  max={52}
                  defaultValue={challenge.pilot_duration_weeks}
                  disabled={!editable}
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section
          title="Step 6. Commercial terms and eligibility"
          description="The budget ceiling, the intellectual property position and the published criteria."
        >
          <div className="max-w-form space-y-4">
            <Field
              label="Budget ceiling in rupees"
              name="budget_ceiling_rupees"
              required
              help="Startups cannot size a proposal without one, and screening cannot check cost against a ceiling."
            >
              <input
                id="budget_ceiling_rupees"
                name="budget_ceiling_rupees"
                type="number"
                min={0}
                step={1000}
                defaultValue={challenge.budget_ceiling ? challenge.budget_ceiling.paise / 100 : ""}
                disabled={!editable}
              />
            </Field>

            <Field label="Intellectual property option" name="ip_option">
              <select id="ip_option" name="ip_option" defaultValue={challenge.ip_option ?? "startup_retains"} disabled={!editable}>
                {Object.entries(IP_OPTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Commercial terms" name="commercial_terms">
              <textarea
                id="commercial_terms"
                name="commercial_terms"
                rows={4}
                defaultValue={challenge.commercial_terms}
                disabled={!editable}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Minimum prior turnover in rupees"
                name="min_turnover_rupees"
                help="Automatically relaxed for a recognised startup, with the rule recorded."
              >
                <input
                  id="min_turnover_rupees"
                  name="min_turnover_rupees"
                  type="number"
                  min={0}
                  defaultValue={Number(rules.min_turnover_paise ?? 0) / 100}
                  disabled={!editable}
                />
              </Field>
              <Field
                label="Minimum prior experience in years"
                name="min_experience_years"
                help="Also relaxed automatically for a recognised startup."
              >
                <input
                  id="min_experience_years"
                  name="min_experience_years"
                  type="number"
                  min={0}
                  defaultValue={Number(rules.min_experience_years ?? 0)}
                  disabled={!editable}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="require_dpiit"
                name="require_dpiit"
                type="checkbox"
                defaultChecked={rules.require_dpiit !== false}
                disabled={!editable}
                className="h-4 w-4"
              />
              <label htmlFor="require_dpiit" className="font-normal">
                Applicants must be recognised by the Department for Promotion of Industry and
                Internal Trade
              </label>
            </div>

            <Field label="Eligibility notes shown to applicants" name="eligibility_notes">
              <textarea
                id="eligibility_notes"
                name="eligibility_notes"
                rows={4}
                defaultValue={String(rules.notes ?? "")}
                disabled={!editable}
              />
            </Field>
          </div>

          <h3 className="mt-6">Evaluation rubric</h3>
          <p className="help mb-3">
            Weights must sum to exactly 100. Evaluators score each criterion from 1 to 5 against the
            anchors, with a written justification.
          </p>
          <div className="space-y-4">
            {criteria.map((criterion, index) => (
              <fieldset key={index} className="rounded border border-line bg-paper-soft p-4">
                <legend className="px-1 text-sm font-semibold text-ink">Criterion {index + 1}</legend>
                <div className="grid gap-4 sm:grid-cols-[1fr,8rem]">
                  <Field label="Name" name={"criterion_name_" + index}>
                    <input
                      id={"criterion_name_" + index}
                      name="criterion_name"
                      defaultValue={criterion.name}
                      disabled={!editable}
                    />
                  </Field>
                  <Field label="Weight" name={"criterion_weight_" + index}>
                    <input
                      id={"criterion_weight_" + index}
                      name="criterion_weight"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={criterion.weight}
                      disabled={!editable}
                    />
                  </Field>
                </div>
                <div className="mt-4 space-y-4">
                  <Field label="What is being judged" name={"criterion_description_" + index}>
                    <textarea
                      id={"criterion_description_" + index}
                      name="criterion_description"
                      rows={2}
                      defaultValue={criterion.description}
                      disabled={!editable}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="What a score of 1 looks like" name={"criterion_anchor_low_" + index}>
                      <input
                        id={"criterion_anchor_low_" + index}
                        name="criterion_anchor_low"
                        defaultValue={criterion.anchors?.["1"] ?? ""}
                        disabled={!editable}
                      />
                    </Field>
                    <Field label="What a score of 5 looks like" name={"criterion_anchor_high_" + index}>
                      <input
                        id={"criterion_anchor_high_" + index}
                        name="criterion_anchor_high"
                        defaultValue={criterion.anchors?.["5"] ?? ""}
                        disabled={!editable}
                      />
                    </Field>
                  </div>
                </div>
              </fieldset>
            ))}
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            Current total weight:{" "}
            <span className="num font-semibold">
              {criteria.reduce((sum, criterion) => sum + (criterion.weight || 0), 0)}
            </span>{" "}
            of 100.
          </p>
        </Section>

        {editable ? (
          <div className="sticky bottom-0 -mx-4 border-t border-line bg-paper px-4 py-3 no-print sm:mx-0 sm:rounded sm:border">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <SubmitButton variant="secondary" pendingLabel="Saving...">
                Save draft
              </SubmitButton>
              <SubmitButton
                variant="primary"
                formAction={submitChallenge}
                pendingLabel="Submitting..."
                disabled={!checklist.ready_to_submit}
                confirm="Submit this challenge to your approver? They read a one-page summary and either approve it for publication or return it with comments."
              >
                Save and submit for approval
              </SubmitButton>
            </div>
          </div>
        ) : null}
      </AutosaveForm>

    </div>
  );
}
