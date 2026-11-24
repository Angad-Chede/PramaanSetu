import type { Metadata } from "next";
import Link from "next/link";

import { verifyAuditChain } from "@/app/actions";
import { SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  EmptyState,
  Hash,
  PageHeader,
  Pill,
  Section,
} from "@/components/ui";
import { apiGet } from "@/lib/api";
import { ROLE_LABELS, formatDateTime, titleCase } from "@/lib/format";
import { readNotice, single } from "@/lib/forms";
import { requireSession } from "@/lib/session";
import type { AuditEntry } from "@/lib/types";

export const metadata: Metadata = { title: "Audit" };
export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession("/admin/audit");

  const query = new URLSearchParams({ limit: "200" });
  for (const key of ["entity_type", "action", "actor_id"]) {
    const value = single(searchParams?.[key]);
    if (value) query.set(key, value);
  }

  const audit = await apiGet<{ items: AuditEntry[]; count: number }>("/admin/audit?" + query.toString());
  const notice = readNotice(searchParams);

  const entityTypes = Array.from(new Set(audit.items.map((entry) => entry.entity_type))).sort();

  return (
    <div>
      <PageHeader
        title="Audit trail"
        subtitle="Every state change, approval, override, score lock, sign-off and administrative action, chained by hash. Altering, removing or reordering an entry breaks the chain and is reported."
        meta={<Pill>{audit.count} entries shown</Pill>}
        actions={
          <>
            <form action={verifyAuditChain}>
              <SubmitButton variant="primary" pendingLabel="Verifying...">
                Verify the chain
              </SubmitButton>
            </form>
            <a href="/api/v1/admin/audit/export.csv" className="btn btn-secondary">
              Export as CSV
            </a>
          </>
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone={notice.includes("intact") ? "good" : "bad"} title="Chain verification">
            {notice}
          </Callout>
        </div>
      ) : null}

      <Section
        title="How the chain works"
        description="Each entry stores the SHA-256 of the previous hash concatenated with its own canonical contents."
      >
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
          <li>
            The table is append-only: the application database role has insert and select on it, not
            update or delete.
          </li>
          <li>
            Inserts are serialised inside the business transaction, so the chain has no forks even
            when many users act at once.
          </li>
          <li>
            A nightly job and this button recompute the chain and report the first broken link.
          </li>
          <li>
            The latest hash is also written daily to separate write-once storage, so an attacker
            with database access cannot silently rewrite the whole chain.
          </li>
        </ul>
      </Section>

      <Section title="Filter">
        <form method="get" className="grid gap-4 sm:grid-cols-4">
          <div className="field">
            <label htmlFor="entity_type">Record type</label>
            <select id="entity_type" name="entity_type" defaultValue={single(searchParams?.entity_type) ?? ""}>
              <option value="">Every type</option>
              {entityTypes.map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="action">Action</label>
            <input
              id="action"
              name="action"
              defaultValue={single(searchParams?.action) ?? ""}
              placeholder="For example milestone.accept"
            />
          </div>
          <div className="flex items-end gap-3 sm:col-span-2">
            <button type="submit" className="btn btn-primary">
              Apply the filter
            </button>
            <Link href="/admin/audit" className="btn btn-secondary">
              Clear
            </Link>
          </div>
        </form>
      </Section>

      <Section title="Entries" description="Newest first.">
        {audit.items.length ? (
          <DataTable columns={["Seq", "When", "Who", "Action", "Record", "Detail", "Hash"]}>
            {audit.items.map((entry) => (
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
                <td className="whitespace-nowrap text-sm font-medium">{entry.action}</td>
                <td className="text-sm">
                  {titleCase(entry.entity_type)}
                  <span className="num block text-xs text-ink-muted">
                    {entry.entity_id.slice(0, 8)}
                  </span>
                </td>
                <td className="max-w-md text-sm text-ink-muted">
                  {entry.before && entry.after && "state" in entry.before && "state" in entry.after ? (
                    <span>
                      {String(entry.before.state)} to {String(entry.after.state)}
                    </span>
                  ) : entry.after ? (
                    <span className="break-words">
                      {Object.entries(entry.after)
                        .slice(0, 3)
                        .map(([key, value]) => key.replace(/_/g, " ") + ": " + String(value))
                        .join("; ")}
                    </span>
                  ) : null}
                  {entry.reason ? <span className="mt-1 block italic">{entry.reason}</span> : null}
                </td>
                <td>
                  <Hash value={entry.hash.slice(0, 12) + "..."} />
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="No audit entries match this filter." />
        )}
      </Section>
    </div>
  );
}
