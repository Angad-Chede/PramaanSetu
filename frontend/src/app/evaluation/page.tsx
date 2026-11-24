import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyState, PageHeader, Pill, Section } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, ROLE_LABELS, formatDate, relativeDeadline } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "My panel work" };
export const dynamic = "force-dynamic";

type Assignment = {
  challenge_id: string;
  reference: string;
  title: string;
  state: string;
  role: string;
  evaluation_deadline: string | null;
  progress: { total: number; declared: number; scored: number; pending: number } | null;
};

export default async function EvaluationHomePage() {
  await requireSession("/evaluation");
  const body = await apiGet<{ items: Assignment[] }>("/evaluation/assignments");

  const evaluating = body.items.filter((item) => item.role === "EE");
  const validating = body.items.filter((item) => item.role === "IV");

  return (
    <div>
      <PageHeader
        title="My panel work"
        subtitle="Challenges you are assigned to. Round one scoring is blind: you do not see who the applicant is."
        meta={<Pill>{body.items.length} assignment{body.items.length === 1 ? "" : "s"}</Pill>}
      />

      <Section
        title="Applications to score"
        description="Declare any conflict of interest before scoring. A declared conflict removes the application from your list."
      >
        {evaluating.length ? (
          <DataTable columns={["Challenge", "Stage", "Applications", "Still to score", "Deadline", ""]}>
            {evaluating.map((item) => (
              <tr key={item.challenge_id}>
                <td>
                  <Link href={"/evaluation/" + item.challenge_id} className="font-medium">
                    {item.title}
                  </Link>
                  <p className="num mt-0.5 text-sm text-ink-muted">{item.reference}</p>
                </td>
                <td className="text-sm">{CHALLENGE_STATE_LABELS[item.state] ?? item.state}</td>
                <td className="num">{item.progress?.total ?? 0}</td>
                <td className="num">
                  {item.progress && item.progress.pending > 0 ? (
                    <Pill tone="warn">{item.progress.pending}</Pill>
                  ) : (
                    <Pill tone="good">0</Pill>
                  )}
                </td>
                <td className="whitespace-nowrap text-sm">
                  {item.evaluation_deadline ? (
                    <>
                      {formatDate(item.evaluation_deadline)}
                      <span className="block text-ink-muted">
                        {relativeDeadline(item.evaluation_deadline)}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-muted">Not set</span>
                  )}
                </td>
                <td className="text-right">
                  <Link href={"/evaluation/" + item.challenge_id}>Open</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="You are not assigned to score any challenge right now." />
        )}
      </Section>

      <Section
        title="Pilots to validate"
        description="As an independent validator you verify the data behind an Evidence Report and sign it off, sign it off with qualifications, or refuse."
      >
        {validating.length ? (
          <DataTable columns={["Challenge", "Stage", ""]}>
            {validating.map((item) => (
              <tr key={item.challenge_id}>
                <td>
                  <span className="font-medium">{item.title}</span>
                  <p className="num mt-0.5 text-sm text-ink-muted">{item.reference}</p>
                </td>
                <td className="text-sm">{CHALLENGE_STATE_LABELS[item.state] ?? item.state}</td>
                <td className="text-right">
                  <Link href={"/validation"}>Open the validation queue</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="You are not named as validator on any challenge right now." />
        )}
      </Section>

      <Section title="How scoring works">
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
          <li>
            Round one hides the applicant name, founders and case-reference names. You score the
            proposal, not the reputation.
          </li>
          <li>
            Every criterion is scored from 1 to 5 against its anchors, with a one-line justification
            that the applicant will eventually see, anonymised.
          </li>
          <li>
            Where the panel differs by more than 1.5 points on a criterion, the application is
            flagged and the written justifications are read before the shortlist is confirmed.
          </li>
          <li>
            Scores lock when everyone has submitted, or at the deadline. Only the approver can
            reopen scoring, and the reopening is recorded.
          </li>
        </ul>
      </Section>
    </div>
  );
}
