import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Download, Filter, Link2, Lock, ShieldCheck, ShieldX, X } from "lucide-react";

import { verifyAuditChain } from "@/app/actions";
import { SelectField, SubmitButton, TextField } from "@/components/app/forms";
import { Callout, EmptyState, Hash, Page, PageHeader, Panel } from "@/components/app/kit";
import { Badge } from "@/components/ui/badge";
import { BarList } from "@/components/ui/bar-list";
import { Button } from "@/components/ui/button";
import { all, apiGet } from "@/lib/api";
import { ROLE_LABELS, formatDate, titleCase } from "@/lib/format";
import { readNotice, single } from "@/lib/forms";
import { requireSession } from "@/lib/session";
import type { AuditEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit chain" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const HOW = [
  { icon: Lock, text: "Append-only: the application's database role can insert and read entries, never update or delete them." },
  { icon: Link2, text: "Inserts are serialised inside the business transaction, so the chain never forks, even when many people act at once." },
  { icon: ShieldCheck, text: "A nightly job and the Verify button recompute every hash and report the first broken link." },
  { icon: Download, text: "The latest hash is written daily to separate write-once storage, so someone with database access cannot quietly rewrite the whole chain." },
];

function time(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function Detail({ entry }: { entry: AuditEntry }) {
  if (entry.before && entry.after && "state" in entry.before && "state" in entry.after) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{String(entry.before.state)}</Badge>
        <ArrowRight className="size-3 text-glyph" />
        <Badge variant="outline">{String(entry.after.state)}</Badge>
      </span>
    );
  }
  if (entry.after) {
    return (
      <span className="flex flex-wrap gap-x-3 gap-y-1">
        {Object.entries(entry.after)
          .slice(0, 3)
          .map(([key, value]) => (
            <span key={key} className="min-w-0 break-words">
              <span className="text-glyph">{key.replace(/_/g, " ")}</span> <span className="text-foreground/85">{String(value)}</span>
            </span>
          ))}
      </span>
    );
  }
  return null;
}

export default async function AuditPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = new URLSearchParams({ limit: "200" });
  for (const key of ["entity_type", "action", "actor_id"]) {
    const value = single(params[key]);
    if (value) query.set(key, value);
  }

  const [, audit] = await all(
    requireSession("/admin/audit"),
    apiGet<{ items: AuditEntry[]; count: number }>("/admin/audit?" + query.toString()),
  );
  const notice = readNotice(params);
  const intact = notice?.includes("intact") ?? false;
  const filtered = ["entity_type", "action", "actor_id"].some((key) => single(params[key]));

  const entityTypes = Array.from(new Set(audit.items.map((entry) => entry.entity_type))).sort();
  const byRole = new Map<string, number>();
  for (const entry of audit.items) {
    const role = entry.actor_role ? (ROLE_LABELS[entry.actor_role] ?? entry.actor_role) : "System";
    byRole.set(role, (byRole.get(role) ?? 0) + 1);
  }

  const days: { day: string; items: AuditEntry[] }[] = [];
  for (const entry of audit.items) {
    const day = formatDate(entry.at);
    const group = days.find((item) => item.day === day);
    if (group) group.items.push(entry);
    else days.push({ day, items: [entry] });
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Audit chain"
        description="Every state change, approval, override, score lock, sign-off and administrative action, chained by hash. Altering, removing or reordering an entry breaks the chain and is reported."
        meta={
          <Badge variant="secondary" className="tabular-nums">
            {audit.count} entries shown
          </Badge>
        }
        actions={
          <>
            <form action={verifyAuditChain}>
              <SubmitButton variant="brand" pendingLabel="Verifying">
                <ShieldCheck />
                Verify the chain
              </SubmitButton>
            </form>
            <Button asChild variant="secondary">
              <a href="/api/v1/admin/audit/export.csv">
                <Download />
                Export as CSV
              </a>
            </Button>
          </>
        }
      />

      {notice && (
        <Callout tone={intact ? "success" : "destructive"} icon={intact ? ShieldCheck : ShieldX} title="Chain verification">
          {notice}
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {audit.items.length ? (
            days.map((group) => (
              <section key={group.day} className="flex flex-col gap-2">
                <h2 className="sticky top-14 z-10 -mx-1 bg-background/85 px-1 py-2 text-[12px] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur">
                  {group.day}
                </h2>
                <ol className="overflow-hidden rounded-3xl bg-card shadow-card">
                  {group.items.map((entry, index) => {
                    const automated = !entry.actor_id;
                    const last = index === group.items.length - 1;
                    return (
                      <li key={entry.seq} className={cn("relative flex gap-4 px-5 py-4 md:px-6", index > 0 && "border-t border-border/70")}>
                        {!last && <span aria-hidden className="absolute top-12 -bottom-4 left-[41px] w-px bg-border md:left-[45px]" />}
                        <span className="relative z-10 grid h-8 min-w-10 shrink-0 place-items-center rounded-xl bg-surface px-1.5 font-mono text-[12px] font-medium text-foreground shadow-lift tabular-nums">
                          {entry.seq}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            <code className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12px] font-medium text-foreground">{entry.action}</code>
                            <Badge variant={automated ? "info" : "secondary"}>
                              {automated && <Bot />}
                              {entry.actor_role ? (ROLE_LABELS[entry.actor_role] ?? entry.actor_role) : "System"}
                              {automated && entry.actor_role ? ", automated" : ""}
                            </Badge>
                            <span className="ml-auto font-mono text-[12px] text-muted-foreground tabular-nums">{time(entry.at)} IST</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                            <span className="font-medium text-foreground">{titleCase(entry.entity_type)}</span>
                            <span className="font-mono text-[12px] text-muted-foreground">{entry.entity_id.slice(-8)}</span>
                          </div>
                          <div className="text-[13px] text-muted-foreground">
                            <Detail entry={entry} />
                          </div>
                          {entry.reason && <p className="border-l-2 border-border pl-3 text-[13px] leading-relaxed text-pretty text-muted-foreground italic">{entry.reason}</p>}
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5 pt-0.5">
                            {entry.prev_hash && (
                              <>
                                <Hash value={entry.prev_hash} className="opacity-70" />
                                <Link2 aria-label="links to" className="size-3 shrink-0 text-glyph" />
                              </>
                            )}
                            <Hash value={entry.hash} className="text-foreground/80" />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))
          ) : (
            <EmptyState
              icon={Filter}
              title="No entries match this filter"
              description="Widen the record type or the action, or clear the filter to see the whole chain."
              action={
                <Button asChild variant="secondary">
                  <Link href="/admin/audit">Clear the filter</Link>
                </Button>
              }
            />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <Panel title="Filter">
            <form method="get" className="flex flex-col gap-4">
              <SelectField
                label="Record type"
                name="entity_type"
                defaultValue={single(params.entity_type) ?? ""}
                options={[{ value: "", label: "Every type" }, ...entityTypes.map((type) => ({ value: type, label: titleCase(type) }))]}
              />
              <TextField label="Action" name="action" defaultValue={single(params.action) ?? ""} placeholder="For example milestone.accept" />
              {single(params.actor_id) && <input type="hidden" name="actor_id" value={single(params.actor_id) ?? ""} />}
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  <Filter />
                  Apply
                </Button>
                {filtered && (
                  <Button asChild variant="secondary">
                    <Link href="/admin/audit">
                      <X />
                      Clear
                    </Link>
                  </Button>
                )}
              </div>
            </form>
          </Panel>

          {byRole.size > 0 && (
            <Panel title="Who acted" description="Entries shown, by the role that acted.">
              <BarList data={Array.from(byRole, ([name, value]) => ({ name, value }))} />
            </Panel>
          )}

          <Panel title="How the chain works" description="Each entry stores the SHA-256 of the previous hash joined to its own canonical contents.">
            <ul className="flex flex-col gap-3.5">
              {HOW.map((item) => (
                <li key={item.text} className="flex gap-3 text-[13px] leading-relaxed text-pretty text-muted-foreground">
                  <item.icon className="mt-0.5 size-4 shrink-0 text-glyph" />
                  {item.text}
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </Page>
  );
}
