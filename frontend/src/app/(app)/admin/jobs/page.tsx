import type { Metadata } from "next";
import { Archive, CheckCircle2, Dice5, Inbox, Play, RefreshCw, Repeat2, Skull, Timer } from "lucide-react";

import { retryDeadLetter, runSchedulerNow } from "@/app/actions";
import { SubmitButton } from "@/components/app/forms";
import { Figure, FigureGrid, Flash, Meter, Page, PageHeader, Panel, ToneBadge } from "@/components/app/kit";
import { formatDateTime } from "@/lib/format";
import { all, apiGet } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Background jobs" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

type Overview = {
  queue_depth: Record<string, number>;
  dead_letters: {
    id: string;
    type: string;
    queue: string;
    status: string;
    attempts: number;
    error: string | null;
    created_at: string;
  }[];
};

const TIME_LIMIT: Record<string, number> = { critical: 30, default: 60, ai: 60, compute: 120, docs: 60 };

const PURPOSE: Record<string, string> = {
  critical: "Outbox relay and service level escalations",
  default: "Screening, notifications and maintenance",
  ai: "Drafting, embeddings and matching",
  compute: "Simulations and evidence analysis",
  docs: "Document rendering",
};

const PRINCIPLES = [
  {
    icon: Archive,
    title: "Events commit with the change",
    body: "Side effects never run from request code. A change writes an event in the same transaction and a relay turns committed events into jobs, so an event exists if and only if the change committed.",
  },
  {
    icon: Repeat2,
    title: "Retries only for transient errors",
    body: "Exponential backoff with jitter. A validation error fails at once rather than being retried five times.",
  },
  {
    icon: Timer,
    title: "Hard time limits",
    body: "Each queue has a time limit, so a stuck task cannot hold a worker slot for ever.",
  },
  {
    icon: Dice5,
    title: "Seeded computation",
    body: "Simulations and evidence analysis take an explicit random seed, stored with the run, so a redelivered task produces the same numbers.",
  },
];

export default async function JobsPage({ searchParams }: Props) {
  const params = await searchParams;
  const [, overview] = await all(requireSession("/admin/jobs"), apiGet<Overview>("/admin/jobs"));

  const queues = Object.entries(overview.queue_depth);
  const waiting = queues.reduce((sum, [, count]) => sum + count, 0);
  const deepest = Math.max(5, ...queues.map(([, count]) => count));
  const dead = overview.dead_letters;

  return (
    <Page>
      <PageHeader
        title="Background jobs"
        description="Every asynchronous unit of work. A task is acknowledged only after it finishes, so a crashed worker's task is delivered again rather than lost."
        meta={
          <>
            <ToneBadge tone={waiting ? "warning" : "success"}>{waiting} waiting</ToneBadge>
            <ToneBadge tone={dead.length ? "destructive" : "success"}>
              {dead.length ? `${dead.length} dead letter${dead.length === 1 ? "" : "s"}` : "No dead letters"}
            </ToneBadge>
          </>
        }
        actions={
          <form action={runSchedulerNow}>
            <SubmitButton variant="secondary" pendingLabel="Running">
              <Play />
              Run one scheduler cycle
            </SubmitButton>
          </form>
        }
      />

      <Flash searchParams={params} />

      <FigureGrid columns={3}>
        <Figure label="Jobs waiting" value={waiting} icon={Inbox} tone={waiting ? "warning" : "success"} hint={`Across ${queues.length} queues`} />
        <Figure label="Dead letters" value={dead.length} icon={Skull} tone={dead.length ? "destructive" : "success"} hint={dead.length ? "Fix the cause, then replay" : "Nothing has exhausted its retries"} />
        <Figure label="Longest time limit" value={`${Math.max(...Object.values(TIME_LIMIT))} s`} icon={Timer} hint="Compute queue, for simulations" />
      </FigureGrid>

      <Panel title="Queue depth" description="Queues are separated so an overload in drafting cannot block a payment escalation." flush>
        <div className="grid gap-px border-t border-border/70 bg-border/70 sm:grid-cols-2 lg:grid-cols-5">
          {queues.map(([queue, depth]) => (
            <div key={queue} className="flex flex-col gap-3 bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] font-medium">{queue}</span>
                <span className={cn("size-2 rounded-full", depth === 0 ? "bg-success" : queue === "critical" ? "bg-destructive" : "bg-warning")} aria-hidden />
              </div>
              <span className="font-display text-3xl leading-none font-semibold tracking-tight tabular-nums">{depth}</span>
              <Meter value={depth} max={deepest} tone={depth === 0 ? "success" : queue === "critical" ? "destructive" : "warning"} label={`${queue} queue depth`} />
              <div className="flex flex-col gap-1 text-[12px] leading-snug text-muted-foreground">
                <span>{PURPOSE[queue] ?? "Background work"}</span>
                <span className="tabular-nums">Limit {TIME_LIMIT[queue] ?? 60} s per task</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Dead letters"
        description="A job that exhausted its retries. Fix the cause, then replay it. Every handler is idempotent, so a replay cannot apply anything twice."
        flush
      >
        {dead.length ? (
          <ul className="divide-y divide-border/70 border-t border-border/70">
            {dead.map((job) => (
              <li key={job.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:px-6">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-medium">{job.type}</span>
                    <ToneBadge tone="destructive">{job.status}</ToneBadge>
                  </div>
                  {job.error && <p className="rounded-xl bg-destructive/6 px-3 py-2 font-mono text-[12px] leading-relaxed break-words text-destructive-ink">{job.error}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground tabular-nums">
                    <span>Queue {job.queue}</span>
                    <span>
                      {job.attempts} attempt{job.attempts === 1 ? "" : "s"}
                    </span>
                    <span>Created {formatDateTime(job.created_at)}</span>
                  </div>
                </div>
                <form action={retryDeadLetter} className="shrink-0">
                  <input type="hidden" name="job_id" value={job.id} />
                  <SubmitButton
                    variant="secondary"
                    size="sm"
                    pendingLabel="Queuing"
                    confirmTitle="Replay this job?"
                    confirm="The job goes back on its queue and runs again. Handlers are idempotent, so nothing it already applied is applied twice."
                    confirmLabel="Replay"
                  >
                    <RefreshCw />
                    Replay
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mx-5 mb-5 flex items-center gap-3 rounded-2xl bg-success/10 px-4 py-3.5 text-sm md:mx-6">
            <CheckCircle2 className="size-4 shrink-0 text-success" />
            No job has been sent to the dead-letter state.
          </div>
        )}
      </Panel>

      <Panel title="How reliability is handled">
        <div className="grid gap-5 sm:grid-cols-2">
          {PRINCIPLES.map((principle) => (
            <div key={principle.title} className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-glyph shadow-lift">
                <principle.icon className="size-4" />
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">{principle.title}</h3>
                <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{principle.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </Page>
  );
}
