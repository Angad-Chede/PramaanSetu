import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyState, PageHeader, Pill, Section } from "@/components/ui";
import { apiGet, apiGetOptional } from "@/lib/api";
import { CHALLENGE_STATE_LABELS } from "@/lib/format";
import { requireSession } from "@/lib/session";
import type { EvidenceReport, Pilot } from "@/lib/types";

export const metadata: Metadata = { title: "Validation queue" };
export const dynamic = "force-dynamic";

type Assignment = {
  challenge_id: string;
  reference: string;
  title: string;
  state: string;
  role: string;
};

export default async function ValidationQueuePage() {
  await requireSession("/validation");
  const assignments = await apiGet<{ items: Assignment[] }>("/evaluation/assignments");
  const mine = assignments.items.filter((item) => item.role === "IV");

  const rows: { assignment: Assignment; pilot: Pilot | null; report: EvidenceReport | null }[] = [];
  for (const assignment of mine) {
    const pilots = await apiGetOptional<{ items: Pilot[] }>("/pilots?limit=100");
    const pilot =
      pilots?.items.find((candidate) => candidate.challenge_id === assignment.challenge_id) ?? null;
    const report = pilot
      ? await apiGetOptional<EvidenceReport>("/pilots/" + pilot.id + "/evidence")
      : null;
    rows.push({ assignment, pilot, report });
  }

  const waiting = rows.filter((row) => row.report?.status === "AwaitingValidation");
  const done = rows.filter((row) => row.report && row.report.status !== "AwaitingValidation");

  return (
    <div>
      <PageHeader
        title="Validation queue"
        subtitle="Pilots where you are the independent validator. Your sign-off, or your refusal, decides whether a score is issued at all."
        meta={<Pill tone={waiting.length ? "warn" : "good"}>{waiting.length} waiting on you</Pill>}
      />

      <Section title="Waiting for you">
        {waiting.length ? (
          <DataTable columns={["Challenge", "Report", "Provisional score", ""]}>
            {waiting.map((row) => (
              <tr key={row.assignment.challenge_id}>
                <td>
                  <span className="font-medium">{row.assignment.title}</span>
                  <p className="num mt-0.5 text-sm text-ink-muted">{row.assignment.reference}</p>
                </td>
                <td className="num text-sm">{row.report?.reference}</td>
                <td className="num text-sm">
                  {row.report?.confidence_score === null || row.report?.confidence_score === undefined
                    ? "Not computed"
                    : row.report.confidence_score + " of 100 (provisional)"}
                </td>
                <td className="text-right">
                  <Link href={"/validation/" + row.report!.id}>Open the workspace</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="No Evidence Report is waiting for your verification right now." />
        )}
      </Section>

      <Section title="Assignments without a report yet">
        {rows.filter((row) => !row.report).length ? (
          <DataTable columns={["Challenge", "Stage"]}>
            {rows
              .filter((row) => !row.report)
              .map((row) => (
                <tr key={row.assignment.challenge_id}>
                  <td>
                    <span className="font-medium">{row.assignment.title}</span>
                    <p className="num mt-0.5 text-sm text-ink-muted">{row.assignment.reference}</p>
                  </td>
                  <td className="text-sm">
                    {CHALLENGE_STATE_LABELS[row.assignment.state] ?? row.assignment.state}
                  </td>
                </tr>
              ))}
          </DataTable>
        ) : (
          <EmptyState message="Every challenge you are assigned to has produced a report." />
        )}
      </Section>

      {done.length ? (
        <Section title="Already decided">
          <DataTable columns={["Challenge", "Report", "Outcome", "Score", ""]}>
            {done.map((row) => (
              <tr key={row.assignment.challenge_id}>
                <td className="font-medium">{row.assignment.title}</td>
                <td className="num text-sm">{row.report?.reference}</td>
                <td className="text-sm">
                  <Pill tone={row.report?.status === "Refused" ? "bad" : "good"}>
                    {row.report?.status}
                  </Pill>
                </td>
                <td className="num text-sm">
                  {row.report?.confidence_score === null || row.report?.confidence_score === undefined
                    ? "No score issued"
                    : row.report.confidence_score + " of 100"}
                </td>
                <td className="text-right">
                  <Link href={"/validation/" + row.report!.id}>Review</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        </Section>
      ) : null}
    </div>
  );
}
