import type { Metadata } from "next";
import Link from "next/link";

import { declareConflict, submitScores } from "@/app/pilots/actions";
import { Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  Deadline,
  EmptyState,
  Field,
  PageHeader,
  Pill,
  ProblemList,
  Section,
} from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, compactRupees, decimal } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { requireSession } from "@/lib/session";

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

export default async function EvaluationWorkspacePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession("/evaluation/" + params.id);
  const workspace = await apiGetOrNotFound<Workspace>("/evaluation/" + params.id);

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);

  const kpiById = new Map(workspace.kpis.map((kpi) => [kpi.id, kpi]));
  const pending = workspace.applications.filter(
    (application) => !application.scored && !application.has_conflict,
  );

  return (
    <div>
      <PageHeader
        title={workspace.challenge.title}
        subtitle={workspace.challenge.outcome_statement}
        meta={
          <>
            <Pill>{workspace.challenge.reference}</Pill>
            <Pill>{CHALLENGE_STATE_LABELS[workspace.challenge.state] ?? workspace.challenge.state}</Pill>
            {workspace.blinded ? <Pill tone="warn">Applicant identity hidden</Pill> : null}
            <Pill tone={pending.length ? "warn" : "good"}>
              {pending.length} still to score
            </Pill>
          </>
        }
        actions={<Link href="/evaluation" className="btn btn-secondary">Back to my panel work</Link>}
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Saved">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That could not be saved">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {workspace.challenge.evaluation_deadline ? (
        <div className="mb-5">
          <Callout tone="neutral">
            <Deadline value={workspace.challenge.evaluation_deadline} label="Scoring closes" />
          </Callout>
        </div>
      ) : null}

      <Section title="What is being bought" description="The measures the pilot will be judged against.">
        <ul className="space-y-2 text-sm">
          {workspace.kpis.map((kpi) => (
            <li key={kpi.id}>
              <span className="font-medium text-ink">{kpi.name}</span>
              {kpi.is_primary ? (
                <span className="ml-2">
                  <Pill tone="good">Primary</Pill>
                </span>
              ) : null}
              <span className="ml-2 text-ink-muted">
                {kpi.unit}, {kpi.direction === "lower" ? "lower is better" : "higher is better"},
                baseline {kpi.baseline_value ?? "to be measured"}, target {kpi.target_value ?? "not set"}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="The rubric"
        description="Score each criterion from 1 to 5 against its anchors. Every score needs a one-line justification, which the applicant eventually sees, anonymised."
      >
        <div className="space-y-4">
          {workspace.criteria.map((criterion) => (
            <div key={criterion.id} className="rounded border border-line p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3>{criterion.name}</h3>
                <span className="num text-sm text-ink-muted">Weight {criterion.weight}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{criterion.description}</p>
              {Object.keys(criterion.anchors ?? {}).length ? (
                <dl className="mt-2 space-y-1 text-sm">
                  {Object.entries(criterion.anchors)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([score, anchor]) => (
                      <div key={score} className="flex gap-2">
                        <dt className="num w-6 shrink-0 font-medium text-ink">{score}</dt>
                        <dd className="text-ink-muted">{anchor}</dd>
                      </div>
                    ))}
                </dl>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      {workspace.applications.length ? (
        workspace.applications.map((application) => (
          <Section
            key={application.id}
            title={application.blind_label}
            description={
              application.has_conflict
                ? "You declared a conflict on this application, so it has been removed from your scoring list."
                : application.locked
                  ? "Scores for this challenge are locked."
                  : application.scored
                    ? "You have scored this application. You can revise until the scores lock."
                    : "Declare any conflict of interest, then score every criterion."
            }
            actions={
              <>
                {application.conflict_declared ? (
                  application.has_conflict ? (
                    <Pill tone="bad">Conflict declared</Pill>
                  ) : (
                    <Pill tone="good">No conflict</Pill>
                  )
                ) : (
                  <Pill tone="warn">Declaration needed</Pill>
                )}
                {application.scored ? <Pill tone="good">Scored</Pill> : null}
                {application.locked ? <Pill>Locked</Pill> : null}
              </>
            }
          >
            <div className="prose-block space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">Proposal</p>
                <p className="mt-0.5 whitespace-pre-line text-ink-soft">{application.proposal_summary}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">Approach</p>
                <p className="mt-0.5 whitespace-pre-line text-ink-soft">{application.approach}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">Committed values</p>
                <ul className="mt-0.5 space-y-1 text-sm text-ink-soft">
                  {application.kpi_commitments.map((commitment) => {
                    const kpi = kpiById.get(commitment.kpi_id);
                    return (
                      <li key={commitment.kpi_id}>
                        {kpi?.name ?? "Measure"}: {decimal(commitment.committed_value, 2)}{" "}
                        {kpi?.unit ?? ""}{" "}
                        {kpi?.baseline_value !== null && kpi?.baseline_value !== undefined ? (
                          <span className="text-ink-muted">
                            (from a baseline of {kpi.baseline_value})
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Pilot cost</p>
                  <p className="num mt-0.5">
                    {application.pilot_cost ? compactRupees(application.pilot_cost.paise) : "Not quoted"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Timeline</p>
                  <p className="num mt-0.5">{application.timeline_weeks} weeks</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Intellectual property</p>
                  <p className="mt-0.5 text-sm">{application.ip_declaration.replace(/_/g, " ")}</p>
                </div>
              </div>
              <Disclosure summary="Data handling declaration">
                <p className="whitespace-pre-line">{application.data_declaration}</p>
              </Disclosure>
            </div>

            {!application.conflict_declared ? (
              <div className="mt-5 border-t border-line pt-5">
                <h3 className="mb-2">Conflict of interest declaration</h3>
                <p className="help mb-3">
                  Required before scoring. Declare a conflict if you, or a body you are connected
                  with, has any interest in this applicant or in the outcome.
                </p>
                <form action={declareConflict} className="max-w-form space-y-3">
                  <input type="hidden" name="application_id" value={application.id} />
                  <input type="hidden" name="challenge_id" value={workspace.challenge.id} />
                  <Field label="Do you have a conflict?" name={"has_conflict_" + application.id} required>
                    <select
                      id={"has_conflict_" + application.id}
                      name="has_conflict"
                      defaultValue="no"
                      required
                    >
                      <option value="no">No, I have no conflict of interest</option>
                      <option value="yes">Yes, I have a conflict</option>
                    </select>
                  </Field>
                  <Field
                    label="If yes, describe the relationship"
                    name={"statement_" + application.id}
                    help="Required when you declare a conflict."
                  >
                    <textarea id={"statement_" + application.id} name="statement" rows={2} />
                  </Field>
                  <SubmitButton variant="secondary">Record the declaration</SubmitButton>
                </form>
              </div>
            ) : application.has_conflict ? (
              <div className="mt-5">
                <Callout tone="warn" title="You cannot score this application">
                  You declared a conflict of interest on it.
                </Callout>
              </div>
            ) : application.locked ? (
              <div className="mt-5">
                <Callout tone="neutral" title="Scores are locked">
                  Ask the approver to reopen scoring if a correction is needed. The reopening is
                  recorded with a reason.
                </Callout>
              </div>
            ) : (
              <form action={submitScores} className="mt-5 space-y-4 border-t border-line pt-5">
                <input type="hidden" name="application_id" value={application.id} />
                <input type="hidden" name="challenge_id" value={workspace.challenge.id} />
                <h3>Your scores</h3>
                {workspace.criteria.map((criterion) => {
                  const existing = application.my_scores.find(
                    (score) => score.criterion_id === criterion.id,
                  );
                  return (
                    <div key={criterion.id} className="rounded border border-line bg-paper-soft p-4">
                      <input type="hidden" name="criterion_id" value={criterion.id} />
                      <div className="grid gap-4 sm:grid-cols-[8rem,1fr]">
                        <Field
                          label={criterion.name}
                          name={"score_" + application.id + "_" + criterion.id}
                          required
                        >
                          <select
                            id={"score_" + application.id + "_" + criterion.id}
                            name="criterion_score"
                            defaultValue={existing ? String(existing.score) : "3"}
                            required
                          >
                            {[1, 2, 3, 4, 5].map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field
                          label="Why this score"
                          name={"justification_" + application.id + "_" + criterion.id}
                          required
                          help="At least 10 characters, referring to something specific in the proposal."
                        >
                          <textarea
                            id={"justification_" + application.id + "_" + criterion.id}
                            name="criterion_justification"
                            rows={2}
                            required
                            minLength={10}
                            defaultValue={existing?.justification ?? ""}
                          />
                        </Field>
                      </div>
                      {criterion.anchors?.["1"] ? (
                        <p className="mt-2 text-xs text-ink-muted">
                          1 means: {criterion.anchors["1"]} &mdash; 5 means: {criterion.anchors["5"]}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                <SubmitButton pendingLabel="Saving...">
                  {application.scored ? "Update my scores" : "Submit my scores"}
                </SubmitButton>
              </form>
            )}
          </Section>
        ))
      ) : (
        <Section title="Nothing to score">
          <EmptyState message="No eligible application is waiting for your score on this challenge." />
        </Section>
      )}
    </div>
  );
}
