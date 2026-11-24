import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BadgeCheck, ClipboardList, EyeOff, Gauge, Lock, Scale, ShieldCheck } from "lucide-react";

import { EmptyState, Figure, FigureGrid, Page, PageHeader, Panel, SectionHeading, StateBadge, ToneBadge } from "@/components/app/kit";
import { apiGet } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, formatDate, relativeDeadline } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My panel work" };
export const dynamic = "force-dynamic";

type Assignment = {
  challenge_id: string;
  reference: string;
  title: string;
  state: string;
  role: string;
  evaluation_deadline: string | null;
  progress: { total: number; declared: number; scored: number; pending: number } | null;
};

const HOW = [
  { icon: EyeOff, title: "Blind first round", body: "Applicant name, founders and case-reference names are hidden. You score the proposal, not the reputation." },
  { icon: Gauge, title: "Anchored 1 to 5", body: "Score every criterion against its anchors, with a one-line justification the applicant eventually sees, anonymised." },
  { icon: Scale, title: "Split panels are flagged", body: "Where the panel differs by more than 1.5 points on a criterion, the justifications are read before the shortlist is confirmed." },
  { icon: Lock, title: "Scores lock", body: "When everyone has submitted, or at the deadline. Only the approver can reopen scoring, and the reopening is recorded." },
];

function ProgressRing({ scored, total }: { scored: number; total: number }) {
  const pct = total ? scored / total : 0;
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="size-14 shrink-0 -rotate-90" aria-hidden>
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" className="stroke-recess" />
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className={cn("transition-[stroke-dashoffset] duration-700 ease-out-soft", pct >= 1 ? "stroke-success" : "stroke-brand")}
      />
    </svg>
  );
}

export default async function EvaluationHomePage() {
  await requireSession("/evaluation");
  const body = await apiGet<{ items: Assignment[] }>("/evaluation/assignments");

  const evaluating = body.items.filter((item) => item.role === "EE");
  const validating = body.items.filter((item) => item.role === "IV");
  const pending = evaluating.reduce((sum, item) => sum + (item.progress?.pending ?? 0), 0);
  const scored = evaluating.reduce((sum, item) => sum + (item.progress?.scored ?? 0), 0);

  return (
    <Page>
      <PageHeader
        eyebrow={<span>{body.items.length + (body.items.length === 1 ? " assignment" : " assignments")}</span>}
        title="My panel work"
        description="Challenges you are assigned to. Round one scoring is blind: you do not see who the applicant is."
      />

      <FigureGrid columns={3}>
        <Figure label="Still to score" value={pending} icon={ClipboardList} tone={pending ? "brand" : "success"} hint={pending ? "Applications waiting on your score" : "Nothing waiting on you"} />
        <Figure label="Scored so far" value={scored} icon={BadgeCheck} tone="success" hint={`Across ${evaluating.length} challenge${evaluating.length === 1 ? "" : "s"}`} />
        <Figure label="Validation assignments" value={validating.length} icon={ShieldCheck} tone="info" hint="Pilots you verify as independent validator" />
      </FigureGrid>

      <SectionHeading title="Applications to score" description="Declare any conflict of interest before scoring. A declared conflict removes the application from your list." />
      {evaluating.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {evaluating.map((item) => {
            const progress = item.progress ?? { total: 0, declared: 0, scored: 0, pending: 0 };
            const overdue = relativeDeadline(item.evaluation_deadline).includes("overdue");
            return (
              <Link
                key={item.challenge_id}
                href={"/evaluation/" + item.challenge_id}
                className="group flex flex-col gap-5 rounded-3xl bg-card p-5 shadow-card outline-none transition-[translate,box-shadow] duration-200 ease-ios hover:-translate-y-0.5 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring md:p-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] text-muted-foreground">{item.reference}</span>
                      <StateBadge state={item.state} labels={CHALLENGE_STATE_LABELS} />
                    </div>
                    <h3 className="font-display text-[17px] leading-snug font-semibold tracking-tight text-balance">{item.title}</h3>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-glyph transition-transform duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <div className="mt-auto flex items-center gap-4">
                  <div className="relative grid place-items-center">
                    <ProgressRing scored={progress.scored} total={progress.total} />
                    <span className="absolute text-[12px] font-semibold tabular-nums">
                      {progress.scored}/{progress.total}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {progress.pending > 0 ? <ToneBadge tone="warning">{progress.pending} still to score</ToneBadge> : <ToneBadge tone="success">All scored</ToneBadge>}
                      {progress.declared > 0 && (
                        <ToneBadge tone="neutral" dot={false}>
                          {progress.declared} declared
                        </ToneBadge>
                      )}
                    </div>
                    <p className={cn("text-[13px]", overdue ? "font-medium text-destructive-ink" : "text-muted-foreground")}>
                      {item.evaluation_deadline
                        ? `Closes ${formatDate(item.evaluation_deadline)}, ${relativeDeadline(item.evaluation_deadline)}`
                        : "No deadline set"}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={ClipboardList} title="Nothing to score right now" description="When a department adds you to an evaluation panel, the challenge appears here." />
      )}

      <SectionHeading
        title="Pilots to validate"
        description="As independent validator you verify the data behind an Evidence Report, then sign it off, sign off with qualifications, or refuse."
      />
      {validating.length ? (
        <Panel flush>
          <ul className="divide-y divide-border/70">
            {validating.map((item) => (
              <li key={item.challenge_id}>
                <Link href="/validation" className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface/60 md:px-6">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-info/12 text-info-ink">
                    <ShieldCheck className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="font-mono text-[12px] text-muted-foreground">{item.reference}</p>
                  </div>
                  <StateBadge state={item.state} labels={CHALLENGE_STATE_LABELS} className="hidden sm:inline-flex" />
                  <span className="hidden text-[13px] font-medium text-foreground md:inline">Open the validation queue</span>
                  <ArrowUpRight className="size-4 shrink-0 text-glyph transition-transform duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <EmptyState icon={ShieldCheck} title="No validation assignments" description="You are not named as validator on any challenge right now." />
      )}

      <SectionHeading title="How scoring works" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {HOW.map((step, index) => (
          <div key={step.title} className="flex flex-col gap-3 rounded-3xl bg-surface/60 p-5">
            <div className="flex items-center justify-between">
              <span className="grid size-8 place-items-center rounded-full bg-card text-foreground shadow-lift">
                <step.icon className="size-4" />
              </span>
              <span className="font-mono text-[12px] text-muted-foreground">0{index + 1}</span>
            </div>
            <p className="font-display text-[15px] font-semibold tracking-tight">{step.title}</p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>
          </div>
        ))}
      </div>
    </Page>
  );
}
