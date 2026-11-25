import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, FileClock, Hourglass, ShieldCheck, Stamp } from "lucide-react";

import { EmptyState, Figure, FigureGrid, Page, PageHeader, Panel, SectionHeading, StateBadge, ToneBadge } from "@/components/app/kit";
import { all, apiGet, apiGetOptional } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, decimal } from "@/lib/format";
import { requireSession } from "@/lib/session";
import type { EvidenceReport, Pilot } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Validation queue" };
export const dynamic = "force-dynamic";

type Assignment = {
  challenge_id: string;
  reference: string;
  title: string;
  state: string;
  role: string;
};

type Row = { assignment: Assignment; pilot: Pilot | null; report: EvidenceReport | null };

const STATUS_LABELS: Record<string, string> = {
  AwaitingValidation: "Awaiting your sign-off",
  SignedOff: "Signed off",
  SignedOffWithQualifications: "Signed off with qualifications",
  Refused: "Refused",
};

function ScoreChip({ score, provisional }: { score: number | null | undefined; provisional?: boolean }) {
  if (score === null || score === undefined) return <span className="text-[13px] text-muted-foreground">{provisional ? "Not computed" : "No score issued"}</span>;
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-display text-2xl font-semibold tracking-tight tabular-nums">{decimal(score, 0)}</span>
      <span className="text-[12px] text-muted-foreground">/100{provisional ? " provisional" : ""}</span>
    </span>
  );
}

export default async function ValidationQueuePage() {
  const [, assignments] = await all(requireSession("/validation"), apiGet<{ items: Assignment[] }>("/evaluation/assignments"));
  const mine = assignments.items.filter((item) => item.role === "IV");

  const rows: Row[] = [];
  if (mine.length) {
    const pilots = await apiGetOptional<{ items: Pilot[] }>("/pilots?limit=100");
    const reads = mine.map(async (assignment) => {
      const pilot = pilots?.items.find((candidate) => candidate.challenge_id === assignment.challenge_id) ?? null;
      const report = pilot ? await apiGetOptional<EvidenceReport>("/pilots/" + pilot.id + "/evidence") : null;
      return { assignment, pilot, report };
    });
    rows.push(...(await all(...reads)));
  }

  const waiting = rows.filter((row) => row.report?.status === "AwaitingValidation");
  const noReport = rows.filter((row) => !row.report);
  const done = rows.filter((row) => row.report && row.report.status !== "AwaitingValidation");

  return (
    <Page>
      <PageHeader
        eyebrow={<ToneBadge tone={waiting.length ? "warning" : "success"}>{waiting.length} waiting on you</ToneBadge>}
        title="Validation queue"
        description="Pilots where you are the independent validator. Your sign-off, or your refusal, decides whether a score is issued at all."
      />

      <FigureGrid columns={3}>
        <Figure label="Waiting for you" value={waiting.length} icon={Hourglass} tone={waiting.length ? "brand" : "neutral"} hint="Evidence Reports ready to verify" />
        <Figure label="No report yet" value={noReport.length} icon={FileClock} tone="neutral" hint="Pilots still collecting data" />
        <Figure label="Decided" value={done.length} icon={Stamp} tone="success" hint="Signed off or refused" />
      </FigureGrid>

      <SectionHeading title="Waiting for you" />
      {waiting.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {waiting.map((row) => (
            <Link
              key={row.assignment.challenge_id}
              href={"/validation/" + row.report!.id}
              className="group relative flex flex-col gap-5 overflow-hidden rounded-3xl bg-card p-5 shadow-card outline-none ring-1 ring-brand/20 transition-[translate,box-shadow] duration-200 ease-ios hover:-translate-y-0.5 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring md:p-6"
            >
              <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-brand" />
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {row.assignment.reference} · {row.report?.reference}
                  </span>
                  <h3 className="font-display text-[17px] leading-snug font-semibold tracking-tight text-balance">{row.assignment.title}</h3>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-glyph transition-transform duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              <div className="mt-auto flex items-end justify-between gap-3">
                <ScoreChip score={row.report?.confidence_score} provisional />
                <span className="text-[13px] font-medium text-brand-ink">Open the workspace</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState icon={ShieldCheck} title="Nothing to verify right now" description="When a pilot finishes and its Evidence Report is generated, it appears here for your sign-off." />
      )}

      <SectionHeading title="Assignments without a report yet" />
      {noReport.length ? (
        <Panel flush>
          <ul className="divide-y divide-border/70">
            {noReport.map((row) => (
              <li key={row.assignment.challenge_id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center md:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.assignment.title}</p>
                  <p className="font-mono text-[12px] text-muted-foreground">{row.assignment.reference}</p>
                </div>
                <StateBadge state={row.assignment.state} labels={CHALLENGE_STATE_LABELS} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <p className="text-sm text-muted-foreground">Every challenge you are assigned to has produced a report.</p>
      )}

      {done.length > 0 && (
        <>
          <SectionHeading title="Already decided" />
          <Panel flush>
            <ul className="divide-y divide-border/70">
              {done.map((row) => {
                const refused = row.report?.status === "Refused";
                return (
                  <li key={row.assignment.challenge_id}>
                    <Link href={"/validation/" + row.report!.id} className="group flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-surface/60 sm:flex-row sm:items-center md:px-6">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.assignment.title}</p>
                        <p className="font-mono text-[12px] text-muted-foreground">{row.report?.reference}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <ToneBadge tone={refused ? "destructive" : "success"}>{STATUS_LABELS[row.report!.status] ?? row.report!.status}</ToneBadge>
                        <span className={cn("w-24 text-right", refused && "opacity-60")}>
                          <ScoreChip score={row.report?.confidence_score} />
                        </span>
                        <ArrowUpRight className="size-4 shrink-0 text-glyph transition-transform duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </>
      )}
    </Page>
  );
}
