import type { Metadata } from "next";
import Link from "next/link";

import { decideChallenge } from "@/app/challenges/actions";
import { SubmitButton } from "@/components/forms";
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
} from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, IP_OPTION_LABELS, money } from "@/lib/format";
import { readProblem } from "@/lib/forms";
import { requireSession } from "@/lib/session";
import type { Challenge } from "@/lib/types";

export const metadata: Metadata = { title: "Review for approval" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/challenges/" + params.id + "/review");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + params.id);
  const problem = readProblem(searchParams);

  const isOwnDraft = challenge.created_by === session.id;
  const decidable = challenge.state === "InReview" && !isOwnDraft;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Approve or return"
        subtitle="One page, one decision. Read the outcome, the measures and the commercial terms, then approve for publication or return with comments."
        meta={
          <>
            <Pill>{challenge.reference}</Pill>
            <Pill tone={challenge.state === "InReview" ? "warn" : "neutral"}>
              {CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state}
            </Pill>
          </>
        }
        actions={
          <a href={"/api/v1/challenges/" + challenge.id + "/summary.pdf"} className="btn btn-secondary">
            Download as PDF
          </a>
        }
      />

      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That decision could not be recorded">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {isOwnDraft ? (
        <div className="mb-5">
          <Callout tone="warn" title="You drafted this challenge">
            Separation of duties: the officer who drafts a challenge cannot approve it. Ask another
            approver in your department to review it.
          </Callout>
        </div>
      ) : null}

      {challenge.state !== "InReview" ? (
        <div className="mb-5">
          <Callout tone="neutral" title="No decision is pending">
            This challenge is in state {CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state}.{" "}
            <Link href={"/challenges/" + challenge.id}>Open the full record</Link>
          </Callout>
        </div>
      ) : null}

      <Section title={challenge.title || "Untitled challenge"} description="The outcome being bought.">
        <p className="max-w-prose whitespace-pre-line text-ink">{challenge.outcome_statement}</p>
        <div className="mt-5">
          <KeyValue
            rows={[
              { label: "Department", value: challenge.department_name ?? "Not recorded" },
              { label: "Sector", value: challenge.sector ?? "Open to all sectors" },
              {
                label: "Budget ceiling",
                value: challenge.budget_ceiling ? money(challenge.budget_ceiling) : "Not published",
              },
              { label: "Pilot length", value: challenge.pilot_duration_weeks + " weeks" },
              {
                label: "Applications close",
                value: <Deadline value={challenge.application_deadline} label="Closes" />,
              },
              {
                label: "Intellectual property",
                value: IP_OPTION_LABELS[challenge.ip_option ?? ""] ?? "Not selected",
              },
            ]}
          />
        </div>
      </Section>

      <Section
        title="What will be measured"
        description="A pilot can only be judged against measures that carry a unit, a method, a baseline and a target."
      >
        <DataTable
          columns={["Measure", "Unit", "Direction", "Baseline", "Target", "Method"]}
          empty="No measures defined."
        >
          {(challenge.kpis ?? []).map((kpi) => (
            <tr key={kpi.id}>
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

      <Section title="How applications will be judged">
        <DataTable columns={["Criterion", "Weight", "What is being judged"]} empty="No rubric defined.">
          {(challenge.criteria ?? []).map((criterion) => (
            <tr key={criterion.id}>
              <td className="font-medium">{criterion.name}</td>
              <td className="num">{criterion.weight}</td>
              <td className="text-sm text-ink-muted">{criterion.description}</td>
            </tr>
          ))}
        </DataTable>
        <p className="mt-3 text-sm text-ink-muted">
          Round one is blind to the applicant. Every score needs a written justification, and any
          criterion where evaluators differ by more than 1.5 points is flagged before the shortlist
          is confirmed.
        </p>
      </Section>

      {challenge.quality_flags && challenge.quality_flags.length ? (
        <Section
          title="Quality checks raised at submission"
          description="Advisory. The officer submitted with these outstanding."
        >
          <Callout tone="warn">
            <ul className="space-y-2">
              {challenge.quality_flags.map((flag) => (
                <li key={flag.code + flag.field}>{flag.message}</li>
              ))}
            </ul>
          </Callout>
        </Section>
      ) : null}

      {decidable ? (
        <Section
          title="Your decision"
          description="Approving publishes the challenge, opens applications and notifies matched startups. Returning sends it back to the officer with your comments."
        >
          <form action={decideChallenge} className="max-w-form space-y-4">
            <input type="hidden" name="challenge_id" value={challenge.id} />
            <Field
              label="Comments"
              name="reason"
              help="Required if you are returning the challenge. Say what must change."
            >
              <textarea id="reason" name="reason" rows={4} />
            </Field>
            <div className="flex flex-wrap gap-3">
              <SubmitButton
                name="action"
                value="approve"
                pendingLabel="Publishing..."
                confirm="Approve and publish this challenge? Applications open immediately and matched startups are notified."
              >
                Approve and publish
              </SubmitButton>
              <SubmitButton name="action" value="return" variant="secondary" pendingLabel="Returning...">
                Return with comments
              </SubmitButton>
            </div>
          </form>
        </Section>
      ) : null}

      <Section title="Before you approve">
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
          <li>
            The outcome states a direction of change in a named measure. If it says improve or
            optimise with nothing behind it, return it.
          </li>
          <li>
            Each measure has a method a validator could reproduce from the source records. If it
            does not, the Evidence Report at the end will not be defensible.
          </li>
          <li>
            A budget ceiling is published, so startups can size their proposals and screening can
            check cost against it.
          </li>
          <li>
            No product or supplier is named anywhere. The challenge asks for an outcome.
          </li>
        </ul>
      </Section>
    </div>
  );
}
