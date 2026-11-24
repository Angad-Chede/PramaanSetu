import type { Metadata } from "next";
import Link from "next/link";

import { apiGet, apiGetOptional } from "@/lib/api";
import { ROLE_LABELS, compactRupees, relativeDeadline } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Task } from "@/lib/types";

import { ButtonLink, Callout, Deadline, EmptyState, PageHeader, Pill, Section } from "@/components/ui";

export const metadata: Metadata = { title: "My tasks" };
export const dynamic = "force-dynamic";

type TaskList = { items: Task[]; count: number; overdue: number; summary: string };

type Dashboard = {
  challenges_by_stage: Record<string, number>;
  challenges_total: number;
  pilots_active: number;
  open_sla_breaches: number;
  passports_issued: number;
  payment?: {
    sla_adherence_percent: number | null;
    average_days?: Record<string, number | null>;
  };
};

const QUICK_LINKS: { roles: string[]; href: string; label: string; detail: string }[] = [
  {
    roles: ["DO"],
    href: "/challenges/new",
    label: "Write a new challenge",
    detail: "Describe the problem in your own words and the platform drafts the structure.",
  },
  {
    roles: ["DO", "DA"],
    href: "/challenges",
    label: "Your department's challenges",
    detail: "Every challenge and the stage it is in.",
  },
  {
    roles: ["FO"],
    href: "/finance",
    label: "Payment queue",
    detail: "Approved milestones, sorted by service level deadline.",
  },
  {
    roles: ["SU"],
    href: "/challenges-board",
    label: "Find a challenge",
    detail: "Open challenges you can apply to today.",
  },
  {
    roles: ["EE", "IV"],
    href: "/evaluation",
    label: "Your panel work",
    detail: "Challenges you are assigned to evaluate or validate.",
  },
  {
    roles: ["DO", "DA", "SU", "FO", "EE", "IV", "PA"],
    href: "/evidence",
    label: "Validated evidence",
    detail: "Pilots that produced a measured, independently verified result.",
  },
];

function TaskRow({ task }: { task: Task }) {
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={task.overdue ? "bad" : "neutral"}>
            {ROLE_LABELS[task.role] ?? task.role}
          </Pill>
          {task.overdue ? <Pill tone="bad">Overdue</Pill> : null}
        </div>
        <p className="mt-1 font-medium text-ink">{task.title}</p>
        <p className="mt-0.5 max-w-prose text-sm text-ink-muted">{task.detail}</p>
        {task.due_at ? (
          <p className="mt-1 text-sm">
            <Deadline value={task.due_at} />
          </p>
        ) : null}
      </div>
      <div className="shrink-0">
        <ButtonLink href={task.link} variant={task.overdue ? "primary" : "secondary"}>
          {task.action_label}
        </ButtonLink>
      </div>
    </li>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/home");
  const tasks = await apiGet<TaskList>("/me/tasks");
  const dashboard = hasRole(session, "DO", "DA", "FO", "PA")
    ? await apiGetOptional<Dashboard>("/admin/dashboard")
    : null;

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const quickLinks = QUICK_LINKS.filter((link) => hasRole(session, ...link.roles));

  return (
    <div>
      <PageHeader
        title={"What needs you, " + session.name.split(" ")[0]}
        subtitle={tasks.summary}
        meta={session.roles.map((role) => (
          <Pill key={role}>{ROLE_LABELS[role] ?? role}</Pill>
        ))}
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">
            {notice}
          </Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5">
          <Callout tone="bad" title="That action did not complete">
            {problem.message}
          </Callout>
        </div>
      ) : null}

      <Section
        title="Items waiting for your action"
        description="Sorted so that anything overdue comes first, then by deadline."
      >
        {tasks.items.length ? (
          <ul className="divide-y divide-line">
            {tasks.items.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        ) : (
          <EmptyState
            message="Nothing needs your action right now. Anything assigned to you will appear here, with the action next to it."
            action={
              quickLinks.length ? <ButtonLink href={quickLinks[0].href}>{quickLinks[0].label}</ButtonLink> : null
            }
          />
        )}
      </Section>

      {dashboard ? (
        <Section
          title="Your department at a glance"
          description="Figures come from the platform's own records, not from a separate report."
        >
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              { label: "Challenges", value: dashboard.challenges_total },
              { label: "Pilots running", value: dashboard.pilots_active },
              {
                label: "Open service level breaches",
                value: dashboard.open_sla_breaches,
                tone: dashboard.open_sla_breaches > 0 ? "bad" : undefined,
              },
              { label: "Passports issued", value: dashboard.passports_issued },
              {
                label: "Payment service level met",
                value:
                  dashboard.payment?.sla_adherence_percent === null ||
                  dashboard.payment?.sla_adherence_percent === undefined
                    ? "Not yet measured"
                    : dashboard.payment.sla_adherence_percent + " percent",
              },
            ].map((item) => (
              <div
                key={item.label}
                className={
                  "rounded border px-3 py-3 " +
                  (item.tone === "bad" ? "border-bad bg-bad-light" : "border-line bg-paper-soft")
                }
              >
                <dd className={"num text-2xl font-semibold " + (item.tone === "bad" ? "text-bad" : "text-ink")}>
                  {item.value}
                </dd>
                <dt className="mt-1 text-sm text-ink-muted">{item.label}</dt>
              </div>
            ))}
          </dl>

          {Object.keys(dashboard.challenges_by_stage).length ? (
            <div className="mt-5">
              <h3 className="mb-2">Challenges by stage</h3>
              <ul className="flex flex-wrap gap-2">
                {Object.entries(dashboard.challenges_by_stage).map(([stage, count]) => (
                  <li key={stage}>
                    <Link
                      href={"/challenges?state=" + stage}
                      className="pill pill-neutral no-underline hover:bg-paper"
                    >
                      {stage}: {count}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      ) : null}

      {quickLinks.length ? (
        <Section title="Where to go next">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickLinks.map((link) => (
              <li key={link.href} className="rounded border border-line px-4 py-3">
                <Link href={link.href} className="font-medium">
                  {link.label}
                </Link>
                <p className="mt-1 text-sm text-ink-muted">{link.detail}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
