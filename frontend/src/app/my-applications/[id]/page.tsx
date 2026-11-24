import type { Metadata } from "next";
import Link from "next/link";

import { saveApplication, submitApplication, withdrawApplication } from "@/app/pilots/actions";
import { AutosaveForm, Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  Deadline,
  Field,
  KeyValue,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { APPLICATION_STATE_LABELS, IP_OPTION_LABELS, decimal, isOverdue, money } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { requireSession } from "@/lib/session";
import type { Application, Challenge } from "@/lib/types";

export const metadata: Metadata = { title: "My application" };
export const dynamic = "force-dynamic";

const OUTCOME_TONE: Record<string, "good" | "warn" | "bad"> = {
  Eligible: "good",
  NeedsReview: "warn",
  Ineligible: "bad",
};

export default async function MyApplicationPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession("/my-applications/" + params.id);
  const application = await apiGetOrNotFound<Application>("/applications/" + params.id);
  const challenge = await apiGet<Challenge>("/challenges/" + application.challenge_id);

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);

  const closed =
    isOverdue(challenge.application_deadline) ||
    ["Locked", "Screened", "UnderEvaluation", "Shortlisted", "NotShortlisted", "Withdrawn"].includes(
      application.state,
    );
  const commitmentsByKpi = new Map(
    application.kpi_commitments.map((commitment) => [commitment.kpi_id, commitment]),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={challenge.title}
        subtitle={challenge.outcome_statement}
        meta={
          <>
            <Pill>{application.reference}</Pill>
            <Pill>{APPLICATION_STATE_LABELS[application.state] ?? application.state}</Pill>
            {application.eligibility ? (
              <Pill tone={OUTCOME_TONE[application.eligibility.outcome] ?? "neutral"}>
                {application.eligibility.outcome === "NeedsReview"
                  ? "Needs review"
                  : application.eligibility.outcome}
              </Pill>
            ) : null}
          </>
        }
        actions={
          <Link href={"/challenges-board/" + challenge.id} className="btn btn-secondary">
            Read the challenge
          </Link>
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That could not be completed">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      <Section title="Status">
        <KeyValue
          rows={[
            {
              label: "Applications close",
              value: <Deadline value={challenge.application_deadline} label="Closes" />,
            },
            { label: "Last submitted", value: <Timestamp value={application.submitted_at} /> },
            { label: "Locked at the deadline", value: <Timestamp value={application.locked_at} /> },
            {
              label: "Budget ceiling",
              value: challenge.budget_ceiling ? money(challenge.budget_ceiling) : "Not published",
            },
            {
              label: "Your quoted cost",
              value: application.pilot_cost ? money(application.pilot_cost) : "Not quoted",
            },
            {
              label: "Shortlist position",
              value: application.shortlist_rank ? "Rank " + application.shortlist_rank : "Not shortlisted",
            },
          ]}
        />
      </Section>

      {application.eligibility ? (
        <Section
          title="Eligibility result"
          description="Every published rule, with the reason recorded against it."
        >
          {application.eligibility.relaxations_applied.length ? (
            <div className="mb-4">
              <Callout tone="good" title="Startup relaxation applied">
                <p>
                  {application.eligibility.relaxations_applied
                    .map((relaxation) => relaxation.name.toLowerCase())
                    .join(" and ")}{" "}
                  relaxed because your startup is recognised. Quality and technical criteria are
                  unchanged.
                </p>
                <p className="mt-1 text-xs">
                  {application.eligibility.relaxations_applied[0].citation}
                </p>
              </Callout>
            </div>
          ) : null}

          <DataTable columns={["Rule", "Outcome", "Reason", "What to do"]}>
            {application.eligibility.rule_results.map((rule) => (
              <tr key={rule.code}>
                <td className="whitespace-nowrap font-medium">{rule.name}</td>
                <td>
                  <Pill tone={rule.passed ? "good" : rule.blocking ? "bad" : "warn"}>
                    {rule.passed ? "Met" : rule.blocking ? "Not met" : "Review"}
                  </Pill>
                </td>
                <td className="text-sm">{rule.reason}</td>
                <td className="text-sm text-ink-muted">{rule.fix || "No action needed"}</td>
              </tr>
            ))}
          </DataTable>

          {application.eligibility.clarification_window_ends ? (
            <p className="mt-3 text-sm">
              <Deadline
                value={application.eligibility.clarification_window_ends}
                label="You can raise a clarification until"
              />
            </p>
          ) : null}
        </Section>
      ) : null}

      {application.my_result ? (
        <Section title="Your evaluation result" description={application.my_result.note}>
          <KeyValue
            rows={[
              { label: "Rank", value: application.my_result.rank },
              {
                label: "Weighted score",
                value: decimal(application.my_result.weighted_score, 1) + " of 100",
              },
            ]}
          />
          <div className="mt-4">
            <DataTable columns={["Criterion", "Weight", "Mean score from the panel"]}>
              {application.my_result.criteria.map((criterion) => (
                <tr key={criterion.name}>
                  <td>{criterion.name}</td>
                  <td className="num">{criterion.weight}</td>
                  <td className="num">{decimal(criterion.mean, 2)}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </Section>
      ) : null}

      {!closed ? (
        <AutosaveForm action={saveApplication} className="space-y-5">
          <input type="hidden" name="application_id" value={application.id} />
          <input type="hidden" name="version" value={application.version} />

          {application.blocking_problems.length ? (
            <div>
              <ProblemList
                problems={application.blocking_problems}
                title="Complete these before submitting"
              />
            </div>
          ) : null}

          <Section title="Your proposal">
            <div className="max-w-form space-y-4">
              <Field
                label="What are you proposing?"
                name="proposal_summary"
                required
                help="Two or three sentences a non-technical officer can understand. At least 80 characters."
              >
                <textarea
                  id="proposal_summary"
                  name="proposal_summary"
                  rows={5}
                  defaultValue={application.proposal_summary}
                  minLength={80}
                />
              </Field>
              <Field
                label="How will it work during the pilot?"
                name="approach"
                required
                help="Deployment, operation, support, and how each measure will be recorded."
              >
                <textarea
                  id="approach"
                  name="approach"
                  rows={7}
                  defaultValue={application.approach}
                  minLength={80}
                />
              </Field>
            </div>
          </Section>

          <Section
            title="What you commit to"
            description="Enter the value you commit to reach by the end of the pilot for each published measure."
          >
            <div className="space-y-4">
              {(challenge.kpis ?? []).map((kpi) => {
                const commitment = commitmentsByKpi.get(kpi.id);
                return (
                  <div key={kpi.id} className="rounded border border-line bg-paper-soft p-4">
                    <input type="hidden" name="commit_kpi_id" value={kpi.id} />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3>
                        {kpi.name}
                        {kpi.is_primary ? (
                          <span className="ml-2">
                            <Pill tone="good">Primary</Pill>
                          </span>
                        ) : null}
                      </h3>
                      <p className="text-sm text-ink-muted">
                        {kpi.unit} &middot; {kpi.direction_label} &middot; baseline{" "}
                        {kpi.baseline_value ?? "to be measured"} &middot; target{" "}
                        {kpi.target_value ?? "not set"}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">{kpi.baseline_method}</p>
                    <div className="mt-3 grid gap-4 sm:grid-cols-[10rem,1fr]">
                      <Field label="Committed value" name={"commit_value_" + kpi.id} required>
                        <input
                          id={"commit_value_" + kpi.id}
                          name="commit_value"
                          type="number"
                          step="any"
                          defaultValue={commitment?.committed_value ?? ""}
                        />
                      </Field>
                      <Field label="Note (optional)" name={"commit_note_" + kpi.id}>
                        <input
                          id={"commit_note_" + kpi.id}
                          name="commit_note"
                          defaultValue={commitment?.note ?? ""}
                        />
                      </Field>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Cost, timeline and declarations">
            <div className="max-w-form space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Total pilot cost in rupees"
                  name="pilot_cost_rupees"
                  required
                  help={
                    challenge.budget_ceiling && challenge.budget_ceiling.paise > 0
                      ? "Must be at or below the published ceiling of " + money(challenge.budget_ceiling) + "."
                      : "Inclusive of all taxes."
                  }
                >
                  <input
                    id="pilot_cost_rupees"
                    name="pilot_cost_rupees"
                    type="number"
                    min={0}
                    defaultValue={application.pilot_cost ? application.pilot_cost.paise / 100 : ""}
                  />
                </Field>
                <Field label="Weeks needed for the pilot" name="timeline_weeks" required>
                  <input
                    id="timeline_weeks"
                    name="timeline_weeks"
                    type="number"
                    min={1}
                    max={104}
                    defaultValue={application.timeline_weeks || challenge.pilot_duration_weeks}
                  />
                </Field>
              </div>

              <Field
                label="What data do you need, and where will it be stored?"
                name="data_declaration"
                required
                help="State the datasets, the storage location, which must be in India, and the retention period."
              >
                <textarea
                  id="data_declaration"
                  name="data_declaration"
                  rows={4}
                  defaultValue={application.data_declaration}
                />
              </Field>

              <Field label="Intellectual property option you accept" name="ip_declaration" required>
                <select
                  id="ip_declaration"
                  name="ip_declaration"
                  defaultValue={application.ip_declaration || "startup_retains"}
                >
                  {Object.entries(IP_OPTION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="rounded border border-line bg-paper-soft px-4 py-3">
                <div className="flex items-start gap-3">
                  <input
                    id="conflict_declaration"
                    name="conflict_declaration"
                    type="checkbox"
                    defaultChecked={application.conflict_declaration}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <label htmlFor="conflict_declaration" className="font-normal">
                    I confirm that no director, employee or adviser of this startup holds a position
                    in the department publishing this challenge, and that no conflict of interest
                    exists in relation to this application.
                  </label>
                </div>
              </div>
            </div>
          </Section>

          <div className="sticky bottom-0 -mx-4 border-t border-line bg-paper px-4 py-3 no-print sm:mx-0 sm:rounded sm:border">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <SubmitButton variant="secondary" pendingLabel="Saving...">
                Save draft
              </SubmitButton>
              <SubmitButton
                formAction={submitApplication}
                pendingLabel="Submitting..."
                confirm="Submit this application? You can keep editing until the deadline, and the last submitted version is the one that counts."
              >
                {application.submitted_at ? "Save and resubmit" : "Save and submit"}
              </SubmitButton>
            </div>
          </div>
        </AutosaveForm>
      ) : (
        <Section title="This application is closed for editing">
          <Callout tone="neutral">
            {isOverdue(challenge.application_deadline)
              ? "The deadline has passed and your last submitted version is locked."
              : "This application is in state " +
                (APPLICATION_STATE_LABELS[application.state] ?? application.state) +
                " and can no longer be edited."}
          </Callout>

          <div className="mt-5 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-muted">Proposal</p>
              <p className="mt-0.5 max-w-prose whitespace-pre-line text-ink-soft">
                {application.proposal_summary}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-muted">Approach</p>
              <p className="mt-0.5 max-w-prose whitespace-pre-line text-ink-soft">
                {application.approach}
              </p>
            </div>
          </div>
        </Section>
      )}

      {application.state === "Draft" || application.state === "Submitted" ? (
        <Section title="Withdraw">
          <Disclosure summary="Withdraw this application">
            <form action={withdrawApplication} className="space-y-3">
              <input type="hidden" name="application_id" value={application.id} />
              <p className="text-sm text-ink-soft">
                Withdrawing removes your application from consideration. You cannot undo it, but you
                can apply again before the deadline.
              </p>
              <SubmitButton
                variant="danger"
                confirm="Withdraw this application? You can apply again before the deadline."
              >
                Withdraw the application
              </SubmitButton>
            </form>
          </Disclosure>
        </Section>
      ) : null}
    </div>
  );
}
