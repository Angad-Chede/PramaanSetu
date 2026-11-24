import type { Metadata } from "next";
import Link from "next/link";

import { apiGet } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, compactRupees, formatDate, relativeDeadline } from "@/lib/format";
import { readNotice, readProblem, single } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge } from "@/lib/types";

import {
  ButtonLink,
  Callout,
  DataTable,
  EmptyState,
  PageHeader,
  Section,
  StatusPill,
} from "@/components/ui";

export const metadata: Metadata = { title: "Challenges" };
export const dynamic = "force-dynamic";

const STAGE_ORDER = [
  "Draft",
  "InReview",
  "Published",
  "ApplicationsClosed",
  "Screening",
  "Evaluation",
  "Shortlisted",
  "PilotDesign",
  "PilotActive",
  "Validation",
  "DecisionPending",
  "Scaled",
  "Closed",
  "Cancelled",
];

export default async function ChallengesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/challenges");
  const state = single(searchParams?.state);
  const query = new URLSearchParams({ mine: "true", limit: "100" });
  if (state) query.set("state", state);

  const body = await apiGet<{ items: Challenge[] }>("/challenges?" + query.toString());
  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);

  const counts = new Map<string, number>();
  for (const challenge of body.items) {
    counts.set(challenge.state, (counts.get(challenge.state) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader
        title="Challenges"
        subtitle="Every challenge your department owns, and the stage it is in. A challenge cannot skip a stage: each one needs a recorded artefact before the next can start."
        actions={
          hasRole(session, "DO") ? (
            <ButtonLink href="/challenges/new" variant="primary">
              Write a new challenge
            </ButtonLink>
          ) : null
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">
            {notice}
          </Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5">
          <Callout tone="bad" title="That action did not complete">
            {problem.message}
          </Callout>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-2 no-print">
        <Link
          href="/challenges"
          className={"pill no-underline " + (state ? "pill-neutral" : "pill-good")}
        >
          All ({body.items.length})
        </Link>
        {STAGE_ORDER.filter((stage) => counts.has(stage)).map((stage) => (
          <Link
            key={stage}
            href={"/challenges?state=" + stage}
            className={"pill no-underline " + (state === stage ? "pill-good" : "pill-neutral")}
          >
            {CHALLENGE_STATE_LABELS[stage]} ({counts.get(stage)})
          </Link>
        ))}
      </div>

      <Section
        title={state ? CHALLENGE_STATE_LABELS[state] ?? state : "All challenges"}
        description={
          state
            ? "Filtered to one stage. Clear the filter to see everything."
            : "Newest first. Open a challenge to see its record, its measures and what happens next."
        }
      >
        {body.items.length ? (
          <DataTable
            columns={["Reference", "Title", "Stage", "Budget ceiling", "Deadline", ""]}
            caption="Challenges owned by your department"
          >
            {body.items.map((challenge) => (
              <tr key={challenge.id}>
                <td className="num whitespace-nowrap text-sm">{challenge.reference}</td>
                <td>
                  <Link href={"/challenges/" + challenge.id} className="font-medium">
                    {challenge.title || "Untitled draft"}
                  </Link>
                  {challenge.sector ? (
                    <p className="mt-0.5 text-sm text-ink-muted">{challenge.sector}</p>
                  ) : null}
                </td>
                <td>
                  <StatusPill
                    state={challenge.state}
                    label={CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state}
                  />
                </td>
                <td className="num whitespace-nowrap text-sm">
                  {challenge.budget_ceiling && challenge.budget_ceiling.paise > 0
                    ? compactRupees(challenge.budget_ceiling.paise)
                    : "Not published"}
                </td>
                <td className="whitespace-nowrap text-sm">
                  {challenge.application_deadline ? (
                    <>
                      {formatDate(challenge.application_deadline)}
                      <span className="block text-ink-muted">
                        {relativeDeadline(challenge.application_deadline)}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-muted">Not set</span>
                  )}
                </td>
                <td className="whitespace-nowrap text-right no-print">
                  <Link href={"/challenges/" + challenge.id}>Open</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState
            message={
              state
                ? "No challenge is in this stage right now."
                : "Your department has not created a challenge yet."
            }
            action={
              hasRole(session, "DO") ? (
                <ButtonLink href="/challenges/new" variant="primary">
                  Write your first challenge
                </ButtonLink>
              ) : null
            }
          />
        )}
      </Section>
    </div>
  );
}
