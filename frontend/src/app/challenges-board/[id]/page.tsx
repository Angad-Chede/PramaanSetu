import type { Metadata } from "next";
import Link from "next/link";

import { askClarification } from "@/app/challenges/actions";
import { startApplication } from "@/app/pilots/actions";
import { SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  Deadline,
  EmptyState,
  Field,
  KeyValue,
  PageHeader,
  Pill,
  Section,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { IP_OPTION_LABELS, compactRupees, formatDateTime, isOverdue } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { getSession, hasRole } from "@/lib/session";
import type { Application } from "@/lib/types";

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

export default async function PublicChallengePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getSession();
  const challenge = await apiGetOrNotFound<PublicChallenge>("/public/challenges/" + params.id);

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);

  const isStartup = hasRole(session, "SU");
  const closed = isOverdue(challenge.application_deadline) || challenge.state !== "Published";
  const questionsClosed = isOverdue(challenge.clarification_cutoff);

  let existing: Application | null = null;
  if (isStartup && session?.startup_id) {
    const mine = await apiGetOptional<{ items: { id: string; challenge_id: string }[] }>(
      "/startups/" + session.startup_id + "/applications",
    );
    const match = mine?.items.find((row) => row.challenge_id === challenge.id);
    if (match) existing = (await apiGetOptional<Application>("/applications/" + match.id)) ?? null;
  }

  return (
    <div>
      <PageHeader
        title={challenge.title}
        subtitle={challenge.outcome_statement}
        meta={
          <>
            <Pill>{challenge.reference}</Pill>
            {challenge.department_name ? <Pill>{challenge.department_name}</Pill> : null}
            {challenge.sector ? <Pill>{challenge.sector}</Pill> : null}
            {closed ? <Pill tone="bad">Applications closed</Pill> : <Pill tone="good">Open</Pill>}
          </>
        }
        actions={
          isStartup && !closed ? (
            existing ? (
              <Link href={"/my-applications/" + existing.id} className="btn btn-primary">
                Open your application
              </Link>
            ) : (
              <form action={startApplication}>
                <input type="hidden" name="challenge_id" value={challenge.id} />
                <SubmitButton pendingLabel="Starting...">Apply to this challenge</SubmitButton>
              </form>
            )
          ) : !session ? (
            <Link href={"/signin?next=" + encodeURIComponent("/challenges-board/" + challenge.id)} className="btn btn-primary">
              Sign in to apply
            </Link>
          ) : null
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5">
          <Callout tone="bad" title="That could not be completed">{problem.message}</Callout>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="The problem">
            <div className="prose-block space-y-3 whitespace-pre-line text-ink-soft">
              <p>{challenge.problem_statement}</p>
              {challenge.current_situation ? (
                <>
                  <h3>How it is handled today</h3>
                  <p>{challenge.current_situation}</p>
                </>
              ) : null}
            </div>
          </Section>

          <Section
            title="What will be measured"
            description="Your application commits to a value on each of these. The primary measure decides the pilot design and the Evidence Report."
          >
            <DataTable columns={["Measure", "Unit", "Direction", "Baseline", "Target", "How it is measured"]}>
              {challenge.kpis.map((kpi) => (
                <tr key={kpi.name}>
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
                  <td className="num text-sm">{kpi.baseline_value ?? "To be measured"}</td>
                  <td className="num text-sm">{kpi.target_value ?? "Not set"}</td>
                  <td className="max-w-sm text-sm text-ink-muted">{kpi.baseline_method}</td>
                </tr>
              ))}
            </DataTable>
          </Section>

          <Section
            title="How your application will be judged"
            description="Round one is blind: evaluators do not see who you are. Each criterion is scored from 1 to 5 against the anchors, with a written justification."
          >
            <div className="space-y-4">
              {challenge.criteria.map((criterion) => (
                <div key={criterion.name} className="rounded border border-line p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3>{criterion.name}</h3>
                    <span className="num text-sm text-ink-muted">Weight {criterion.weight}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{criterion.description}</p>
                  {criterion.anchors && Object.keys(criterion.anchors).length ? (
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

          <Section title="Constraints and scope">
            <div className="prose-block space-y-3 whitespace-pre-line text-ink-soft">
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
              {challenge.commercial_terms ? (
                <>
                  <h3>Commercial terms</h3>
                  <p>{challenge.commercial_terms}</p>
                </>
              ) : null}
            </div>
          </Section>

          <Section
            title="Questions and answers"
            description="Answers are published to every applicant at once and the asker is never named."
          >
            {challenge.clarifications.length ? (
              <ol className="space-y-4">
                {challenge.clarifications.map((item, index) => (
                  <li key={index}>
                    <p className="text-xs uppercase tracking-wide text-ink-muted">
                      Published <Timestamp value={item.published_at} />
                    </p>
                    <p className="mt-1 font-medium text-ink">{item.question}</p>
                    <p className="mt-1 max-w-prose whitespace-pre-line text-ink-soft">{item.answer}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState message="No questions have been answered yet." />
            )}

            {isStartup && !questionsClosed ? (
              <form action={askClarification} className="mt-5 max-w-form space-y-3 border-t border-line pt-5">
                <input type="hidden" name="challenge_id" value={challenge.id} />
                <Field
                  label="Ask a question"
                  name="question"
                  help="Your name is stored but never shown. The answer is published to every applicant."
                  required
                >
                  <textarea id="question" name="question" rows={3} required minLength={10} />
                </Field>
                <SubmitButton variant="secondary" pendingLabel="Sending...">
                  Send the question
                </SubmitButton>
              </form>
            ) : questionsClosed ? (
              <p className="mt-4 text-sm text-ink-muted">
                The question window closed on {formatDateTime(challenge.clarification_cutoff)}.
              </p>
            ) : null}
          </Section>
        </div>

        <div>
          <Section title="At a glance">
            <KeyValue
              rows={[
                {
                  label: "Applications close",
                  value: <Deadline value={challenge.application_deadline} label="Closes" />,
                },
                {
                  label: "Budget ceiling",
                  value:
                    challenge.budget_ceiling && challenge.budget_ceiling.paise > 0
                      ? compactRupees(challenge.budget_ceiling.paise)
                      : "Not published",
                },
                { label: "Pilot length", value: challenge.pilot_duration_weeks + " weeks" },
                {
                  label: "Location",
                  value: challenge.location_required
                    ? "Restricted to " + (challenge.state_code ?? "the named state")
                    : "Open to any state",
                },
                {
                  label: "Intellectual property",
                  value: IP_OPTION_LABELS[challenge.ip_option] ?? challenge.ip_option,
                },
                {
                  label: "Questions close",
                  value: challenge.clarification_cutoff
                    ? formatDateTime(challenge.clarification_cutoff)
                    : "Not set",
                },
              ]}
            />
          </Section>

          <Section title="Who can apply">
            <p className="whitespace-pre-line text-sm text-ink-soft">
              {challenge.eligibility_notes ||
                "Open to startups recognised by the Department for Promotion of Industry and Internal Trade."}
            </p>
            <div className="mt-4">
              <Callout tone="good" title="Startup relaxation">
                Prior turnover and prior experience criteria are relaxed automatically for a
                recognised startup, and the rule used is recorded against your application. Quality
                and technical criteria are never relaxed.
              </Callout>
            </div>
          </Section>

          <Section title="What happens after you apply">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-soft">
              <li>At the deadline your last submitted version is locked, to the second.</li>
              <li>Eligibility screening records a reason against every published rule.</li>
              <li>A panel of at least three experts scores your proposal, blind to who you are.</li>
              <li>If you are shortlisted, the pilot is designed with a simulator before it starts.</li>
              <li>You are paid against milestones with service level timers that escalate on their own.</li>
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}
