import type { Metadata } from "next";
import Link from "next/link";

import { decideChallenge, issueCorrigendum, runWorkflowStep } from "@/app/challenges/actions";
import { SubmitButton } from "@/components/forms";
import {
  ButtonLink,
  Callout,
  DataTable,
  Deadline,
  Definition,
  EmptyState,
  Field,
  KeyValue,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  StatusPill,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import {
  CHALLENGE_STATE_LABELS,
  IP_OPTION_LABELS,
  formatDateTime,
  money,
} from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge, Match } from "@/lib/types";

export const metadata: Metadata = { title: "Challenge" };
export const dynamic = "force-dynamic";

/** What the officer can do next, in the order the workflow expects. */
const NEXT_STEP: Record<string, { action: string; label: string; detail: string; roles: string[] }> = {
  Published: {
    action: "close-applications",
    label: "Close applications now",
    detail:
      "Closing locks every submitted application at the current server time. Applications also close automatically at the deadline.",
    roles: ["DO"],
  },
  ApplicationsClosed: {
    action: "screen",
    label: "Run eligibility screening",
    detail:
      "The rules engine checks every application against the published criteria and records a reason for each rule.",
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
    detail:
      "Locking stops further editing. Only the approver can reopen scoring, and the reopening is recorded.",
    roles: ["DO"],
  },
};

export default async function ChallengePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/challenges/" + params.id);
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + params.id);
  const matches = hasRole(session, "DO", "DA")
    ? await apiGetOptional<{ items: Match[]; note: string }>(
        "/challenges/" + params.id + "/matches?limit=10",
      )
    : null;

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const isOwner = session.department_id === challenge.department_id;
  const next = NEXT_STEP[challenge.state];
  const canRunNext = next && hasRole(session, ...next.roles) && isOwner;

  return (
    <div>
      <PageHeader
        title={challenge.title || "Untitled challenge"}
        subtitle={challenge.outcome_statement}
        meta={
          <>
            <Pill>{challenge.reference}</Pill>
            <StatusPill
              state={challenge.state}
              label={CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state}
            />
            {challenge.sector ? <Pill>{challenge.sector}</Pill> : null}
            {challenge.department_name ? <Pill>{challenge.department_name}</Pill> : null}
          </>
        }
        actions={
          <>
            {challenge.state === "Draft" && hasRole(session, "DO") ? (
              <ButtonLink href={"/challenges/" + challenge.id + "/edit"} variant="primary">
                Edit the draft
              </ButtonLink>
            ) : null}
            {challenge.state === "InReview" && hasRole(session, "DA") ? (
              <ButtonLink href={"/challenges/" + challenge.id + "/review"} variant="primary">
                Review for approval
              </ButtonLink>
            ) : null}
            <a
              href={"/api/v1/challenges/" + challenge.id + "/summary.pdf"}
              className="btn btn-secondary"
            >
              Download the one-page summary
            </a>
          </>
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That action did not complete">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {canRunNext ? (
        <Section title="Next step" description={next.detail}>
          <form action={runWorkflowStep}>
            <input type="hidden" name="challenge_id" value={challenge.id} />
            <input type="hidden" name="action" value={next.action} />
            <input type="hidden" name="back" value={"/challenges/" + challenge.id} />
            <SubmitButton pendingLabel="Working...">{next.label}</SubmitButton>
          </form>
          {challenge.state === "Screening" ? (
            <p className="mt-3 text-sm">
              <Link href={"/challenges/" + challenge.id + "/panel"}>Assign the panel first</Link>
            </p>
          ) : null}
        </Section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="The record">
            <KeyValue
              rows={[
                { label: "Reference", value: <span className="num">{challenge.reference}</span> },
                {
                  label: "Stage",
                  value: CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state,
                },
                { label: "Department", value: challenge.department_name ?? "Not recorded" },
                {
                  label: "Budget ceiling",
                  value: challenge.budget_ceiling ? money(challenge.budget_ceiling) : "Not published",
                },
                {
                  label: "Application deadline",
                  value: <Deadline value={challenge.application_deadline} label="Closes" />,
                },
                {
                  label: "Questions close",
                  value: challenge.clarification_cutoff
                    ? formatDateTime(challenge.clarification_cutoff)
                    : "Not set",
                },
                {
                  label: "Intellectual property",
                  value: IP_OPTION_LABELS[challenge.ip_option ?? ""] ?? "Not selected",
                },
                {
                  label: "Applications received",
                  value: challenge.application_count ?? 0,
                },
                { label: "Published", value: <Timestamp value={challenge.published_at} /> },
                { label: "Approved by", value: challenge.approved_by ? "Recorded" : "Not yet approved" },
              ]}
            />
          </Section>

          <Section title="The problem">
            <div className="prose-block space-y-3 whitespace-pre-line text-ink-soft">
              <p>{challenge.problem_statement || "Not written yet."}</p>
              {challenge.current_situation ? (
                <>
                  <h3>How it is handled today</h3>
                  <p>{challenge.current_situation}</p>
                </>
              ) : null}
              {challenge.constraints ? (
                <>
                  <h3>Constraints</h3>
                  <p>{challenge.constraints}</p>
                </>
              ) : null}
              {challenge.pilot_scope ? (
                <>
                  <h3>Pilot scope</h3>
                  <p>{challenge.pilot_scope}</p>
                </>
              ) : null}
            </div>
          </Section>

          <Section
            title="Measures"
            description="Every measure carries a unit, a measurement method, a baseline and a target. The primary measure decides the pilot design and the Evidence Report."
          >
            <DataTable
              columns={["Measure", "Unit", "Direction", "Baseline", "Target", "How it is measured"]}
              empty="No measures have been defined yet."
            >
              {(challenge.kpis ?? []).map((kpi) => (
                <tr key={kpi.id || kpi.name}>
                  <td>
                    <span className="font-medium">{kpi.name}</span>
                    {kpi.is_primary ? (
                      <span className="ml-2">
                        <Pill tone="good">Primary</Pill>
                      </span>
                    ) : null}
                  </td>
                  <td className="text-sm">{kpi.unit}</td>
                  <td className="text-sm">{kpi.direction_label}</td>
                  <td className="num text-sm">
                    {kpi.baseline_value ?? <span className="text-ink-muted">To be measured</span>}
                  </td>
                  <td className="num text-sm">
                    {kpi.target_value ?? <span className="text-ink-muted">Not set</span>}
                  </td>
                  <td className="max-w-md text-sm text-ink-muted">{kpi.baseline_method}</td>
                </tr>
              ))}
            </DataTable>
          </Section>

          <Section
            title="Evaluation rubric"
            description="Published with the challenge, so applicants know exactly what is being judged."
          >
            <DataTable columns={["Criterion", "Weight", "What is being judged"]} empty="No rubric yet.">
              {(challenge.criteria ?? []).map((criterion) => (
                <tr key={criterion.id || criterion.name}>
                  <td className="font-medium">{criterion.name}</td>
                  <td className="num">{criterion.weight}</td>
                  <td className="text-sm text-ink-muted">{criterion.description}</td>
                </tr>
              ))}
            </DataTable>
          </Section>

          {challenge.corrigenda && challenge.corrigenda.length ? (
            <Section
              title="Corrigenda"
              description="The only permitted change to a published challenge. Every startup that viewed or applied is notified."
            >
              <ul className="divide-y divide-line">
                {challenge.corrigenda.map((corrigendum) => (
                  <li key={corrigendum.number} className="py-3">
                    <p className="font-medium text-ink">Corrigendum {corrigendum.number}</p>
                    <p className="text-sm text-ink-soft">{corrigendum.summary}</p>
                    <ul className="mt-1 space-y-0.5 text-sm text-ink-muted">
                      {Object.entries(corrigendum.changes).map(([field, change]) => (
                        <li key={field}>
                          {field}: {change.from} to {change.to}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <div>
          <Section title="Where this challenge goes next">
            <ol className="space-y-3 text-sm">
              {[
                ["Define", ["Draft", "InReview"]],
                ["Discover", ["Published"]],
                ["Screen", ["ApplicationsClosed", "Screening"]],
                ["Evaluate", ["Evaluation", "Shortlisted"]],
                ["Simulate and pilot", ["PilotDesign", "PilotActive"]],
                ["Validate", ["Validation"]],
                ["Decide and scale", ["DecisionPending", "Scaled", "Closed"]],
              ].map(([label, states]) => {
                const active = (states as string[]).includes(challenge.state);
                const passed =
                  Object.keys(CHALLENGE_STATE_LABELS).indexOf(challenge.state) >
                  Object.keys(CHALLENGE_STATE_LABELS).indexOf((states as string[])[0]);
                return (
                  <li key={label as string} className="flex items-start gap-2">
                    <span
                      className={
                        "mt-1 h-2 w-2 shrink-0 rounded-full " +
                        (active ? "bg-brand" : passed ? "bg-good" : "bg-line-strong")
                      }
                      aria-hidden="true"
                    />
                    <span className={active ? "font-semibold text-ink" : "text-ink-muted"}>
                      {label as string}
                      {active ? " (current)" : passed ? " (done)" : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Section>

          <Section title="Related pages">
            <ul className="space-y-2 text-sm">
              <li>
                <Link href={"/challenges/" + challenge.id + "/clarifications"}>
                  Questions and published answers
                </Link>
              </li>
              {isOwner ? (
                <>
                  <li>
                    <Link href={"/challenges/" + challenge.id + "/panel"}>Evaluation panel</Link>
                  </li>
                  <li>
                    <Link href={"/challenges/" + challenge.id + "/screening"}>
                      Applications and eligibility
                    </Link>
                  </li>
                  <li>
                    <Link href={"/challenges/" + challenge.id + "/ranking"}>
                      Scores, flags and the shortlist
                    </Link>
                  </li>
                  <li>
                    <Link href={"/challenges/" + challenge.id + "/audit"}>Audit trail</Link>
                  </li>
                </>
              ) : null}
              <li>
                <Link href={"/challenges-board/" + challenge.id}>How applicants see this</Link>
              </li>
            </ul>
          </Section>

          {matches && matches.items.length ? (
            <Section
              title="Matched startups"
              description="Ranked by meaning, keywords, sector and location. Matching decides who is invited, never who may apply."
            >
              <ul className="divide-y divide-line">
                {matches.items.slice(0, 6).map((match) => (
                  <li key={match.startup_id} className="py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-medium text-ink">{match.startup_name}</p>
                      <span className="num text-sm text-ink-muted">
                        {(match.score * 100).toFixed(0)}
                      </span>
                    </div>
                    <ul className="mt-1 space-y-0.5 text-sm text-ink-muted">
                      {match.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-muted">{matches.note}</p>
            </Section>
          ) : null}

          {challenge.template_versions && Object.keys(challenge.template_versions).length ? (
            <Section
              title="Templates used"
              description="Recorded on the challenge, so a reviewer years later can reconstruct exactly what was published."
            >
              <ul className="space-y-1 text-sm text-ink-muted">
                {Object.entries(challenge.template_versions).map(([kind, version]) => (
                  <li key={kind}>
                    {kind.replace(/_/g, " ")}: version {version}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>

      {["Published", "ApplicationsClosed", "Screening"].includes(challenge.state) &&
      hasRole(session, "DO", "DA") &&
      isOwner ? (
        <Section
          title="Issue a corrigendum"
          description="A published challenge is otherwise immutable. A corrigendum is logged and notifies every startup that viewed or applied."
        >
          <form action={issueCorrigendum} className="max-w-form space-y-4">
            <input type="hidden" name="challenge_id" value={challenge.id} />
            <Field label="What is changing, and why" name="summary" required>
              <textarea id="summary" name="summary" rows={3} required minLength={10} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New application deadline" name="application_deadline">
                <input id="application_deadline" name="application_deadline" type="datetime-local" />
              </Field>
              <Field label="New budget ceiling in rupees" name="budget_ceiling_rupees">
                <input id="budget_ceiling_rupees" name="budget_ceiling_rupees" type="number" min={0} />
              </Field>
            </div>
            <Field label="Revised pilot scope" name="pilot_scope">
              <textarea id="pilot_scope" name="pilot_scope" rows={3} />
            </Field>
            <SubmitButton
              variant="secondary"
              confirm="Publish this corrigendum? Every startup that viewed or applied will be notified."
            >
              Publish the corrigendum
            </SubmitButton>
          </form>
        </Section>
      ) : null}

      {hasRole(session, "DA") && isOwner && challenge.available_actions?.includes("cancel") ? (
        <Section
          title="Cancel this challenge"
          description="Only possible before a pilot agreement is signed, and only with a recorded reason."
        >
          <form action={decideChallenge} className="max-w-form space-y-4">
            <input type="hidden" name="challenge_id" value={challenge.id} />
            <input type="hidden" name="action" value="cancel" />
            <Field label="Reason for cancellation" name="reason" required>
              <textarea id="reason" name="reason" rows={3} required minLength={10} />
            </Field>
            <SubmitButton
              variant="danger"
              confirm="Cancel this challenge? Applicants will be notified with your reason. This cannot be undone."
            >
              Cancel the challenge
            </SubmitButton>
          </form>
        </Section>
      ) : null}
    </div>
  );
}
