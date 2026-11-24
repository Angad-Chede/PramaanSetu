import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink, DataTable, EmptyState, PageHeader, Pill, Section } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { APPLICATION_STATE_LABELS, formatDate, money } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "My applications" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  reference: string;
  challenge_id: string;
  challenge_title: string | null;
  state: string;
  pilot_cost: { paise: number; display: string } | null;
  submitted_at: string | null;
  eligibility_outcome: string | null;
};

const OUTCOME_TONE: Record<string, "good" | "warn" | "bad"> = {
  Eligible: "good",
  NeedsReview: "warn",
  Ineligible: "bad",
};

export default async function MyApplicationsPage() {
  const session = await requireSession("/my-applications");
  if (!session.startup_id) {
    return (
      <div>
        <PageHeader title="My applications" />
        <Section title="No startup profile">
          <EmptyState
            message="Your account is not attached to a startup profile. Ask the platform administrator to link it, or register a startup."
            action={<ButtonLink href="/startup">Open the startup profile page</ButtonLink>}
          />
        </Section>
      </div>
    );
  }

  const body = await apiGet<{ items: Row[] }>("/startups/" + session.startup_id + "/applications");

  return (
    <div>
      <PageHeader
        title="My applications"
        subtitle="Every application you have started, its eligibility result and its outcome. You can edit an application until the deadline; the last submitted version is the one that counts."
        meta={<Pill>{body.items.length} application{body.items.length === 1 ? "" : "s"}</Pill>}
        actions={<ButtonLink href="/challenges-board" variant="primary">Find another challenge</ButtonLink>}
      />

      <Section title="All applications">
        {body.items.length ? (
          <DataTable columns={["Reference", "Challenge", "State", "Eligibility", "Pilot cost", "Submitted", ""]}>
            {body.items.map((row) => (
              <tr key={row.id}>
                <td className="num whitespace-nowrap text-sm">{row.reference}</td>
                <td>
                  <Link href={"/my-applications/" + row.id} className="font-medium">
                    {row.challenge_title ?? "Challenge"}
                  </Link>
                </td>
                <td className="text-sm">
                  <Pill>{APPLICATION_STATE_LABELS[row.state] ?? row.state}</Pill>
                </td>
                <td className="text-sm">
                  {row.eligibility_outcome ? (
                    <Pill tone={OUTCOME_TONE[row.eligibility_outcome] ?? "neutral"}>
                      {row.eligibility_outcome === "NeedsReview" ? "Needs review" : row.eligibility_outcome}
                    </Pill>
                  ) : (
                    <span className="text-ink-muted">Not screened yet</span>
                  )}
                </td>
                <td className="num text-sm">{row.pilot_cost ? money(row.pilot_cost) : "Not quoted"}</td>
                <td className="whitespace-nowrap text-sm">
                  {row.submitted_at ? formatDate(row.submitted_at) : "Not submitted"}
                </td>
                <td className="text-right">
                  <Link href={"/my-applications/" + row.id}>Open</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState
            message="You have not applied to any challenge yet."
            action={<ButtonLink href="/challenges-board" variant="primary">Browse open challenges</ButtonLink>}
          />
        )}
      </Section>
    </div>
  );
}
