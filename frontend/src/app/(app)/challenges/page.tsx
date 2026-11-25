import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, FilePlus2, FileStack, FlaskConical, IndianRupee, Megaphone } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  EmptyState,
  Figure,
  FigureGrid,
  Flash,
  LinkButton,
  Page,
  PageHeader,
  Panel,
  StateBadge,
} from "@/components/app/kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { all, apiGet } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, compactRupees, formatDate, relativeDeadline } from "@/lib/format";
import { single } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge } from "@/lib/types";

export const metadata: Metadata = { title: "Challenges" };
export const dynamic = "force-dynamic";

const STAGE_ORDER = [
  "Draft",
  "InReview",
  "Published",
  "ApplicationsClosed",
  "Screening",
  "Evaluation",
  "Shortlisted",
  "PilotDesign",
  "PilotActive",
  "Validation",
  "DecisionPending",
  "Scaled",
  "Closed",
  "Cancelled",
];

const IN_PILOT = ["PilotDesign", "PilotActive", "Validation", "DecisionPending"];

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ChallengesPage({ searchParams }: Props) {
  const params = await searchParams;
  const state = single(params.state);
  const query = new URLSearchParams({ mine: "true", limit: "100" });
  if (state) query.set("state", state);

  const [session, body] = await all(requireSession("/challenges"), apiGet<{ items: Challenge[] }>("/challenges?" + query.toString()));
  const items = body.items;
  const canWrite = hasRole(session, "DO");

  const counts = new Map<string, number>();
  for (const challenge of items) counts.set(challenge.state, (counts.get(challenge.state) ?? 0) + 1);

  const open = items.filter((c) => c.state === "Published").length;
  const piloting = items.filter((c) => IN_PILOT.includes(c.state)).length;
  const budget = items.reduce((sum, c) => sum + (c.budget_ceiling?.paise ?? 0), 0);
  const drafts = items.filter((c) => c.state === "Draft" || c.state === "InReview").length;

  return (
    <Page>
      <PageHeader
        eyebrow="Department"
        title="Challenges"
        description="Every challenge your department owns and the stage it is in. No stage can be skipped: each one needs a recorded artefact before the next can start."
        actions={
          canWrite ? (
            <LinkButton href="/challenges/new" variant="brand">
              <FilePlus2 />
              Write a new challenge
            </LinkButton>
          ) : null
        }
      />

      <Flash searchParams={params} />

      <FigureGrid className="grid-cols-2">
        <Figure label={state ? "In this stage" : "Challenges"} value={items.length} icon={FileStack} hint={drafts ? `${drafts} still in drafting or approval` : "None waiting in drafting"} />
        <Figure label="Open for applications" value={open} icon={Megaphone} tone="brand" hint="Published and accepting proposals" />
        <Figure label="In pilot or validation" value={piloting} icon={FlaskConical} tone="info" hint="Designed, running or being validated" />
        <Figure label="Budget ceilings" value={budget ? compactRupees(budget).replace("INR ", "₹") : "₹0"} icon={IndianRupee} tone="success" hint="Sum across the challenges shown" />
      </FigureGrid>

      <nav aria-label="Filter by stage" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:flex-wrap md:px-0">
        <StageChip href="/challenges" active={!state} label="All stages" count={state ? undefined : items.length} />
        {STAGE_ORDER.filter((stage) => counts.has(stage) || stage === state).map((stage) => (
          <StageChip
            key={stage}
            href={"/challenges?state=" + stage}
            active={state === stage}
            label={CHALLENGE_STATE_LABELS[stage] ?? stage}
            count={counts.get(stage)}
          />
        ))}
      </nav>

      {items.length ? (
        <Panel
          flush
          title={state ? CHALLENGE_STATE_LABELS[state] ?? state : "All challenges"}
          description={state ? "Filtered to one stage. Clear the filter to see everything." : "Newest first. Open one for its record, measures and next step."}
        >
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Challenge</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Budget ceiling</TableHead>
                  <TableHead>Applications close</TableHead>
                  <TableHead className="w-10 pr-6" aria-label="Open" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((challenge) => (
                  <TableRow key={challenge.id} className="group relative">
                    <TableCell className="py-3.5 pl-6">
                      <Link href={"/challenges/" + challenge.id} className="flex flex-col gap-0.5 outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset">
                        <span className="text-sm font-medium text-foreground">{challenge.title || "Untitled draft"}</span>
                        <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                          <span className="font-mono">{challenge.reference}</span>
                          {challenge.sector && (
                            <>
                              <span aria-hidden>·</span>
                              {challenge.sector}
                            </>
                          )}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StateBadge state={challenge.state} labels={CHALLENGE_STATE_LABELS} />
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                      {challenge.budget_ceiling && challenge.budget_ceiling.paise > 0 ? compactRupees(challenge.budget_ceiling.paise) : <span className="font-normal text-muted-foreground">Not set</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Closes value={challenge.application_deadline} />
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <ArrowUpRight className="ml-auto size-4 text-glyph opacity-0 transition-[opacity,translate] duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="divide-y divide-border/70 md:hidden">
            {items.map((challenge) => (
              <li key={challenge.id}>
                <Link href={"/challenges/" + challenge.id} className="flex flex-col gap-2.5 px-5 py-4 active:bg-surface">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[15px] leading-snug font-medium text-foreground">{challenge.title || "Untitled draft"}</span>
                    <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">{challenge.reference}</span>
                  </div>
                  <StateBadge state={challenge.state} labels={CHALLENGE_STATE_LABELS} />
                  <div className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="font-medium tabular-nums">
                      {challenge.budget_ceiling && challenge.budget_ceiling.paise > 0 ? compactRupees(challenge.budget_ceiling.paise) : "Budget not set"}
                    </span>
                    <Closes value={challenge.application_deadline} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <EmptyState
          icon={FileStack}
          title={state ? "Nothing in this stage" : "No challenges yet"}
          description={state ? "No challenge is in this stage right now." : "Your department has not created a challenge yet. Describe a problem in plain words and the builder structures it."}
          action={
            canWrite ? (
              <LinkButton href="/challenges/new" variant="brand">
                <FilePlus2 />
                Write your first challenge
              </LinkButton>
            ) : state ? (
              <LinkButton href="/challenges">Show all stages</LinkButton>
            ) : null
          }
        />
      )}
    </Page>
  );
}

function StageChip({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-200 ease-ios outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
        active ? "bg-foreground text-background shadow-lift" : "bg-card text-muted-foreground shadow-card hover:bg-surface hover:text-foreground",
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-background/20" : "bg-surface")}>{count}</span>
      )}
    </Link>
  );
}

function Closes({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">Not set</span>;
  const relative = relativeDeadline(value);
  const overdue = relative.includes("overdue");
  return (
    <span className="flex flex-col text-[13px] leading-tight">
      <span className="text-foreground tabular-nums">{formatDate(value)}</span>
      <span className={cn("text-[12px]", overdue ? "text-muted-foreground" : "text-success-ink")}>{relative}</span>
    </span>
  );
}
