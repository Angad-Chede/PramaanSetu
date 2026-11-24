import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyState, Hash, PageHeader, Pill, Section } from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { ROLE_LABELS, formatDateTime, titleCase } from "@/lib/format";
import { requireSession } from "@/lib/session";
import type { AuditEntry, Challenge } from "@/lib/types";

export const metadata: Metadata = { title: "Audit trail" };
export const dynamic = "force-dynamic";

export default async function ChallengeAuditPage({ params }: { params: { id: string } }) {
  await requireSession("/challenges/" + params.id + "/audit");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + params.id);
  const audit = await apiGet<{ items: AuditEntry[] }>(
    "/challenges/" + params.id + "/audit?limit=300",
  );

  const ordered = [...audit.items].sort((a, b) => a.seq - b.seq);

  return (
    <div>
      <PageHeader
        title="Audit trail"
        subtitle="Every state change, approval, override and sign-off, in order, each linked to the one before it by a hash. Altering or removing an entry breaks the chain and is reported."
        meta={
          <>
            <Pill>{challenge.reference}</Pill>
            <Pill>{ordered.length} entries</Pill>
          </>
        }
        actions={
          <>
            <Link href={"/challenges/" + challenge.id} className="btn btn-secondary">
              Back to the challenge
            </Link>
            <a href="/api/v1/admin/audit/export.csv" className="btn btn-secondary">
              Export as CSV
            </a>
          </>
        }
      />

      <Section title="Entries" description="Oldest first, so the story reads in order.">
        {ordered.length ? (
          <DataTable columns={["Sequence", "When", "Who", "What happened", "Detail", "Hash"]}>
            {ordered.map((entry) => (
              <tr key={entry.seq}>
                <td className="num whitespace-nowrap text-sm">{entry.seq}</td>
                <td className="whitespace-nowrap text-sm">{formatDateTime(entry.at)}</td>
                <td className="text-sm">
                  {entry.actor_role ? (
                    <Pill>{ROLE_LABELS[entry.actor_role] ?? entry.actor_role}</Pill>
                  ) : (
                    <Pill>System</Pill>
                  )}
                </td>
                <td className="text-sm font-medium">{titleCase(entry.action.replace(/\./g, " "))}</td>
                <td className="max-w-md text-sm text-ink-muted">
                  {entry.before && entry.after && "state" in entry.before && "state" in entry.after ? (
                    <span>
                      {String(entry.before.state)} to {String(entry.after.state)}
                    </span>
                  ) : entry.after ? (
                    <span className="break-words">
                      {Object.entries(entry.after)
                        .slice(0, 4)
                        .map(([key, value]) => key.replace(/_/g, " ") + ": " + String(value))
                        .join("; ")}
                    </span>
                  ) : null}
                  {entry.reason ? (
                    <span className="mt-1 block italic">Reason: {entry.reason}</span>
                  ) : null}
                </td>
                <td>
                  <Hash value={entry.hash.slice(0, 16) + "..."} />
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="No audit entries for this challenge yet." />
        )}
      </Section>
    </div>
  );
}
