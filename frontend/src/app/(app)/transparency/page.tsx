import type { Metadata } from "next";
import { BadgeCheck, CalendarClock, Database, FileBarChart2, FileStack, FlaskConical, Gavel, IndianRupee, Lock, Rocket, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState, Figure, Page, PageHeader, Panel, SectionHeading } from "@/components/app/kit";
import { FunnelChart } from "@/components/ui/funnel-chart";
import { Gauge } from "@/components/ui/gauge";
import { apiGet } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Transparency" };
export const dynamic = "force-dynamic";

type Transparency = {
  challenges_published: number;
  challenges_by_stage: Record<string, number>;
  pilots_run: number;
  validated_passports: number;
  evidence_reports: number;
  average_confidence_score: number;
  registered_startups: number;
  average_days_submission_to_payment: number | null;
  note: string;
  generated_at: string;
};

/** each stage of the lifecycle, grouped into the phase it belongs to */
const PHASES: { name: string; color: string; stages: string[] }[] = [
  { name: "Drafting", color: "var(--glyph)", stages: ["Draft", "InReview"] },
  { name: "Open", color: "var(--brand)", stages: ["Published", "ApplicationsClosed"] },
  { name: "Selection", color: "var(--info)", stages: ["Screening", "Evaluation", "Shortlisted"] },
  { name: "Piloting", color: "var(--chart-4)", stages: ["PilotDesign", "PilotActive", "Validation", "DecisionPending"] },
  { name: "Scaled", color: "var(--success)", stages: ["Scaled"] },
  { name: "Ended", color: "var(--destructive)", stages: ["Closed", "Cancelled"] },
];

const MEANINGS = [
  {
    icon: Lock,
    title: "Plans are frozen first",
    body: "A pilot only produces an Evidence Report if it had a plan frozen before data collection began. A report only carries a score once an independent validator has signed it off.",
  },
  {
    icon: Gavel,
    title: "Scale rests on evidence",
    body: "A scale decision cannot be recorded without a signed-off report, so every scale decision on this platform rests on measured, verified evidence.",
  },
  {
    icon: CalendarClock,
    title: "Payment days are calendar days",
    body: "The payment figure counts calendar days from a startup submitting milestone evidence to the finance office recording the release, including any time spent resubmitting.",
  },
  {
    icon: Database,
    title: "No personal data",
    body: "Figures contain no personal data and are recomputed from the platform's own records.",
  },
];

export default async function TransparencyPage() {
  const data = await apiGet<Transparency>("/public/transparency");

  const stageOrder = Object.keys(CHALLENGE_STATE_LABELS);
  const stages = Object.entries(data.challenges_by_stage).sort(
    ([a], [b]) => (stageOrder.indexOf(a) === -1 ? 99 : stageOrder.indexOf(a)) - (stageOrder.indexOf(b) === -1 ? 99 : stageOrder.indexOf(b)),
  );
  const totalChallenges = stages.reduce((sum, [, count]) => sum + count, 0);
  const colorOf = (stage: string) => PHASES.find((phase) => phase.stages.includes(stage))?.color ?? "var(--glyph)";
  const phaseOf = (stage: string) => PHASES.find((phase) => phase.stages.includes(stage))?.name ?? "Other";

  const score = data.average_confidence_score;
  const days = data.average_days_submission_to_payment;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck className="size-3.5 text-success" />
            Open figures
          </>
        }
        title="Transparency"
        description={data.note}
        meta={<span className="tabular-nums">Generated {formatDateTime(data.generated_at)}</span>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className="relative flex flex-col items-center gap-4 overflow-hidden rounded-3xl bg-[#0e0e10] p-6 text-white ring-white/10 dark:bg-card dark:ring-1">
          <div aria-hidden className="pointer-events-none absolute -top-28 left-1/2 size-80 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(52,199,89,0.25),transparent)]" />
          <div className="relative flex w-full items-center justify-between gap-3">
            <h2 className="font-display text-[15px] font-semibold tracking-tight">Average Evidence Confidence Score</h2>
          </div>
          {score ? (
            <Gauge
              value={score}
              decimals={1}
              max={100}
              size={220}
              thickness={14}
              label="of 100"
              className="relative [--foreground:#f5f5f7] [--muted-foreground:rgba(255,255,255,0.55)] [--recess:rgba(255,255,255,0.1)]"
              thresholds={[
                { upTo: 60, tone: "destructive", label: "Weak" },
                { upTo: 80, tone: "warning", label: "Moderate" },
                { upTo: 100, tone: "success", label: "Strong" },
              ]}
            />
          ) : (
            <p className="relative py-10 text-center font-display text-2xl font-semibold tracking-tight text-white/80">Not yet measured</p>
          )}
          <p className="relative mt-auto text-center text-[13px] leading-relaxed text-white/55">
            Across {data.evidence_reports} Evidence Report{data.evidence_reports === 1 ? "" : "s"}, each signed off by an independent validator.
          </p>
        </section>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Figure label="Challenges published" value={data.challenges_published} icon={FileStack} tone="brand" />
          <Figure label="Pilots run" value={data.pilots_run} icon={FlaskConical} tone="info" />
          <Figure label="Evidence Reports" value={data.evidence_reports} icon={FileBarChart2} tone="neutral" hint="Produced from frozen plans" />
          <Figure label="Validated passports" value={data.validated_passports} icon={BadgeCheck} tone="success" hint="Independently signed off" />
          <Figure label="Startups registered" value={data.registered_startups.toLocaleString("en-IN")} icon={Rocket} tone="neutral" />
          <Figure
            label="Days to payment"
            value={
              days === null ? (
                <span className="text-lg text-muted-foreground">Not yet measured</span>
              ) : (
                <>
                  {days}
                  <span className="ml-1 text-base font-medium text-muted-foreground">days</span>
                </>
              )
            }
            icon={IndianRupee}
            tone="warning"
            hint="Average, milestone submission to release"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="From challenge to proof" description="How many challenges made it through each gate. Nothing advances on a vendor's word.">
          <FunnelChart
            stages={[
              { label: "Challenges published", value: data.challenges_published },
              { label: "Pilots run", value: data.pilots_run },
              { label: "Evidence Reports", value: data.evidence_reports },
              { label: "Validated passports", value: data.validated_passports },
            ]}
            color="var(--brand)"
          />
          {data.challenges_published > 0 && (
            <p className="mt-6 rounded-2xl bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {data.validated_passports} of {data.challenges_published}
              </span>{" "}
              published challenges {data.validated_passports === 1 ? "has" : "have"} produced independently validated evidence so far.
            </p>
          )}
        </Panel>

        <Panel title="Challenges by stage" description="Every challenge on the platform, counted by the stage it is in. A challenge cannot skip a stage.">
          {totalChallenges ? (
            <div className="flex flex-col gap-5">
              <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Share of challenges in each stage">
                {stages.map(([stage, count]) => (
                  <span key={stage} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: (count / totalChallenges) * 100 + "%", background: colorOf(stage) }} />
                ))}
              </div>
              <ul className="flex flex-col">
                {stages.map(([stage, count]) => (
                  <li key={stage} className="flex items-center gap-3 border-b border-border/60 py-2.5 text-sm last:border-0">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(stage) }} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{CHALLENGE_STATE_LABELS[stage] ?? stage}</span>
                    <span className="hidden text-[12px] text-muted-foreground sm:inline">{phaseOf(stage)}</span>
                    <span className={cn("w-8 text-right font-medium tabular-nums")}>{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState icon={FileStack} title="No challenges yet" className="border-0 bg-transparent py-6" />
          )}
        </Panel>
      </div>

      <SectionHeading title="What these figures mean" description="The rules behind every number on this page." />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {MEANINGS.map((item) => (
          <li key={item.title} className="flex flex-col gap-3 rounded-3xl bg-card p-5 shadow-card">
            <span className="grid size-9 place-items-center rounded-full bg-surface text-glyph">
              <item.icon className="size-4" />
            </span>
            <h3 className="font-display text-[15px] font-semibold tracking-tight">{item.title}</h3>
            <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{item.body}</p>
          </li>
        ))}
      </ul>
    </Page>
  );
}
