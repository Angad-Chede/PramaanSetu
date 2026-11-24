import type { Metadata } from "next";
import Link from "next/link";

import { Callout, DataTable, EmptyState, PageHeader, Pill, Section, StatusPill } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { PILOT_STATE_LABELS, formatDate, money } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { requireSession } from "@/lib/session";
import type { Pilot } from "@/lib/types";

export const metadata: Metadata = { title: "Pilots" };
export const dynamic = "force-dynamic";

type PilotRow = Pilot & {
  design_frozen: boolean;
  milestone_count: number;
  paid_value: { paise: number; display: string } | null;
  overdue_milestones: number;
};

export default async function PilotsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession("/pilots");
  const body = await apiGet<{ items: PilotRow[]; count: number }>("/pilots?limit=100");
  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);

  const breaches = body.items.reduce((sum, pilot) => sum + pilot.overdue_milestones, 0);

  return (
    <div>
      <PageHeader
        title="Pilots"
        subtitle="Every pilot your department is running, with the state it is in and whether its plan was pre-registered before data collection began."
        meta={
          <>
            <Pill>{body.count} pilot{body.count === 1 ? "" : "s"}</Pill>
            {breaches ? <Pill tone="bad">{breaches} milestone(s) past their service level</Pill> : null}
          </>
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5">
          <Callout tone="bad" title="That action did not complete">{problem.message}</Callout>
        </div>
      ) : null}

      <Section title="All pilots">
        {body.items.length ? (
          <DataTable
            columns={["Reference", "Challenge", "Startup", "State", "Plan", "Value", "Paid", ""]}
            caption="Pilots"
          >
            {body.items.map((pilot) => (
              <tr key={pilot.id}>
                <td className="num whitespace-nowrap text-sm">{pilot.reference}</td>
                <td>
                  <Link href={"/pilots/" + pilot.id} className="font-medium">
                    {pilot.challenge_title ?? "Pilot"}
                  </Link>
                  {pilot.started_at ? (
                    <p className="mt-0.5 text-sm text-ink-muted">
                      Started {formatDate(pilot.started_at)}
                    </p>
                  ) : null}
                </td>
                <td className="text-sm">{pilot.startup_name}</td>
                <td>
                  <StatusPill
                    state={pilot.state}
                    label={PILOT_STATE_LABELS[pilot.state] ?? pilot.state}
                  />
                  {pilot.overdue_milestones ? (
                    <span className="ml-1">
                      <Pill tone="bad">{pilot.overdue_milestones} overdue</Pill>
                    </span>
                  ) : null}
                </td>
                <td className="text-sm">
                  {pilot.design_frozen ? (
                    <Pill tone="good">Pre-registered</Pill>
                  ) : (
                    <Pill tone="warn">Not frozen</Pill>
                  )}
                </td>
                <td className="num text-sm">{pilot.total_value ? money(pilot.total_value) : "Not set"}</td>
                <td className="num text-sm">{pilot.paid_value ? money(pilot.paid_value) : "None"}</td>
                <td className="whitespace-nowrap text-right">
                  <Link href={"/pilots/" + pilot.id}>Open</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="No pilot has been created yet. A pilot record is created when an approver confirms a shortlist." />
        )}
      </Section>
    </div>
  );
}
