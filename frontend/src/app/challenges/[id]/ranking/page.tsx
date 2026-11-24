import type { Metadata } from "next";
import Link from "next/link";

import { confirmShortlist, runWorkflowStep } from "@/app/challenges/actions";
import { SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  EmptyState,
  PageHeader,
  Pill,
  ProblemList,
  Section,
} from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, compactRupees, decimal } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge, RankingRow } from "@/lib/types";

export const metadata: Metadata = { title: "Scores and shortlist" };
export const dynamic = "force-dynamic";

export default async function RankingPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/challenges/" + params.id + "/ranking");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + params.id);
  const ranking = await apiGet<{ items: RankingRow[]; blinded: boolean; flags: string[]; note: string }>(
    "/challenges/" + params.id + "/ranking",
  );

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const isOwner = session.department_id === challenge.department_id;
  const canLock = challenge.state === "Evaluation" && hasRole(session, "DO") && isOwner;
  const canShortlist = challenge.state === "Shortlisted" && hasRole(session, "DA") && isOwner;
  const complete = ranking.items.length > 0 && ranking.items.every((row) => row.complete);

  return (
    <div>
      <PageHeader
        title="Scores, flags and the shortlist"
        subtitle="Weighted on a 0 to 100 scale from the published rubric. Where evaluators differ by more than 1.5 points on a criterion, the application is flagged so the written justifications are read before the shortlist is confirmed."
        meta={
          <>
            <Pill>{challenge.reference}</Pill>
            <Pill>{CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state}</Pill>
            {ranking.blinded ? <Pill tone="warn">Applicant identity hidden</Pill> : null}
          </>
        }
        actions={<Link href={"/challenges/" + challenge.id} className="btn btn-secondary">Back to the challenge</Link>}
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

      {ranking.flags.length ? (
        <div className="mb-5">
          <Callout tone="warn" title="Flags raised by the panel">
            <ul className="space-y-2">
              {Array.from(new Set(ranking.flags)).map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : null}

      {canLock ? (
        <Section
          title="Lock the scores"
          description="Locking stops further editing. Only the approver can reopen scoring, and the reopening is recorded with a reason."
        >
          {!complete ? (
            <div className="mb-3">
              <Callout tone="warn">
                Not every evaluator has submitted. You can still lock at the deadline, but the
                incomplete sheets are recorded as incomplete.
              </Callout>
            </div>
          ) : null}
          <form action={runWorkflowStep}>
            <input type="hidden" name="challenge_id" value={challenge.id} />
            <input type="hidden" name="action" value="lock-scores" />
            <input type="hidden" name="back" value={"/challenges/" + challenge.id + "/ranking"} />
            <SubmitButton
              pendingLabel="Locking..."
              confirm="Lock the scores for this challenge? Evaluators will no longer be able to edit them."
            >
              Lock the scores
            </SubmitButton>
          </form>
        </Section>
      ) : null}

      <Section
        title="Ranking"
        description={ranking.note}
      >
        {ranking.items.length ? (
          canShortlist ? (
            <form action={confirmShortlist} className="space-y-4">
              <input type="hidden" name="challenge_id" value={challenge.id} />
              <DataTable
                columns={["Shortlist", "Rank", "Applicant", "Weighted score", "Panel agreement", "Pilot cost", "Complete"]}
              >
                {ranking.items.map((row) => (
                  <tr key={row.application_id}>
                    <td>
                      <input
                        type="checkbox"
                        name="application_ids"
                        value={row.application_id}
                        defaultChecked={row.rank === 1}
                        aria-label={"Shortlist " + row.blind_label}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="num font-semibold">{row.rank}</td>
                    <td>
                      <p className="font-medium">{row.blind_label}</p>
                      <p className="num text-sm text-ink-muted">{row.reference}</p>
                    </td>
                    <td className="num font-semibold">{decimal(row.weighted_score, 1)}</td>
                    <td className="text-sm">
                      {row.disagreement > 1.5 ? (
                        <Pill tone="warn">Split panel, {decimal(row.disagreement, 1)} points apart</Pill>
                      ) : (
                        <Pill tone="good">Agreed within {decimal(row.disagreement, 1)} points</Pill>
                      )}
                    </td>
                    <td className="num text-sm">{compactRupees(row.pilot_cost_paise)}</td>
                    <td className="text-sm">
                      {row.complete ? (
                        <Pill tone="good">{row.evaluator_count} evaluators</Pill>
                      ) : (
                        <Pill tone="warn">{row.evaluator_count} of the panel</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>

              <Callout tone="neutral" title="What confirming does">
                Confirming the shortlist creates a pilot record for each selected application and
                moves the challenge to pilot design. Applicants are told their result, and every
                applicant can see their own scores with anonymised comments.
              </Callout>

              <SubmitButton
                pendingLabel="Confirming..."
                confirm="Confirm this shortlist? A pilot record is created for each selected application and every applicant is notified of their result."
              >
                Confirm the shortlist
              </SubmitButton>
            </form>
          ) : (
            <DataTable
              columns={["Rank", "Applicant", "Weighted score", "Mean", "Panel agreement", "Pilot cost", "Complete"]}
            >
              {ranking.items.map((row) => (
                <tr key={row.application_id}>
                  <td className="num font-semibold">{row.rank}</td>
                  <td>
                    <p className="font-medium">{row.blind_label}</p>
                    <p className="num text-sm text-ink-muted">{row.reference}</p>
                  </td>
                  <td className="num font-semibold">{decimal(row.weighted_score, 1)}</td>
                  <td className="num text-sm">{decimal(row.mean_score, 2)}</td>
                  <td className="text-sm">
                    {row.disagreement > 1.5 ? (
                      <Pill tone="warn">Split panel</Pill>
                    ) : (
                      <Pill tone="good">Agreed</Pill>
                    )}
                  </td>
                  <td className="num text-sm">{compactRupees(row.pilot_cost_paise)}</td>
                  <td className="text-sm">
                    {row.complete ? "Yes" : row.evaluator_count + " of the panel"}
                  </td>
                </tr>
              ))}
            </DataTable>
          )
        ) : (
          <EmptyState message="No eligible applications have been scored yet. Screening must run and the panel must submit before a ranking appears." />
        )}
      </Section>

      {ranking.items.length ? (
        <Section
          title="Score detail by criterion"
          description="The contribution of each criterion to the weighted score, and the spread between evaluators."
        >
          <div className="space-y-5">
            {ranking.items.map((row) => (
              <div key={row.application_id}>
                <h3 className="mb-2">
                  {row.rank}. {row.blind_label}{" "}
                  <span className="num font-normal text-ink-muted">
                    {decimal(row.weighted_score, 1)} of 100
                  </span>
                </h3>
                <DataTable columns={["Criterion", "Weight", "Mean score", "Spread", "Contribution"]}>
                  {row.criteria.map((criterion) => (
                    <tr key={criterion.criterion_id}>
                      <td>
                        {criterion.name}
                        {criterion.flagged ? (
                          <span className="ml-2">
                            <Pill tone="warn">Flagged</Pill>
                          </span>
                        ) : null}
                      </td>
                      <td className="num">{criterion.weight}</td>
                      <td className="num">{decimal(criterion.mean, 2)}</td>
                      <td className="num">{decimal(criterion.spread, 1)}</td>
                      <td className="num">{decimal(criterion.contribution, 1)}</td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
