import type { Metadata } from "next";
import { ArrowRight, Award, Building2, ClipboardList, FilePen, ShieldCheck } from "lucide-react";

import { EmptyState, Figure, FigureGrid, LinkButton, Page, PageHeader, Panel, RowLink, RowList, StateBadge, ToneBadge } from "@/components/app/kit";
import { apiGet } from "@/lib/api";
import { APPLICATION_STATE_LABELS, formatDate, money } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

import { ApplicationProgress, OUTCOME_TONE } from "./_components/progress";

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

export default async function MyApplicationsPage() {
  const session = await requireSession("/my-applications");
  if (!session.startup_id) {
    return (
      <Page>
        <PageHeader title="My applications" />
        <EmptyState
          icon={Building2}
          title="No startup profile is linked to your account"
          description="Ask the platform administrator to link your account to a startup, or register one."
          action={<LinkButton href="/startup">Open the startup profile page</LinkButton>}
        />
      </Page>
    );
  }

  const body = await apiGet<{ items: Row[] }>("/startups/" + session.startup_id + "/applications");
  const items = body.items;
  const open = items.filter((row) => row.state === "Draft" || row.state === "Submitted").length;
  const eligible = items.filter((row) => row.eligibility_outcome === "Eligible").length;
  const shortlisted = items.filter((row) => row.state === "Shortlisted").length;

  return (
    <Page>
      <PageHeader
        title="My applications"
        description="Every application you have started, its eligibility result and its outcome. You can edit until the deadline; the last submitted version is the one that counts."
        meta={<span>{items.length} application{items.length === 1 ? "" : "s"}</span>}
        actions={
          <LinkButton href="/challenges-board" variant="default">
            Find another challenge
            <ArrowRight />
          </LinkButton>
        }
      />

      {items.length > 0 && (
        <FigureGrid columns={4}>
          <Figure label="Applications" value={items.length} hint="Started on this platform" icon={ClipboardList} />
          <Figure label="Still editable" value={open} hint="Drafts and submitted, before the deadline" icon={FilePen} tone={open ? "brand" : "neutral"} />
          <Figure label="Screened eligible" value={eligible} hint="Passed every blocking rule" icon={ShieldCheck} tone={eligible ? "success" : "neutral"} />
          <Figure label="Shortlisted" value={shortlisted} hint="Moving to pilot design" icon={Award} tone={shortlisted ? "success" : "neutral"} />
        </FigureGrid>
      )}

      {items.length ? (
        <Panel title="All applications" description="Newest first. Open one to see its eligibility reasons, your result and your proposal." flush>
          <div className="hidden grid-cols-[minmax(0,1fr)_10rem_9rem_8rem_2rem] gap-4 border-y border-border/70 bg-surface/40 px-6 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:grid">
            <span>Challenge</span>
            <span>Progress</span>
            <span className="text-right">Pilot cost</span>
            <span className="text-right">Submitted</span>
            <span />
          </div>
          <RowList>
            {items.map((row) => (
              <li key={row.id}>
                <RowLink href={"/my-applications/" + row.id} className="md:grid md:grid-cols-[minmax(0,1fr)_10rem_9rem_8rem_2rem] md:gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="font-medium text-pretty text-foreground">{row.challenge_title ?? "Challenge"}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{row.reference}</span>
                      <StateBadge state={row.state} labels={APPLICATION_STATE_LABELS} />
                      {row.eligibility_outcome ? (
                        <ToneBadge tone={OUTCOME_TONE[row.eligibility_outcome] ?? "neutral"}>
                          {row.eligibility_outcome === "NeedsReview" ? "Eligibility needs review" : row.eligibility_outcome}
                        </ToneBadge>
                      ) : (
                        <ToneBadge dot={false}>Not screened yet</ToneBadge>
                      )}
                    </div>
                    <div className="flex gap-4 text-[13px] text-muted-foreground md:hidden">
                      <span className="tabular-nums">{row.pilot_cost ? money(row.pilot_cost) : "Not quoted"}</span>
                      <span>{row.submitted_at ? "Submitted " + formatDate(row.submitted_at) : "Not submitted"}</span>
                    </div>
                  </div>
                  <div className="hidden md:block">
                    <ApplicationProgress state={row.state} />
                  </div>
                  <span className={cn("hidden text-right text-[13px] tabular-nums md:block", row.pilot_cost ? "text-foreground" : "text-muted-foreground")}>
                    {row.pilot_cost ? money(row.pilot_cost) : "Not quoted"}
                  </span>
                  <span className="hidden text-right text-[13px] text-muted-foreground md:block">{row.submitted_at ? formatDate(row.submitted_at) : "Not submitted"}</span>
                </RowLink>
              </li>
            ))}
          </RowList>
        </Panel>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="You have not applied to any challenge yet"
          description="Open challenges list their measures, budget and deadline. Your saved profile fills most of the form."
          action={
            <LinkButton href="/challenges-board" variant="brand">
              Browse open challenges
            </LinkButton>
          }
        />
      )}
    </Page>
  );
}
