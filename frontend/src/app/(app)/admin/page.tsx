import type { Metadata } from "next";
import {
  Activity,
  BookOpenCheck,
  Bot,
  Cable,
  Clock3,
  Inbox,
  Play,
  ScrollText,
  ShieldAlert,
  TimerReset,
  ToggleRight,
  Users,
  Waypoints,
} from "lucide-react";

import { moveDemoClock, runSchedulerNow } from "@/app/actions";
import { CheckField, SubmitButton, TextField } from "@/components/app/forms";
import { Callout, Figure, FigureGrid, Flash, KeyValues, Meter, Page, PageHeader, Panel, RowLink, RowList, ToneBadge } from "@/components/app/kit";
import { DonutChart } from "@/components/ui/donut-chart";
import { all, apiGet, apiGetOptional } from "@/lib/api";
import { decimal, formatDateTime } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

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

const QUEUE_PURPOSE: Record<string, string> = {
  critical: "Outbox relay and service level escalations",
  default: "Screening, notifications and maintenance",
  ai: "Drafting, embeddings and matching",
  compute: "Simulations and evidence analysis",
  docs: "Document rendering",
};

const ADAPTER_LABELS: Record<string, string> = {
  dpiit: "DPIIT startup registry",
  gem: "Government e-Marketplace",
  esign: "Aadhaar eSign",
  sms: "SMS gateway",
  email: "Email",
  storage: "Document vault",
};

const BAND_COLORS: Record<string, string> = {
  Strong: "var(--success)",
  Moderate: "var(--warning)",
  Weak: "var(--destructive)",
};

const LINKS = [
  { href: "/admin/users", label: "Users and roles", detail: "Accounts, role assignments and scopes", icon: Users },
  { href: "/admin/templates", label: "Template Kit", detail: "Versioned templates and what uses them", icon: BookOpenCheck },
  { href: "/admin/jobs", label: "Background jobs", detail: "Queue depth and dead-letter replay", icon: Waypoints },
  { href: "/admin/audit", label: "Audit chain", detail: "The full trail and the integrity check", icon: ScrollText },
];

export default async function AdminPage({ searchParams }: Props) {
  const params = await searchParams;
  const [session, status, dashboard] = await all(
    requireSession("/admin"),
    apiGet<Status>("/status"),
    apiGetOptional<Dashboard>("/admin/dashboard"),
  );
  const isAdmin = hasRole(session, "PA");

  const waiting = Object.values(status.queues).reduce((sum, depth) => sum + depth, 0);
  const deepest = Math.max(5, ...Object.values(status.queues));
  const adapters = Object.entries(status.adapters);
  const openBreakers = adapters.filter(([, adapter]) => adapter.breaker.open).length + (status.llm.breaker.open ? 1 : 0);
  const flags = Object.entries(status.feature_flags);

  return (
    <Page width="wide">
      <PageHeader
        title="Administration"
        description="Platform state, background work and the controls a nodal agency needs to operate the service."
        meta={
          <>
            <ToneBadge tone="info">{status.environment} environment</ToneBadge>
            <ToneBadge tone={status.scheduler.healthy ? "success" : "destructive"}>
              Scheduler {status.scheduler.healthy ? "healthy" : "not running"}
            </ToneBadge>
            <ToneBadge tone={status.alerts.length ? "destructive" : "success"}>
              {status.alerts.length ? `${status.alerts.length} active alert${status.alerts.length === 1 ? "" : "s"}` : "No alerts"}
            </ToneBadge>
            <span className="tabular-nums">Platform time {formatDateTime(status.time)}</span>
          </>
        }
      />

      <Flash searchParams={params} />

      {status.alerts.length > 0 && (
        <Callout tone="destructive" title="Active alerts" icon={ShieldAlert}>
          <ul className="mt-1 flex flex-col gap-1.5">
            {status.alerts.map((alert) => (
              <li key={alert.name}>
                <span className="font-medium text-foreground">{alert.name}</span> ({alert.severity}): {alert.detail}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <FigureGrid className="grid-cols-2">
        <Figure label="Jobs waiting" value={waiting} icon={Inbox} tone={waiting ? "warning" : "success"} hint={`Oldest critical job ${decimal(status.oldest_critical_job_seconds, 1)} s`} />
        <Figure
          label="Outbox awaiting relay"
          value={status.outbox.pending}
          icon={Cable}
          tone={status.outbox.pending ? "warning" : "success"}
          hint={`Oldest event ${decimal(status.outbox.oldest_seconds, 1)} s`}
        />
        <Figure
          label="Scheduler last ran"
          value={status.scheduler.seconds_since_last_run === undefined ? "Never" : `${decimal(status.scheduler.seconds_since_last_run, 1)} s`}
          icon={Clock3}
          tone={status.scheduler.healthy ? "success" : "destructive"}
          hint={`Leader ${status.scheduler.holder ?? "none yet"}`}
        />
        <Figure
          label="Circuit breakers open"
          value={openBreakers}
          icon={Activity}
          tone={openBreakers ? "destructive" : "success"}
          hint={`${adapters.length + 1} dependencies watched`}
        />
      </FigureGrid>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          {dashboard && (
            <Panel title="Platform activity" description="Counted from the platform's own records.">
              <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-center">
                <dl className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Challenges", value: dashboard.challenges_total },
                    { label: "Pilots running", value: dashboard.pilots_active },
                    { label: "Open service level breaches", value: dashboard.open_sla_breaches, alert: dashboard.open_sla_breaches > 0 },
                    { label: "Passports issued", value: dashboard.passports_issued },
                  ].map((item) => (
                    <div key={item.label} className={cn("flex flex-col-reverse justify-end gap-1.5 rounded-2xl p-4", item.alert ? "bg-destructive/8" : "bg-surface/70")}>
                      <dt className="text-[12px] leading-snug text-muted-foreground">{item.label}</dt>
                      <dd className={cn("font-serif text-[30px] leading-none font-normal tracking-[-0.025em] tabular-nums", item.alert && "text-destructive-ink")}>{item.value}</dd>
                    </div>
                  ))}
                </dl>
                {dashboard.evidence.length ? (
                  <div className="flex flex-col gap-3">
                    <DonutChart
                      data={dashboard.evidence.map((row) => ({ name: row.band ?? "Not issued", value: row.count, color: BAND_COLORS[row.band] }))}
                      label="Evidence reports"
                      size={150}
                      legend="right"
                    />
                    <ul className="flex flex-col divide-y divide-border/70 text-[13px]">
                      {dashboard.evidence.map((row) => (
                        <li key={row.band ?? "none"} className="flex items-center justify-between gap-3 py-2">
                          <span className="text-muted-foreground">{row.band ?? "Not issued"} band average score</span>
                          <span className="font-medium tabular-nums">{decimal(row.average_score, 1)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="grid h-full place-items-center rounded-2xl border border-dashed p-6 text-center text-[13px] text-muted-foreground">
                    No Evidence Report has been issued yet.
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Background work" description="Queues are separated so slow work cannot starve urgent work." flush>
            <ul className="divide-y divide-border/70 border-t border-border/70">
              {Object.entries(status.queues).map(([queue, depth]) => (
                <li key={queue} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-5 py-3.5 md:grid-cols-[120px_minmax(0,1fr)_190px] md:px-6">
                  <span className="font-mono text-[13px] font-medium">{queue}</span>
                  <span className="col-span-2 row-start-2 text-[13px] text-muted-foreground md:col-span-1 md:row-start-auto">{QUEUE_PURPOSE[queue]}</span>
                  <span className="col-start-2 row-start-1 flex items-center gap-3 md:col-start-auto md:row-start-auto">
                    <Meter value={depth} max={deepest} tone={depth === 0 ? "success" : queue === "critical" && depth > 5 ? "destructive" : "warning"} className="hidden w-20 sm:block" label={`${queue} queue depth`} />
                    <span className="w-20 text-right text-sm font-medium whitespace-nowrap tabular-nums">{depth} waiting</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Dependencies"
            description="Every external system sits behind an adapter with a circuit breaker. Switching an adapter to live mode is a configuration change, not a code change."
          >
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {adapters.map(([name, adapter]) => (
                <div key={name} className="flex flex-col gap-3 rounded-2xl bg-surface/70 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium">{ADAPTER_LABELS[name] ?? name}</span>
                      <span className="font-mono text-[12px] text-muted-foreground">{name}</span>
                    </div>
                    <span
                      aria-hidden
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", adapter.breaker.open ? "bg-destructive" : "bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_20%,transparent)]")}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <ToneBadge tone={adapter.mode === "mock" ? "warning" : "success"}>{adapter.mode === "mock" ? "Mock mode" : "Live"}</ToneBadge>
                    <ToneBadge tone={adapter.breaker.open ? "destructive" : "neutral"} dot={false}>
                      Breaker {adapter.breaker.open ? "open" : "closed"}
                    </ToneBadge>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-border/70 pt-5">
              <KeyValues
                columns={3}
                items={[
                  { label: "Drafting provider", value: `${status.llm.provider} (${status.llm.model})` },
                  { label: "Prompt version", value: <span className="font-mono text-[13px]">{status.llm.prompt_version}</span> },
                  { label: "Drafting breaker", value: status.llm.breaker.open ? "Open" : "Closed" },
                  { label: "Embedding provider", value: `${status.embeddings.provider} (${status.embeddings.model}, ${status.embeddings.dimensions} dimensions)`, wide: true },
                  { label: "Scheduler leader", value: <span className="font-mono text-[13px]">{status.scheduler.holder ?? "None yet"}</span> },
                ]}
              />
            </div>
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <Panel title="Manage the platform" flush>
            <RowList className="border-t border-border/70">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <RowLink href={link.href}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-glyph shadow-lift">
                      <link.icon className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium">{link.label}</span>
                      <span className="text-[12px] text-muted-foreground">{link.detail}</span>
                    </span>
                  </RowLink>
                </li>
              ))}
            </RowList>
          </Panel>

          <Panel title="Feature flags" description="P1 features can be switched off without a release." flush>
            <ul className="flex flex-col px-5 pb-4 md:px-6">
              {flags.map(([flag, enabled]) => (
                <li key={flag} className="flex items-center justify-between gap-3 border-t border-border/70 py-3 first:border-t-0">
                  <span className="flex items-center gap-2.5 text-sm">
                    <ToggleRight className={cn("size-4", enabled ? "text-success" : "text-glyph")} />
                    <span className="first-letter:uppercase">{flag.replace(/_/g, " ")}</span>
                  </span>
                  <ToneBadge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</ToneBadge>
                </li>
              ))}
            </ul>
          </Panel>

          {isAdmin && (
            <Panel
              title="Demonstration controls"
              description="Local, staging and demonstration environments only. Each use is written to the audit log."
              className="ring-1 ring-warning/30"
            >
              <div className="flex flex-col gap-6">
                <form action={moveDemoClock} className="flex flex-col gap-4">
                  <TextField
                    label="Fast-forward the platform clock, in days"
                    name="days"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={8}
                    hint="Moves every service level timer forward, so a breach can be shown without waiting."
                  />
                  <CheckField name="confirm" label="I understand this affects every service level timer" />
                  <SubmitButton
                    variant="secondary"
                    confirmTitle="Move the platform clock?"
                    confirm="Every service level timer on the platform moves forward by the number of days you entered. Reminders and escalations follow on the next scheduler cycle."
                    confirmLabel="Move the clock"
                  >
                    <TimerReset />
                    Move the clock
                  </SubmitButton>
                </form>
                <div className="flex flex-col gap-3 border-t border-border/70 pt-5">
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    One scheduler cycle evaluates every open milestone, reminds at 75 percent of a service level and escalates anything past it. Escalation happens once: a second cycle does not escalate again.
                  </p>
                  <form action={runSchedulerNow}>
                    <SubmitButton variant="secondary" pendingLabel="Running">
                      <Play />
                      Run one scheduler cycle
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </Panel>
          )}

          {status.llm.provider === "mock" && (
            <div className="flex items-center gap-2 px-1 text-[12px] text-muted-foreground">
              <Bot className="size-3.5" />
              Drafting runs on a deterministic mock provider in this environment.
            </div>
          )}
        </aside>
      </div>
    </Page>
  );
}
