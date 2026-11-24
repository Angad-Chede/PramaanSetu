import type { Metadata } from "next";
import Link from "next/link";
import { Check, Download, Quote, ShieldAlert, TriangleAlert, Undo2 } from "lucide-react";

import { decideChallenge } from "@/app/challenges/actions";
import { SubmitButton, TextAreaField } from "@/components/app/forms";
import { Callout, Deadline, Flash, KeyValues, Page, PageHeader, Panel, StateBadge } from "@/components/app/kit";
import { Button } from "@/components/ui/button";
import { apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, IP_OPTION_LABELS, money } from "@/lib/format";
import { requireSession } from "@/lib/session";
import type { Challenge } from "@/lib/types";

import { MeasuresList, RubricView } from "../../_components/measures";

export const metadata: Metadata = { title: "Review for approval" };
export const dynamic = "force-dynamic";

const CHECKS = [
  "The outcome states a direction of change in a named measure. If it says improve or optimise with nothing behind it, return it.",
  "Each measure has a method a validator could reproduce from the source records. Without one, the Evidence Report will not be defensible.",
  "A budget ceiling is published, so startups can size proposals and screening can check cost against it.",
  "No product or supplier is named anywhere. The challenge asks for an outcome.",
];

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReviewPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession("/challenges/" + id + "/review");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + id);

  const isOwnDraft = challenge.created_by === session.id;
  const decidable = challenge.state === "InReview" && !isOwnDraft;
  const flags = challenge.quality_flags ?? [];

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/challenges/" + challenge.id, label: "Challenge record" }}
        eyebrow={
          <>
            <span className="font-mono text-foreground/80">{challenge.reference}</span>
            <StateBadge state={challenge.state} labels={CHALLENGE_STATE_LABELS} />
          </>
        }
        title="Approve or return"
        description="One page, one decision. Read the outcome, the measures and the commercial terms, then approve for publication or return with comments."
        actions={
          <Button asChild variant="secondary">
            <a href={"/api/v1/challenges/" + challenge.id + "/summary.pdf"}>
              <Download />
              Download as PDF
            </a>
          </Button>
        }
      />

      <Flash searchParams={query} />

      {isOwnDraft && (
        <Callout tone="warning" icon={ShieldAlert} title="You drafted this challenge">
          Separation of duties: the officer who drafts a challenge cannot approve it. Ask another approver in your department to review it.
        </Callout>
      )}

      {challenge.state !== "InReview" && (
        <Callout
          title="No decision is pending"
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href={"/challenges/" + challenge.id}>Open the record</Link>
            </Button>
          }
        >
          This challenge is {(CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state).toLowerCase()}.
        </Callout>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="relative overflow-hidden rounded-3xl bg-card p-6 shadow-card md:p-8">
            <Quote aria-hidden className="absolute top-6 right-6 size-16 text-brand/10" />
            <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">The outcome being bought</p>
            <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-balance md:text-2xl">{challenge.title || "Untitled challenge"}</h2>
            <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-pretty whitespace-pre-line text-foreground/85">
              {challenge.outcome_statement || "No outcome statement was written."}
            </p>
            <div className="mt-6 border-t border-border/70 pt-6">
              <KeyValues
                columns={3}
                items={[
                  { label: "Department", value: challenge.department_name ?? "Not recorded" },
                  { label: "Sector", value: challenge.sector ?? "Open to all sectors" },
                  { label: "Budget ceiling", value: <span className="font-medium tabular-nums">{challenge.budget_ceiling ? money(challenge.budget_ceiling) : "Not published"}</span> },
                  { label: "Pilot length", value: challenge.pilot_duration_weeks + " weeks" },
                  { label: "Applications close", value: <Deadline value={challenge.application_deadline} label="Closes" /> },
                  { label: "Intellectual property", value: IP_OPTION_LABELS[challenge.ip_option ?? ""] ?? "Not selected" },
                ]}
              />
            </div>
          </section>

          <Panel title="What will be measured" description="A pilot can only be judged against measures that carry a unit, a method, a baseline and a target.">
            <MeasuresList kpis={challenge.kpis ?? []} />
          </Panel>

          <Panel
            title="How applications will be judged"
            description="Round one is blind to the applicant. Every score needs a written justification, and any criterion where evaluators differ by more than 1.5 points is flagged before the shortlist is confirmed."
          >
            <RubricView criteria={challenge.criteria ?? []} />
          </Panel>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-20">
          {decidable && (
            <section className="flex flex-col gap-4 rounded-3xl bg-card p-5 shadow-float ring-1 ring-brand/20 md:p-6">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">Your decision</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  Approving publishes the challenge, opens applications and notifies matched startups. Returning sends it back to the officer with your comments.
                </p>
              </div>
              <form action={decideChallenge} className="flex flex-col gap-4">
                <input type="hidden" name="challenge_id" value={challenge.id} />
                <TextAreaField label="Comments" name="reason" rows={4} hint="Required when you return it. Say what must change." />
                <div className="flex flex-col gap-2">
                  <SubmitButton
                    name="action"
                    value="approve"
                    variant="brand"
                    size="lg"
                    className="w-full"
                    pendingLabel="Publishing"
                    confirmTitle="Approve and publish?"
                    confirm="Applications open immediately and matched startups are notified."
                    confirmLabel="Approve and publish"
                  >
                    <Check />
                    Approve and publish
                  </SubmitButton>
                  <SubmitButton name="action" value="return" variant="secondary" className="w-full" pendingLabel="Returning">
                    <Undo2 />
                    Return with comments
                  </SubmitButton>
                </div>
              </form>
            </section>
          )}

          {flags.length > 0 && (
            <section className="flex flex-col gap-3 rounded-3xl bg-warning/10 p-5">
              <div>
                <h2 className="font-display text-[15px] font-semibold tracking-tight">
                  {flags.length} quality {flags.length === 1 ? "check" : "checks"} raised at submission
                </h2>
                <p className="text-[13px] text-muted-foreground">Advisory. The officer submitted with these open.</p>
              </div>
              <ul className="flex flex-col gap-2.5">
                {flags.map((flag) => (
                  <li key={flag.code + flag.field} className="flex gap-2 text-[13px] leading-snug">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    {flag.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Panel title="Before you approve">
            <ol className="flex flex-col gap-3.5">
              {CHECKS.map((check, index) => (
                <li key={index} className="flex gap-3 text-[13px] leading-relaxed text-muted-foreground">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-semibold text-foreground tabular-nums">{index + 1}</span>
                  {check}
                </li>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>
    </Page>
  );
}
