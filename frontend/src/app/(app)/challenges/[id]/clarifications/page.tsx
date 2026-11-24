import type { Metadata } from "next";
import { CalendarClock, EyeOff, MessageCircleQuestion, MessagesSquare, Send } from "lucide-react";

import { answerClarification } from "@/app/challenges/actions";
import { SubmitButton, TextAreaField } from "@/components/app/forms";
import { EmptyState, Figure, Flash, Page, PageHeader, Panel, ToneBadge } from "@/components/app/kit";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { formatDateTime, relativeDeadline } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge, Clarification } from "@/lib/types";

export const metadata: Metadata = { title: "Questions and answers" };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClarificationsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession("/challenges/" + id + "/clarifications");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + id);
  const body = await apiGet<{ items: Clarification[]; cutoff: string | null; note: string }>("/challenges/" + id + "/clarifications");

  const canAnswer = hasRole(session, "DO", "DA") && session.department_id === challenge.department_id;
  const unanswered = body.items.filter((item) => !item.answer);
  const answered = body.items.filter((item) => item.answer);
  const cutoffPassed = body.cutoff ? relativeDeadline(body.cutoff).includes("overdue") : false;

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/challenges/" + challenge.id, label: "Back to the challenge" }}
        eyebrow={
          <>
            <span className="font-mono text-foreground/80">{challenge.reference}</span>
            <span className="truncate">{challenge.title}</span>
          </>
        }
        title="Questions and answers"
        description={body.note}
      />

      <Flash searchParams={query} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {canAnswer && (
            <Panel
              title="Waiting for an answer"
              description="Answers go to every applicant at once, and the asker is never named."
              action={unanswered.length > 0 ? <ToneBadge tone="warning">{unanswered.length} open</ToneBadge> : undefined}
            >
              {unanswered.length ? (
                <ul className="flex flex-col gap-4">
                  {unanswered.map((item) => (
                    <li key={item.id} className="flex flex-col gap-4 rounded-2xl bg-surface/60 p-4 ring-1 ring-border/60 md:p-5">
                      <div className="flex gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-warning/14 text-warning-ink">
                          <MessageCircleQuestion className="size-4" />
                        </span>
                        <p className="pt-1 text-[15px] leading-relaxed font-medium text-pretty text-foreground">{item.question}</p>
                      </div>
                      <form action={answerClarification} className="flex flex-col gap-3">
                        <input type="hidden" name="challenge_id" value={challenge.id} />
                        <input type="hidden" name="clarification_id" value={item.id} />
                        <TextAreaField label="Your answer" id={"answer_" + item.id} name="answer" rows={4} required minLength={5} />
                        <div className="flex justify-end">
                          <SubmitButton
                            variant="brand"
                            pendingLabel="Publishing"
                            confirmTitle="Publish this answer?"
                            confirm="It goes to every applicant at once and cannot be withdrawn."
                            confirmLabel="Publish"
                          >
                            <Send />
                            Publish the answer
                          </SubmitButton>
                        </div>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-2xl bg-surface/60 px-4 py-6 text-center text-sm text-muted-foreground">No unanswered questions. New ones appear here as applicants ask.</p>
              )}
            </Panel>
          )}

          {answered.length ? (
            <Panel title="Published answers" description="Visible to every applicant on the challenge board.">
              <ol className="flex flex-col">
                {answered.map((item, index) => (
                  <li key={item.id} className="grid gap-3 border-t border-border/70 py-5 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[3rem_minmax(0,1fr)]">
                    <span className="font-display text-2xl font-semibold tracking-tight text-muted-foreground/60 tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                    <div className="flex min-w-0 flex-col gap-3">
                      <p className="text-[15px] leading-relaxed font-medium text-pretty text-foreground">{item.question}</p>
                      <div className="rounded-2xl bg-surface/70 px-4 py-3.5">
                        <p className="text-sm leading-relaxed text-pretty whitespace-pre-line text-foreground/85">{item.answer}</p>
                        {item.published_at && <p className="mt-2 text-[12px] text-muted-foreground">Published {formatDateTime(item.published_at)}</p>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : (
            <EmptyState icon={MessagesSquare} title="No answers published yet" description="Once an answer is published it appears here and on the challenge board for every applicant." />
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Figure
            label="Questions close"
            icon={CalendarClock}
            tone={body.cutoff && !cutoffPassed ? "success" : "neutral"}
            value={body.cutoff ? (cutoffPassed ? "Closed" : relativeDeadline(body.cutoff).replace(/^due /, "")) : "Not set"}
            hint={body.cutoff ? formatDateTime(body.cutoff) : "No cutoff was set in the builder"}
          />
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Answered" value={answered.length} />
            <Figure label="Open" value={unanswered.length} tone={unanswered.length ? "warning" : "neutral"} />
          </div>
          <div className="flex gap-3 rounded-3xl bg-surface/70 p-5 text-[13px] leading-relaxed text-muted-foreground">
            <EyeOff className="mt-0.5 size-4 shrink-0 text-glyph" />
            Every applicant sees the same answers at the same time, so no one gains from asking privately.
          </div>
        </aside>
      </div>
    </Page>
  );
}
