import type { Metadata } from "next";

import { retryDeadLetter, runSchedulerNow } from "@/app/actions";
import { SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  EmptyState,
  PageHeader,
  Pill,
  ProblemList,
  Section,
} from "@/components/ui";
import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Background jobs" };
export const dynamic = "force-dynamic";

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

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession("/admin/jobs");
  const overview = await apiGet<Overview>("/admin/jobs");
  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);

  const waiting = Object.values(overview.queue_depth).reduce((sum, count) => sum + count, 0);

  return (
    <div>
      <PageHeader
        title="Background jobs"
        subtitle="Every asynchronous unit of work. A task is acknowledged only after it finishes, so a crashed worker's task is redelivered rather than lost."
        meta={
          <>
            <Pill>{waiting} waiting</Pill>
            {overview.dead_letters.length ? (
              <Pill tone="bad">{overview.dead_letters.length} dead letter(s)</Pill>
            ) : (
              <Pill tone="good">No dead letters</Pill>
            )}
          </>
        }
        actions={
          <form action={runSchedulerNow}>
            <SubmitButton variant="secondary">Run one scheduler cycle</SubmitButton>
          </form>
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That action did not complete">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      <Section
        title="Queue depth"
        description="Queues are separated so an overload in drafting cannot block a payment escalation."
      >
        <DataTable columns={["Queue", "Waiting", "Time limit", "What runs here"]}>
          {Object.entries(overview.queue_depth).map(([queue, depth]) => (
            <tr key={queue}>
              <td className="font-medium">{queue}</td>
              <td className="num">
                {depth > 0 ? <Pill tone={queue === "critical" ? "bad" : "warn"}>{depth}</Pill> : 0}
              </td>
              <td className="num text-sm">
                {{ critical: 30, default: 60, ai: 60, compute: 120, docs: 60 }[queue] ?? 60} seconds
              </td>
              <td className="text-sm text-ink-muted">
                {
                  {
                    critical: "Outbox relay and service level escalations",
                    default: "Screening, notifications and maintenance",
                    ai: "Drafting, embeddings and matching",
                    compute: "Simulations and evidence analysis",
                    docs: "Document rendering",
                  }[queue]
                }
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section
        title="Dead letters"
        description="A job that exhausted its retries. Fix the cause, then replay it; every handler is idempotent, so a replay cannot apply anything twice."
      >
        {overview.dead_letters.length ? (
          <DataTable columns={["Type", "Queue", "Status", "Attempts", "Error", "Created", ""]}>
            {overview.dead_letters.map((job) => (
              <tr key={job.id}>
                <td className="font-medium">{job.type}</td>
                <td className="text-sm">{job.queue}</td>
                <td className="text-sm">
                  <Pill tone="bad">{job.status}</Pill>
                </td>
                <td className="num">{job.attempts}</td>
                <td className="max-w-md break-words text-sm text-ink-muted">{job.error}</td>
                <td className="whitespace-nowrap text-sm">{formatDateTime(job.created_at)}</td>
                <td className="text-right">
                  <form action={retryDeadLetter}>
                    <input type="hidden" name="job_id" value={job.id} />
                    <SubmitButton variant="secondary">Replay</SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="No job has been sent to the dead-letter state." />
        )}
      </Section>

      <Section title="How reliability is handled">
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
          <li>
            Side effects are never triggered from request code. A change writes an event in the same
            transaction, and a relay turns committed events into jobs, so an event is emitted if and
            only if the change committed.
          </li>
          <li>
            Retries use exponential backoff with jitter, for transient errors only. A validation
            error fails immediately rather than being retried five times.
          </li>
          <li>
            Each queue has a hard time limit, so a stuck task cannot hold a worker slot for ever.
          </li>
          <li>
            Simulations and evidence analysis take an explicit random seed, stored with the run, so
            a redelivered task produces the same numbers.
          </li>
        </ul>
      </Section>
    </div>
  );
}
