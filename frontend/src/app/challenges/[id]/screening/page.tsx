import type { Metadata } from "next";
import Link from "next/link";

import { overrideEligibility, runWorkflowStep } from "@/app/challenges/actions";
import { Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  StatusPill,
} from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { APPLICATION_STATE_LABELS, CHALLENGE_STATE_LABELS, money } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge, Eligibility } from "@/lib/types";

export const metadata: Metadata = { title: "Applications and eligibility" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  reference: string;
  startup_id: string;
  startup_name: string | null;
  state: string;
  pilot_cost: { paise: number; display: string } | null;
  submitted_at: string | null;
  locked_at: string | null;
  eligibility: Eligibility | null;
};

const OUTCOME_TONE: Record<string, "good" | "warn" | "bad"> = {
  Eligible: "good",
  NeedsReview: "warn",
  Ineligible: "bad",
};

export default async function ScreeningPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/challenges/" + params.id + "/screening");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + params.id);
  const applications = await apiGet<{ items: Row[]; count: number }>(
    "/challenges/" + params.id + "/applications",
  );

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const canOverride = hasRole(session, "DO") && session.department_id === challenge.department_id;
  const screened = applications.items.filter((row) => row.eligibility);

  const counts = {
    Eligible: screened.filter((r) => r.eligibility?.outcome === "Eligible").length,
    NeedsReview: screened.filter((r) => r.eligibility?.outcome === "NeedsReview").length,
    Ineligible: screened.filter((r) => r.eligibility?.outcome === "Ineligible").length,
  };

  return (
    <div>
      <PageHeader
        title="Applications and eligibility"
        subtitle="Every rule produces a sentence the applicant can act on. Where the government relaxation of prior turnover and experience applies to a recognised startup, it is applied automatically and the rule used is recorded."
        meta={
          <>
            <Pill>{challenge.reference}</Pill>
            <Pill>
              {CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state}
            </Pill>
            <Pill>{applications.count} application{applications.count === 1 ? "" : "s"}</Pill>
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

      {challenge.state === "ApplicationsClosed" && canOverride ? (
        <Section
          title="Run eligibility screening"
          description="The rules engine checks every locked application against the published criteria."
        >
          <form action={runWorkflowStep}>
            <input type="hidden" name="challenge_id" value={challenge.id} />
            <input type="hidden" name="action" value="screen" />
            <input type="hidden" name="back" value={"/challenges/" + challenge.id + "/screening"} />
            <SubmitButton pendingLabel="Screening...">Run screening now</SubmitButton>
          </form>
        </Section>
      ) : null}

      {screened.length ? (
        <Section title="Results" description="Counted by outcome.">
          <div className="grid grid-cols-3 gap-4">
            {(["Eligible", "NeedsReview", "Ineligible"] as const).map((outcome) => (
              <div
                key={outcome}
                className={
                  "rounded border px-3 py-3 " +
                  (outcome === "Eligible"
                    ? "border-good bg-good-light"
                    : outcome === "NeedsReview"
                      ? "border-warn bg-warn-light"
                      : "border-bad bg-bad-light")
                }
              >
                <p className="num text-2xl font-semibold text-ink">{counts[outcome]}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {outcome === "NeedsReview" ? "Needs review" : outcome}
                </p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section
        title="Every application"
        description="Open each one to see the reason recorded against every rule."
      >
        {applications.items.length ? (
          <div className="space-y-4">
            {applications.items.map((row) => (
              <article key={row.id} className="rounded border border-line">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper-soft px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{row.startup_name ?? "Applicant"}</p>
                    <p className="num text-sm text-ink-muted">{row.reference}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      state={row.state}
                      label={APPLICATION_STATE_LABELS[row.state] ?? row.state}
                    />
                    {row.eligibility ? (
                      <Pill tone={OUTCOME_TONE[row.eligibility.outcome] ?? "neutral"}>
                        {row.eligibility.outcome === "NeedsReview"
                          ? "Needs review"
                          : row.eligibility.outcome}
                      </Pill>
                    ) : (
                      <Pill>Not screened</Pill>
                    )}
                    <span className="num text-sm text-ink-muted">
                      {row.pilot_cost ? money(row.pilot_cost) : "No cost quoted"}
                    </span>
                  </div>
                </div>

                <div className="px-4 py-3">
                  {row.eligibility ? (
                    <>
                      {row.eligibility.relaxations_applied.length ? (
                        <div className="mb-3">
                          <Callout tone="good" title="Startup relaxation applied">
                            <p>
                              {row.eligibility.relaxations_applied
                                .map((relaxation) => relaxation.name.toLowerCase())
                                .join(" and ")}{" "}
                              relaxed for this recognised startup. Quality and technical criteria
                              are unchanged.
                            </p>
                            <p className="mt-1 text-xs">
                              {row.eligibility.relaxations_applied[0].citation}
                            </p>
                          </Callout>
                        </div>
                      ) : null}

                      <DataTable columns={["Rule", "Outcome", "Reason", "What to do"]}>
                        {row.eligibility.rule_results.map((rule) => (
                          <tr key={rule.code}>
                            <td className="whitespace-nowrap font-medium">{rule.name}</td>
                            <td>
                              <Pill tone={rule.passed ? "good" : rule.blocking ? "bad" : "warn"}>
                                {rule.passed ? "Met" : rule.blocking ? "Not met" : "Review"}
                              </Pill>
                              {rule.relaxed ? (
                                <span className="ml-1">
                                  <Pill tone="good">Relaxed</Pill>
                                </span>
                              ) : null}
                            </td>
                            <td className="text-sm">{rule.reason}</td>
                            <td className="text-sm text-ink-muted">{rule.fix || "No action needed"}</td>
                          </tr>
                        ))}
                      </DataTable>

                      {row.eligibility.overridden_by ? (
                        <div className="mt-3">
                          <Callout tone="warn" title="This result was overridden">
                            <p>{row.eligibility.override_reason}</p>
                            <p className="mt-1 text-xs text-ink-muted">
                              The override is in the audit log and is visible to the approver.
                            </p>
                          </Callout>
                        </div>
                      ) : null}

                      {canOverride ? (
                        <div className="mt-4">
                          <Disclosure summary="Override this result">
                            <form action={overrideEligibility} className="max-w-form space-y-3">
                              <input type="hidden" name="challenge_id" value={challenge.id} />
                              <input type="hidden" name="application_id" value={row.id} />
                              <Field label="New outcome" name={"outcome_" + row.id}>
                                <select id={"outcome_" + row.id} name="outcome" defaultValue="Eligible">
                                  <option value="Eligible">Eligible</option>
                                  <option value="NeedsReview">Needs review</option>
                                  <option value="Ineligible">Ineligible</option>
                                </select>
                              </Field>
                              <Field
                                label="Written justification"
                                name={"justification_" + row.id}
                                required
                                help="At least 20 characters. The approver and any auditor will read this."
                              >
                                <textarea
                                  id={"justification_" + row.id}
                                  name="justification"
                                  rows={3}
                                  required
                                  minLength={20}
                                />
                              </Field>
                              <SubmitButton variant="secondary">Record the override</SubmitButton>
                            </form>
                          </Disclosure>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-ink-muted">
                      This application has not been screened yet.
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState message="No applications have been received for this challenge yet." />
        )}
      </Section>
    </div>
  );
}
