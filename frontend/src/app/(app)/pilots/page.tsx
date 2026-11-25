import type { Metadata } from "next";
import { AlertTriangle, FlaskConical, IndianRupee, Lock, Wallet } from "lucide-react";

import {
  EmptyState,
  Figure,
  FigureGrid,
  Flash,
  Meter,
  Page,
  PageHeader,
  Panel,
  RowLink,
  RowList,
  StateBadge,
  ToneBadge,
} from "@/components/app/kit";
import { all, apiGet } from "@/lib/api";
import { PILOT_STATE_LABELS, compactRupees, formatDate, money } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import type { Pilot } from "@/lib/types";

export const metadata: Metadata = { title: "Pilots" };
export const dynamic = "force-dynamic";

type PilotRow = Pilot & {
  design_frozen: boolean;
  milestone_count: number;
  paid_value: { paise: number; display: string } | null;
  overdue_milestones: number;
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PilotsPage({ searchParams }: Props) {
  const params = await searchParams;
  const [session, body] = await all(requireSession("/pilots"), apiGet<{ items: PilotRow[]; count: number }>("/pilots?limit=100"));
  const startup = hasRole(session, "SU") && !hasRole(session, "DO", "DA", "FO", "PA");

  const pilots = body.items;
  const breaches = pilots.reduce((sum, pilot) => sum + pilot.overdue_milestones, 0);
  const running = pilots.filter((pilot) => pilot.state === "Active" || pilot.state === "Paused").length;
  const frozen = pilots.filter((pilot) => pilot.design_frozen).length;
  const totalPaise = pilots.reduce((sum, pilot) => sum + (pilot.total_value?.paise ?? 0), 0);
  const paidPaise = pilots.reduce((sum, pilot) => sum + (pilot.paid_value?.paise ?? 0), 0);
  const paidShare = totalPaise ? Math.round((paidPaise / totalPaise) * 100) : 0;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <span>{startup ? "Startup" : "Department"}</span>
            <span className="text-border">/</span>
            <span>
              {body.count} pilot{body.count === 1 ? "" : "s"}
            </span>
          </>
        }
        title="Pilots"
        description={`Every pilot ${startup ? "your startup is running for a department" : "your department is running"}, the state it is in, and whether its plan was pre-registered before the first measurement came in.`}
        meta={
          breaches ? (
            <ToneBadge tone="destructive">
              {breaches} milestone{breaches === 1 ? "" : "s"} past their service level
            </ToneBadge>
          ) : null
        }
      />

      <Flash searchParams={params} />

      <FigureGrid>
        <Figure label="Running now" value={running} icon={FlaskConical} tone="info" hint={`${pilots.length - running} not running or finished`} />
        <Figure
          label="Plans pre-registered"
          value={
            <span>
              {frozen}
              <span className="text-lg text-muted-foreground"> of {pilots.length}</span>
            </span>
          }
          icon={Lock}
          tone={frozen === pilots.length ? "success" : "warning"}
          hint="Frozen before any data was collected"
        />
        <Figure label="Contract value" value={compactRupees(totalPaise)} icon={IndianRupee} tone="neutral" hint="Across every agreement in force" />
        <Figure
          label="Paid to startups"
          value={compactRupees(paidPaise)}
          icon={Wallet}
          tone="brand"
          hint={
            <div className="flex flex-col gap-2">
              <Meter value={paidShare} tone="brand" label="Share of contract value paid" />
              <span>{paidShare} percent of contract value released</span>
            </div>
          }
        />
      </FigureGrid>

      <Panel title="All pilots" description="Open a pilot for its plan, agreement, measurements and payments." flush>
        {pilots.length ? (
          <RowList className="border-t border-border/70">
            {pilots.map((pilot) => {
              const paid = pilot.paid_value?.paise ?? 0;
              const total = pilot.total_value?.paise ?? 0;
              const share = total ? Math.round((paid / total) * 100) : 0;
              return (
                <li key={pilot.id}>
                  <RowLink href={"/pilots/" + pilot.id} className="flex-wrap items-start md:flex-nowrap md:items-center">
                    <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-surface text-glyph shadow-lift">
                      <FlaskConical className="size-4" />
                    </span>
                    <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] text-muted-foreground">{pilot.reference}</span>
                        <StateBadge state={pilot.state} labels={PILOT_STATE_LABELS} />
                        {pilot.design_frozen ? (
                          <ToneBadge tone="success" dot={false}>
                            <Lock className="size-3" />
                            Pre-registered
                          </ToneBadge>
                        ) : (
                          <ToneBadge tone="warning">Plan not frozen</ToneBadge>
                        )}
                        {pilot.overdue_milestones ? (
                          <ToneBadge tone="destructive" dot={false}>
                            <AlertTriangle className="size-3" />
                            {pilot.overdue_milestones} overdue
                          </ToneBadge>
                        ) : null}
                      </div>
                      <p className="truncate font-display text-[15px] font-semibold tracking-tight text-foreground">
                        {pilot.challenge_title ?? "Pilot"}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {pilot.startup_name}
                        {pilot.started_at ? <> · Started {formatDate(pilot.started_at)}</> : null}
                      </p>
                    </div>
                    <div className="flex w-full flex-col gap-2 md:w-56 md:shrink-0">
                      <div className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="text-muted-foreground">Paid</span>
                        <span className="tabular-nums text-foreground">
                          {pilot.paid_value ? money(pilot.paid_value) : "None"}
                        </span>
                      </div>
                      <Meter value={share} tone={share >= 100 ? "success" : "brand"} label="Share paid" />
                      <div className="flex items-baseline justify-between gap-3 text-[12px] text-muted-foreground">
                        <span>{pilot.milestone_count} milestones</span>
                        <span className="tabular-nums">of {pilot.total_value ? money(pilot.total_value) : "value not set"}</span>
                      </div>
                    </div>
                  </RowLink>
                </li>
              );
            })}
          </RowList>
        ) : (
          <div className="px-5 pb-5 md:px-6 md:pb-6">
            <EmptyState
              icon={FlaskConical}
              title="No pilots yet"
              description="A pilot record is created when an approver confirms a shortlist. It will appear here with its plan, agreement and payments."
            />
          </div>
        )}
      </Panel>
    </Page>
  );
}
