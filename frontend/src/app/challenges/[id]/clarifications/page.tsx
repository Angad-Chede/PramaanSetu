import type { Metadata } from "next";
import Link from "next/link";

import { answerClarification } from "@/app/challenges/actions";
import { SubmitButton } from "@/components/forms";
import {
  Callout,
  EmptyState,
  Field,
  PageHeader,
  Pill,
  Section,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge, Clarification } from "@/lib/types";

export const metadata: Metadata = { title: "Questions and answers" };
export const dynamic = "force-dynamic";

export default async function ClarificationsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/challenges/" + params.id + "/clarifications");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + params.id);
  const body = await apiGet<{ items: Clarification[]; cutoff: string | null; note: string }>(
    "/challenges/" + params.id + "/clarifications",
  );

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const canAnswer =
    hasRole(session, "DO", "DA") && session.department_id === challenge.department_id;

  const unanswered = body.items.filter((item) => !item.answer);
  const answered = body.items.filter((item) => item.answer);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Questions and answers"
        subtitle={body.note}
        meta={
          <>
            <Pill>{challenge.reference}</Pill>
            {body.cutoff ? <Pill>Questions close {formatDateTime(body.cutoff)}</Pill> : null}
          </>
        }
        actions={<Link href={"/challenges/" + challenge.id} className="btn btn-secondary">Back to the challenge</Link>}
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Published">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5">
          <Callout tone="bad" title="That answer could not be published">{problem.message}</Callout>
        </div>
      ) : null}

      {canAnswer ? (
        <Section
          title="Waiting for an answer"
          description="Answers are published to every applicant at once, and the asker is never named."
        >
          {unanswered.length ? (
            <ul className="space-y-5">
              {unanswered.map((item) => (
                <li key={item.id} className="rounded border border-line p-4">
                  <p className="font-medium text-ink">{item.question}</p>
                  <form action={answerClarification} className="mt-3 space-y-3">
                    <input type="hidden" name="challenge_id" value={challenge.id} />
                    <input type="hidden" name="clarification_id" value={item.id} />
                    <Field label="Your answer" name={"answer_" + item.id} required>
                      <textarea id={"answer_" + item.id} name="answer" rows={4} required minLength={5} />
                    </Field>
                    <SubmitButton
                      pendingLabel="Publishing..."
                      confirm="Publish this answer to every applicant?"
                    >
                      Publish the answer
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No unanswered questions." />
          )}
        </Section>
      ) : null}

      <Section title="Published answers">
        {answered.length ? (
          <ol className="space-y-5">
            {answered.map((item, index) => (
              <li key={item.id}>
                <p className="text-xs uppercase tracking-wide text-ink-muted">
                  Question {index + 1} &mdash; published <Timestamp value={item.published_at} />
                </p>
                <p className="mt-1 font-medium text-ink">{item.question}</p>
                <p className="mt-1 max-w-prose whitespace-pre-line text-ink-soft">{item.answer}</p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState message="No answers have been published yet." />
        )}
      </Section>
    </div>
  );
}
