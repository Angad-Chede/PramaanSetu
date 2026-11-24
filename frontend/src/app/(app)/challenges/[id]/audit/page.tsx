import type { Metadata } from "next";
import { ArrowRight, Bot, Download, GitCommitVertical, Link2, ScrollText, ShieldCheck, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState, Figure, FigureGrid, Hash, Page, PageHeader, ToneBadge, toneFor } from "@/components/app/kit";
import { Button } from "@/components/ui/button";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { ROLE_LABELS, formatDate, formatDateTime, titleCase } from "@/lib/format";
import { requireSession } from "@/lib/session";
import type { AuditEntry, Challenge } from "@/lib/types";

export const metadata: Metadata = { title: "Audit trail" };
export const dynamic = "force-dynamic";

function humanState(value: unknown) {
  return String(value).replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

type Props = { params: Promise<{ id: string }> };

export default async function ChallengeAuditPage({ params }: Props) {
  const { id } = await params;
  await requireSession("/challenges/" + id + "/audit");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + id);
  const audit = await apiGet<{ items: AuditEntry[] }>("/challenges/" + id + "/audit?limit=300");

  const ordered = [...audit.items].sort((a, b) => a.seq - b.seq);
  const transitions = ordered.filter((entry) => entry.before && entry.after && "state" in entry.before && "state" in entry.after).length;
  const roles = new Set(ordered.map((entry) => entry.actor_role ?? "System"));

  return (
    <Page>
      <PageHeader
        back={{ href: "/challenges/" + challenge.id, label: "Back to the challenge" }}
        eyebrow={
          <>
            <span className="font-mono text-foreground/80">{challenge.reference}</span>
            <span className="truncate">{challenge.title}</span>
          </>
        }
        title="Audit trail"
        description="Every state change, approval, override and sign-off, in order, each linked to the one before it by a hash. Altering or removing an entry breaks the chain and is reported."
        actions={
          <Button asChild variant="secondary">
            <a href="/api/v1/admin/audit/export.csv">
              <Download />
              Export as CSV
            </a>
          </Button>
        }
      />

      <FigureGrid className="grid-cols-2">
        <Figure label="Entries" value={ordered.length} icon={ScrollText} hint="Oldest first, so the story reads in order" />
        <Figure label="State changes" value={transitions} icon={GitCommitVertical} tone="brand" hint="Each one a recorded step in the workflow" />
        <Figure label="Roles involved" value={roles.size} icon={UserRound} tone="info" hint={[...roles].map((role) => ROLE_LABELS[role] ?? role).join(", ") || "None yet"} />
        <Figure
          label="Span"
          value={ordered.length ? formatDate(ordered[0].at) : "None"}
          icon={ShieldCheck}
          tone="success"
          hint={ordered.length > 1 ? "to " + formatDate(ordered[ordered.length - 1].at) : "A single day"}
        />
      </FigureGrid>

      {ordered.length ? (
        <section className="rounded-3xl bg-card p-4 shadow-card sm:p-6">
          <ol className="relative">
            {ordered.map((entry, index) => {
              const stateChange = entry.before && entry.after && "state" in entry.before && "state" in entry.after;
              const details = !stateChange && entry.after ? Object.entries(entry.after).slice(0, 4) : [];
              const last = index === ordered.length - 1;
              return (
                <li key={entry.seq} className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 pb-6 last:pb-0 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-x-4">
                  {!last && <span aria-hidden className="absolute top-9 bottom-0 left-[1.125rem] w-px bg-border sm:left-6" />}
                  <span
                    className={cn(
                      "relative z-10 grid size-9 place-items-center rounded-full font-mono text-[11px] font-semibold tabular-nums sm:size-12 sm:text-xs",
                      stateChange ? "bg-foreground text-background" : "bg-surface text-foreground shadow-lift",
                    )}
                  >
                    {entry.seq}
                  </span>
                  <div className="flex min-w-0 flex-col gap-2 pt-1 sm:pt-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <p className="text-sm font-semibold text-foreground">{titleCase(entry.action.replace(/^challenge\./, "").replace(/\./g, " "))}</p>
                      <ToneBadge dot={false} tone={entry.actor_role ? "neutral" : "info"}>
                        {entry.actor_role ? <UserRound /> : <Bot />}
                        {entry.actor_role ? ROLE_LABELS[entry.actor_role] ?? entry.actor_role : "System"}
                      </ToneBadge>
                      <time dateTime={entry.at} className="text-[12px] text-muted-foreground tabular-nums">
                        {formatDateTime(entry.at)}
                      </time>
                    </div>

                    {stateChange && (
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        <ToneBadge tone={toneFor(String(entry.before!.state))} dot={false}>
                          {humanState(entry.before!.state)}
                        </ToneBadge>
                        <ArrowRight className="size-3.5 text-glyph" />
                        <ToneBadge tone={toneFor(String(entry.after!.state))}>{humanState(entry.after!.state)}</ToneBadge>
                      </div>
                    )}

                    {details.length > 0 && (
                      <dl className="flex flex-wrap gap-1.5">
                        {details.map(([key, value]) => (
                          <div key={key} className="inline-flex max-w-full items-baseline gap-1.5 rounded-lg bg-surface/80 px-2 py-1 text-[12px]">
                            <dt className="text-muted-foreground">{key.replace(/_/g, " ")}</dt>
                            <dd className="truncate font-medium text-foreground tabular-nums">{formatValue(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {entry.reason && <p className="border-l-2 border-border pl-3 text-[13px] text-muted-foreground italic">Reason: {entry.reason}</p>}

                    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                      <Hash value={entry.hash} />
                      {entry.prev_hash && (
                        <span className="inline-flex items-center gap-1" title={"Follows " + entry.prev_hash}>
                          <Link2 className="size-3" />
                          follows {entry.prev_hash.slice(0, 8)}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : (
        <EmptyState icon={ScrollText} title="No audit entries yet" description="Entries appear here from the moment the challenge is created." />
      )}
    </Page>
  );
}
