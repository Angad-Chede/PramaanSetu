import type { Metadata } from "next";
import { EyeOff, Flag, Lock, ListOrdered, Trophy } from "lucide-react";

import { confirmShortlist, runWorkflowStep } from "@/app/challenges/actions";
import { SubmitButton } from "@/components/app/forms";
import { Callout, EmptyState, Flash, Page, PageHeader, Panel, SectionHeading, StateBadge, ToneBadge } from "@/components/app/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, compactRupees, decimal } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge, RankingRow } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ReviewNav, Split } from "../_review/shared";

export const metadata: Metadata = { title: "Scores and shortlist" };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SERIES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-5", "bg-chart-4", "bg-glyph"];
const SPLIT_THRESHOLD = 1.5;

function RankMark({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full font-display text-sm font-semibold tabular-nums",
        rank === 1 ? "bg-brand text-brand-foreground shadow-lift" : rank <= 3 ? "bg-foreground/90 text-background" : "bg-surface text-muted-foreground",
      )}
    >
      {rank}
    </span>
  );
}

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-recess" aria-hidden>
      <div className="h-full rounded-full bg-foreground/80" style={{ width: Math.max(0, Math.min(100, value)) + "%" }} />
    </div>
  );
}

function RankingRows({ items, selectable }: { items: RankingRow[]; selectable: boolean }) {
  return (
    <ul className="divide-y divide-border/70">
      {items.map((row) => {
        const split = row.disagreement > SPLIT_THRESHOLD;
        const checkboxId = "shortlist-" + row.application_id;
        const Wrapper = selectable ? "label" : "div";
        return (
          <li key={row.application_id}>
            <Wrapper
              {...(selectable ? { htmlFor: checkboxId } : {})}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-4 md:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:px-6",
                selectable && "cursor-pointer transition-colors duration-150 hover:bg-surface/60 has-[[data-state=checked]]:bg-brand/[0.04]",
              )}
            >
              <RankMark rank={row.rank} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{row.blind_label}</p>
                <p className="truncate font-mono text-[12px] text-muted-foreground">{row.reference}</p>
              </div>
              <div className="col-span-3 col-start-1 flex flex-col gap-1.5 md:col-span-1 md:col-start-auto">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-lg font-semibold tracking-tight tabular-nums">
                    {decimal(row.weighted_score, 1)}
                    <span className="ml-0.5 text-[12px] font-normal text-muted-foreground">/100</span>
                  </span>
                  <span className="text-[12px] text-muted-foreground tabular-nums">mean {decimal(row.mean_score, 2)}</span>
                </div>
                <ScoreBar value={row.weighted_score} />
              </div>
              <div className="col-span-3 col-start-1 flex flex-wrap items-center gap-1.5 md:col-span-1 md:col-start-auto">
                {split ? (
                  <ToneBadge tone="warning">Split, {decimal(row.disagreement, 1)} pts apart</ToneBadge>
                ) : (
                  <ToneBadge tone="success">Agreed within {decimal(row.disagreement, 1)}</ToneBadge>
                )}
                {row.complete ? (
                  <ToneBadge tone="neutral" dot={false}>
                    {row.evaluator_count} evaluators
                  </ToneBadge>
                ) : (
                  <ToneBadge tone="warning" dot={false}>
                    {row.evaluator_count} of the panel
                  </ToneBadge>
                )}
                <span className="text-[12px] text-muted-foreground tabular-nums">{compactRupees(row.pilot_cost_paise)}</span>
              </div>
              <div className="col-start-3 row-start-1 flex justify-end md:col-start-auto md:row-start-auto">
                {selectable ? (
                  <Checkbox
                    id={checkboxId}
                    name="application_ids"
                    value={row.application_id}
                    defaultChecked={row.rank === 1}
                    aria-label={"Shortlist " + row.blind_label}
                    className="size-5"
                  />
                ) : row.rank === 1 ? (
                  <Trophy className="size-4 text-brand" aria-label="Top ranked" />
                ) : (
                  <span className="size-4" />
                )}
              </div>
            </Wrapper>
          </li>
        );
      })}
    </ul>
  );
}

export default async function RankingPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession("/challenges/" + id + "/ranking");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + id);
  const ranking = await apiGetOrNotFound<{ items: RankingRow[]; blinded: boolean; flags: string[]; note: string }>("/challenges/" + id + "/ranking");

  const isOwner = session.department_id === challenge.department_id;
  const canLock = challenge.state === "Evaluation" && hasRole(session, "DO") && isOwner;
  const canShortlist = challenge.state === "Shortlisted" && hasRole(session, "DA") && isOwner;
  const complete = ranking.items.length > 0 && ranking.items.every((row) => row.complete);
  const flags = Array.from(new Set(ranking.flags));
  const flaggedCount = ranking.items.filter((row) => row.criteria.some((c) => c.flagged) || row.disagreement > SPLIT_THRESHOLD).length;
  const completeCount = ranking.items.filter((row) => row.complete).length;

  // one colour per criterion, shared by every applicant so the bars compare
  const criterionOrder: string[] = [];
  for (const row of ranking.items) for (const c of row.criteria) if (!criterionOrder.includes(c.criterion_id)) criterionOrder.push(c.criterion_id);
  const colorOf = (criterionId: string) => SERIES[criterionOrder.indexOf(criterionId) % SERIES.length];
  const legend = ranking.items[0]?.criteria ?? [];

  const rankingPanel = (
    <Panel
      title="Ranking"
      description={ranking.note}
      flush={ranking.items.length > 0}
      action={
        ranking.blinded ? (
          <ToneBadge tone="warning" dot={false}>
            <EyeOff />
            Identity hidden
          </ToneBadge>
        ) : undefined
      }
    >
      {ranking.items.length ? (
        <RankingRows items={ranking.items} selectable={canShortlist} />
      ) : (
        <EmptyState
          icon={ListOrdered}
          title="Nothing ranked yet"
          description="Screening must run and the panel must submit scores before a ranking appears."
          className="border-0 bg-surface/40"
        />
      )}
    </Panel>
  );

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/challenges/" + challenge.id, label: "Back to the challenge" }}
        eyebrow={
          <>
            <span className="font-mono text-[12px] tracking-tight">{challenge.reference}</span>
            <StateBadge state={challenge.state} labels={CHALLENGE_STATE_LABELS} />
          </>
        }
        title="Scores, flags and the shortlist"
        description="Weighted on a 0 to 100 scale from the published rubric. Where evaluators differ by more than 1.5 points on a criterion, the application is flagged so the written justifications are read before the shortlist is confirmed."
      />
      <ReviewNav challengeId={challenge.id} active="ranking" />
      <Flash searchParams={query} />

      <Split
        main={
          <>
            {canShortlist && ranking.items.length ? (
              <form action={confirmShortlist} className="flex flex-col gap-4">
                <input type="hidden" name="challenge_id" value={challenge.id} />
                {rankingPanel}
                <Callout title="What confirming does">
                  A pilot record is created for each selected application and the challenge moves to pilot design. Applicants are told their
                  result, and every applicant can see their own scores with anonymised comments.
                </Callout>
                <div>
                  <SubmitButton
                    variant="brand"
                    size="lg"
                    pendingLabel="Confirming"
                    confirmTitle="Confirm this shortlist?"
                    confirm="A pilot record is created for each selected application and every applicant is notified of their result."
                  >
                    Confirm the shortlist
                  </SubmitButton>
                </div>
              </form>
            ) : (
              rankingPanel
            )}

            {ranking.items.length > 0 && (
              <>
                <SectionHeading
                  title="Score detail by criterion"
                  description="Each bar is the weighted score split into what every criterion contributed. Spread is the gap between evaluators."
                />
                <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
                  {legend.map((criterion) => (
                    <li key={criterion.criterion_id} className="inline-flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-full", colorOf(criterion.criterion_id))} />
                      {criterion.name}
                      <span className="tabular-nums">({criterion.weight})</span>
                    </li>
                  ))}
                </ul>
                <div className="grid gap-4 xl:grid-cols-2">
                  {ranking.items.map((row) => (
                    <section key={row.application_id} className="flex flex-col gap-4 rounded-3xl bg-card p-5 shadow-card md:p-6">
                      <header className="flex items-center gap-3">
                        <RankMark rank={row.rank} />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">{row.blind_label}</h3>
                          <p className="font-mono text-[12px] text-muted-foreground">{row.reference}</p>
                        </div>
                        <span className="font-display text-2xl font-semibold tracking-tight tabular-nums">
                          {decimal(row.weighted_score, 1)}
                          <span className="ml-0.5 text-[12px] font-normal text-muted-foreground">/100</span>
                        </span>
                      </header>
                      <div
                        role="img"
                        aria-label={`Weighted score ${decimal(row.weighted_score, 1)} of 100, split by criterion`}
                        className="flex h-3 w-full gap-px overflow-hidden rounded-full bg-recess"
                      >
                        {row.criteria.map((criterion) => (
                          <span
                            key={criterion.criterion_id}
                            title={`${criterion.name}: ${decimal(criterion.contribution, 1)}`}
                            className={cn("h-full", colorOf(criterion.criterion_id))}
                            style={{ width: Math.max(0, criterion.contribution) + "%" }}
                          />
                        ))}
                      </div>
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                            <th className="pb-2 font-medium">Criterion</th>
                            <th className="pb-2 pl-3 text-right font-medium">Mean</th>
                            <th className="pb-2 pl-3 text-right font-medium">Spread</th>
                            <th className="pb-2 pl-3 text-right font-medium">Adds</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {row.criteria.map((criterion) => (
                            <tr key={criterion.criterion_id}>
                              <td className="py-2 pr-2">
                                <span className="flex items-center gap-2">
                                  <span className={cn("size-2 shrink-0 rounded-full", colorOf(criterion.criterion_id))} />
                                  <span className="min-w-0 text-foreground">{criterion.name}</span>
                                  {criterion.flagged && (
                                    <Flag className="size-3.5 shrink-0 text-warning" aria-label="Flagged: evaluators differ by more than 1.5 points" />
                                  )}
                                </span>
                              </td>
                              <td className="py-2 pl-3 text-right tabular-nums">{decimal(criterion.mean, 2)}</td>
                              <td className={cn("py-2 pl-3 text-right tabular-nums", criterion.spread > SPLIT_THRESHOLD ? "font-medium text-warning-ink" : "text-muted-foreground")}>
                                {decimal(criterion.spread, 1)}
                              </td>
                              <td className="py-2 pl-3 text-right font-medium tabular-nums">{decimal(criterion.contribution, 1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  ))}
                </div>
              </>
            )}
          </>
        }
        aside={
          <>
            {canLock && (
              <Panel title="Lock the scores" description="Locking stops further editing. Only the approver can reopen scoring, and the reopening is recorded with a reason.">
                <div className="flex flex-col gap-3">
                  {!complete && (
                    <Callout tone="warning">
                      Not every evaluator has submitted. You can still lock at the deadline, and the incomplete sheets are recorded as incomplete.
                    </Callout>
                  )}
                  <form action={runWorkflowStep}>
                    <input type="hidden" name="challenge_id" value={challenge.id} />
                    <input type="hidden" name="action" value="lock-scores" />
                    <input type="hidden" name="back" value={"/challenges/" + challenge.id + "/ranking"} />
                    <SubmitButton
                      className="w-full"
                      pendingLabel="Locking"
                      confirmTitle="Lock the scores?"
                      confirm="Lock the scores for this challenge? Evaluators will no longer be able to edit them."
                    >
                      <Lock />
                      Lock the scores
                    </SubmitButton>
                  </form>
                </div>
              </Panel>
            )}

            <Panel title="Panel summary">
              <dl className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <dt className="text-[12px] text-muted-foreground">Ranked</dt>
                  <dd className="font-display text-2xl font-semibold tabular-nums">{ranking.items.length}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-[12px] text-muted-foreground">Complete</dt>
                  <dd className="font-display text-2xl font-semibold tabular-nums">{completeCount}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-[12px] text-muted-foreground">Flagged</dt>
                  <dd className={cn("font-display text-2xl font-semibold tabular-nums", flaggedCount > 0 && "text-warning-ink")}>{flaggedCount}</dd>
                </div>
              </dl>
            </Panel>

            {flags.length > 0 ? (
              <Panel title="Flags raised by the panel" description="Read the written justifications before confirming.">
                <ul className="flex flex-col gap-2.5">
                  {flags.map((flag) => (
                    <li key={flag} className="flex gap-2.5 text-[13px] leading-relaxed text-foreground/90">
                      <Flag className="mt-0.5 size-3.5 shrink-0 text-warning" />
                      {flag}
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : (
              ranking.items.length > 0 && <Callout tone="success" title="No flags">Evaluators agreed within 1.5 points on every criterion.</Callout>
            )}
          </>
        }
      />
    </Page>
  );
}
