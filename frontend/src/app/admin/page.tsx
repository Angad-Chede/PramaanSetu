import type { Metadata } from "next";
import Link from "next/link";

import { moveDemoClock, runSchedulerNow } from "@/app/actions";
import { SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  Field,
  KeyValue,
  PageHeader,
  Pill,
  ProblemList,
  Section,
} from "@/components/ui";
import { apiGet, apiGetOptional } from "@/lib/api";
import { decimal, formatDateTime } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

type Status = {
  time: string;
  environment: string;
  queues: Record<string, number>;
  oldest_critical_job_seconds: number;
  outbox: { pending: number; oldest_seconds: number };
  scheduler: { holder: string | null; healthy: boolean; seconds_since_last_run?: number };
  llm: { provider: string; model: string; prompt_version: string; breaker: { open: boolean } };
  embeddings: { provider: string; model: string; dimensions: number };
  adapters: Record<string, { name: string; mode: string; breaker: { open: boolean } }>;
  feature_flags: Record<string, boolean>;
  alerts: { severity: string; name: string; detail: string }[];
};

type Dashboard = {
  challenges_total: number;
  pilots_active: number;
  open_sla_breaches: number;
  passports_issued: number;
  evidence: { band: string; count: number; average_score: number }[];
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/admin");
  const status = await apiGet<Status>("/status");
  const dashboard = await apiGetOptional<Dashboard>("/admin/dashboard");

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const isAdmin = hasRole(session, "PA");

  return (
    <div>
      <PageHeader
        title="Administration"
        subtitle="Platform state, background work and the controls a nodal agency needs to operate the service."
        meta={
          <>
            <Pill>{status.environment}</Pill>
            <Pill tone={status.scheduler.healthy ? "good" : "bad"}>
              Scheduler {status.scheduler.healthy ? "healthy" : "not running"}
            </Pill>
            {status.alerts.length ? <Pill tone="bad">{status.alerts.length} alert(s)</Pill> : null}
          </>
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

      {status.alerts.length ? (
        <div className="mb-5">
          <Callout tone="bad" title="Active alerts">
            <ul className="space-y-2">
              {status.alerts.map((alert) => (
                <li key={alert.name}>
                  <span className="font-medium">{alert.name}</span> ({alert.severity}): {alert.detail}
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : null}

      <Section title="Where to go">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/admin/users", label: "Users and roles", detail: "Accounts, role assignments and scopes." },
            { href: "/admin/templates", label: "Template Kit", detail: "Versioned templates and what uses them." },
            { href: "/admin/jobs", label: "Background jobs", detail: "Queue depth and dead-letter replay." },
            { href: "/admin/audit", label: "Audit and chain verification", detail: "The full trail, and the integrity check." },
          ].map((item) => (
            <li key={item.href} className="rounded border border-line px-4 py-3">
              <Link href={item.href} className="font-medium">
                {item.label}
              </Link>
              <p className="mt-1 text-sm text-ink-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
      </Section>

      {dashboard ? (
        <Section title="Platform activity">
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "Challenges", value: dashboard.challenges_total },
              { label: "Pilots running", value: dashboard.pilots_active },
              { label: "Open service level breaches", value: dashboard.open_sla_breaches },
              { label: "Passports issued", value: dashboard.passports_issued },
            ].map((item) => (
              <div key={item.label} className="rounded border border-line bg-paper-soft px-3 py-3">
                <dd className="num text-2xl font-semibold text-ink">{item.value}</dd>
                <dt className="mt-1 text-sm text-ink-muted">{item.label}</dt>
              </div>
            ))}
          </dl>
          {dashboard.evidence.length ? (
            <div className="mt-5">
              <DataTable columns={["Evidence band", "Reports", "Average score"]}>
                {dashboard.evidence.map((row) => (
                  <tr key={row.band ?? "none"}>
                    <td>{row.band ?? "Not issued"}</td>
                    <td className="num">{row.count}</td>
                    <td className="num">{decimal(row.average_score, 1)}</td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title="Background work" description="Queues are separated so slow work cannot starve urgent work.">
        <DataTable columns={["Queue", "Jobs waiting", "What runs here"]}>
          {Object.entries(status.queues).map(([queue, depth]) => (
            <tr key={queue}>
              <td className="font-medium">{queue}</td>
              <td className="num">
                {depth > 0 ? <Pill tone={queue === "critical" && depth > 5 ? "bad" : "warn"}>{depth}</Pill> : 0}
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
        <p className="mt-3 text-sm text-ink-muted">
          Oldest job on the critical queue: {decimal(status.oldest_critical_job_seconds, 1)} seconds.
          Outbox: {status.outbox.pending} event(s) awaiting relay, oldest{" "}
          {decimal(status.outbox.oldest_seconds, 1)} seconds.
        </p>
      </Section>

      <Section
        title="Dependencies"
        description="Every external system sits behind an adapter with a circuit breaker. Switching an adapter to live mode is a configuration change, not a code change."
      >
        <DataTable columns={["Dependency", "Mode", "Circuit breaker"]}>
          {Object.entries(status.adapters).map(([name, adapter]) => (
            <tr key={name}>
              <td className="font-medium">{name}</td>
              <td>
                <Pill tone={adapter.mode === "mock" ? "warn" : "good"}>{adapter.mode}</Pill>
              </td>
              <td>
                {adapter.breaker.open ? <Pill tone="bad">Open</Pill> : <Pill tone="good">Closed</Pill>}
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="mt-5">
          <KeyValue
            rows={[
              {
                label: "Drafting provider",
                value: status.llm.provider + " (" + status.llm.model + ")",
              },
              { label: "Prompt version", value: status.llm.prompt_version },
              {
                label: "Embedding provider",
                value:
                  status.embeddings.provider +
                  " (" +
                  status.embeddings.model +
                  ", " +
                  status.embeddings.dimensions +
                  " dimensions)",
              },
              {
                label: "Scheduler leader",
                value: status.scheduler.holder ?? "None yet",
              },
              { label: "Platform time", value: formatDateTime(status.time) },
            ]}
          />
        </div>
      </Section>

      <Section title="Feature flags" description="P1 features can be switched off without a release.">
        <ul className="flex flex-wrap gap-2">
          {Object.entries(status.feature_flags).map(([flag, enabled]) => (
            <li key={flag}>
              <Pill tone={enabled ? "good" : "neutral"}>
                {flag.replace(/_/g, " ")}: {enabled ? "on" : "off"}
              </Pill>
            </li>
          ))}
        </ul>
      </Section>

      {isAdmin ? (
        <Section
          title="Demonstration controls"
          description="Available in local, staging and demonstration environments only, and recorded in the audit log."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <form action={moveDemoClock} className="space-y-3">
              <Field
                label="Fast-forward the platform clock, in days"
                name="days"
                help="Moves every service level timer forward, so a breach can be demonstrated without waiting."
              >
                <input id="days" name="days" type="number" min={0} max={365} defaultValue={8} />
              </Field>
              <div className="flex items-center gap-2">
                <input id="confirm" name="confirm" type="checkbox" className="h-4 w-4" />
                <label htmlFor="confirm" className="font-normal">
                  I understand this affects every service level timer
                </label>
              </div>
              <SubmitButton variant="secondary">Move the clock</SubmitButton>
            </form>

            <div className="space-y-3">
              <p className="text-sm text-ink-soft">
                Running one scheduler cycle now evaluates every open milestone, sends reminders at
                75 percent of a service level and escalates anything past it. Escalation is
                exactly-once: running the cycle twice does not escalate twice.
              </p>
              <form action={runSchedulerNow}>
                <SubmitButton variant="secondary">Run one scheduler cycle</SubmitButton>
              </form>
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
