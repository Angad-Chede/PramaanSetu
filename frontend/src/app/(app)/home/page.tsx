import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  ClipboardCheck,
  FilePen,
  FileSignature,
  FileStack,
  Flag,
  FlaskConical,
  Gauge,
  IndianRupee,
  Inbox,
  LayoutGrid,
  ShieldCheck,
  Sparkles,
  Stamp,
  TimerReset,
  type LucideIcon,
} from "lucide-react";

import { BarList, type BarListItem } from "@/components/ui/bar-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Deadline, Flash, Meter, Page, PageHeader, Panel, ToneBadge, type Tone } from "@/components/app/kit";
import { all, apiGet, apiGetOptional } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, ROLE_LABELS, formatDateTime } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import type { Notification, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

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
    window_days?: number;
    paid_milestones?: number;
  };
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const QUICK_LINKS: { roles: string[]; href: string; label: string; detail: string; icon: LucideIcon }[] = [
  { roles: ["PA"], href: "/admin", label: "Platform health", detail: "Queues, dependencies, alerts and the demonstration controls.", icon: Activity },
  { roles: ["DO"], href: "/challenges/new", label: "Write a new challenge", detail: "Describe the problem in your own words and the platform drafts the structure.", icon: FilePen },
  { roles: ["DO", "DA"], href: "/challenges", label: "Your department's challenges", detail: "Every challenge and the stage it is in.", icon: FileStack },
  { roles: ["FO"], href: "/finance", label: "Payment queue", detail: "Approved milestones, sorted by service level deadline.", icon: IndianRupee },
  { roles: ["SU"], href: "/challenges-board", label: "Find a challenge", detail: "Open challenges you can apply to today.", icon: LayoutGrid },
  { roles: ["EE", "IV"], href: "/evaluation", label: "Your panel work", detail: "Challenges you are assigned to evaluate or validate.", icon: Gauge },
  { roles: ["DO", "DA", "SU", "FO", "EE", "IV", "PA"], href: "/evidence", label: "Validated evidence", detail: "Pilots that produced a measured, independently verified result.", icon: ShieldCheck },
];

const STAGE_ORDER = Object.keys(CHALLENGE_STATE_LABELS);

const TURNAROUND_LABELS: Record<string, string> = {
  officer_acceptance: "Officer accepts the evidence",
  approver_payment_approval: "Approver approves payment",
  finance_release: "Finance releases the money",
};

function taskIcon(kind: string): LucideIcon {
  if (/payment|release|invoice/.test(kind)) return IndianRupee;
  if (/approve/.test(kind)) return Stamp;
  if (/screen|application/.test(kind)) return ClipboardCheck;
  if (/score|evaluat|panel/.test(kind)) return Gauge;
  if (/valid|evidence|sign/.test(kind)) return BadgeCheck;
  if (/agreement/.test(kind)) return FileSignature;
  if (/milestone/.test(kind)) return Flag;
  if (/pilot|design|metric/.test(kind)) return FlaskConical;
  if (/draft/.test(kind)) return FilePen;
  if (/challenge|clarif/.test(kind)) return FileStack;
  return Sparkles;
}

function notificationIcon(type: string): LucideIcon {
  const area = type.split(".")[0];
  return (
    {
      milestone: IndianRupee,
      challenge: FileStack,
      application: ClipboardCheck,
      evidence: BadgeCheck,
      pilot: FlaskConical,
      passport: ShieldCheck,
      scale: Stamp,
      evaluation: Gauge,
    } as Record<string, LucideIcon>
  )[area] ?? Bell;
}

const HONORIFICS = /^(prof(essor)?|dr|shri|smt|sri|mr|mrs|ms|kumari)\.?$/i;

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

function summary(count: number, overdue: number): string {
  if (!count) return "Nothing needs your action right now.";
  const amount = NUMBER_WORDS[count] ?? String(count);
  const head = `${amount} ${count === 1 ? "item needs" : "items need"} your action`;
  return overdue ? `${head}, and ${overdue === count ? (count === 1 ? "it is" : "all are") : overdue + " of them " + (overdue === 1 ? "is" : "are")} overdue.` : head + ".";
}

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function today(): string {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date());
}

export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams;
  const sessionRead = requireSession("/home");
  const [session, tasks, dashboard, updates] = await all(
    sessionRead,
    apiGet<TaskList>("/me/tasks"),
    sessionRead.then((signedIn) => (hasRole(signedIn, "DO", "DA", "FO", "PA") ? apiGetOptional<Dashboard>("/admin/dashboard") : null)),
    apiGet<{ items: Notification[]; unread_count: number }>("/me/notifications?limit=6").catch(() => null),
  );

  const quickLinks = QUICK_LINKS.filter((link) => hasRole(session, ...link.roles));
  const firstName = session.name.split(/\s+/).find((part) => !HONORIFICS.test(part)) ?? session.name;
  const [lead, ...rest] = tasks.items;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <span>{today()}</span>
            <span aria-hidden className="text-border">/</span>
            {session.roles.map((role) => (
              <Badge key={role} variant="secondary">
                {ROLE_LABELS[role] ?? role}
              </Badge>
            ))}
          </>
        }
        title={`${greeting()}, ${firstName}`}
        description={summary(tasks.count, tasks.overdue)}
      />

      <Flash searchParams={params} />

      <section aria-label="Summary" className="grid grid-cols-3 overflow-hidden rounded-3xl bg-card shadow-card">
        <Summary label="Waiting on you" value={tasks.count} icon={Inbox} tone={tasks.count ? "brand" : "neutral"} hint={tasks.count ? "Overdue items come first, then by deadline" : "Your inbox is clear"} />
        <Summary
          label="Overdue"
          value={tasks.overdue}
          icon={TimerReset}
          tone={tasks.overdue ? "destructive" : "success"}
          hint={tasks.overdue ? "Past their service level. Each escalates once" : "Everything is inside its service level"}
        />
        <Summary
          label="Unread"
          value={updates?.unread_count ?? 0}
          icon={Bell}
          tone={updates?.unread_count ? "info" : "neutral"}
          href="/notifications"
          hint="Open notifications"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {lead ? (
            <>
              <LeadTask task={lead} />
              {rest.length > 0 && (
                <Panel title="Also waiting" description="Sorted so anything overdue comes first, then by deadline." flush>
                  <ul className="divide-y divide-border/70">
                    {rest.map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))}
                  </ul>
                </Panel>
              )}
            </>
          ) : (
            <ClearInbox first={quickLinks[0]} />
          )}

          {dashboard && <DepartmentSnapshot dashboard={dashboard} title={hasRole(session, "DO", "DA", "FO") ? "Your department at a glance" : "Your home department at a glance"} />}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <Panel
            title="Latest updates"
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href="/notifications">
                  All <ArrowRight />
                </Link>
              </Button>
            }
            flush
          >
            {updates?.items.length ? (
              <ol className="relative flex flex-col px-5 pb-5 md:px-6">
                <span aria-hidden className="absolute top-2 bottom-7 left-[33px] w-px bg-border md:left-[37px]" />
                {updates.items.map((item) => {
                  const Icon = notificationIcon(item.type);
                  const body = (
                    <>
                      <span
                        className={cn(
                          "relative z-10 grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-card",
                          item.action_required && !item.read ? "bg-brand text-brand-foreground" : "bg-surface text-glyph",
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className={cn("text-[13px] leading-snug text-pretty", item.read ? "text-muted-foreground" : "font-medium text-foreground")}>
                          {item.title}
                        </span>
                        <span className="text-[12px] text-muted-foreground tabular-nums">{formatDateTime(item.created_at)}</span>
                      </span>
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {item.link ? (
                        <Link href={item.link} className="-mx-2 flex gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-surface/70">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex gap-3 py-2.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="px-5 pb-5 text-[13px] text-muted-foreground md:px-6">Nothing has happened on your records yet.</p>
            )}
          </Panel>

          {quickLinks.length > 0 && (
            <Panel title="Where to go next" flush>
              <ul className="flex flex-col px-2 pb-2">
                {quickLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="group flex items-start gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-surface/70 focus-visible:bg-surface focus-visible:outline-none"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-surface text-glyph shadow-lift transition-colors group-hover:bg-brand group-hover:text-brand-foreground">
                        <link.icon className="size-4" />
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">{link.label}</span>
                        <span className="text-[12px] leading-snug text-muted-foreground">{link.detail}</span>
                      </span>
                      <ArrowUpRight className="ml-auto size-4 shrink-0 text-glyph opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </Page>
  );
}

function LeadTask({ task }: { task: Task }) {
  const Icon = taskIcon(task.kind);
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl bg-card p-6 shadow-card md:p-7",
        task.overdue && "ring-1 ring-destructive/25",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-24 -right-24 size-72 rounded-full",
          task.overdue
            ? "bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--destructive)_16%,transparent),transparent)]"
            : "bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand)_16%,transparent),transparent)]",
        )}
      />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Next up</span>
          <Badge variant="secondary">{ROLE_LABELS[task.role] ?? task.role}</Badge>
          {task.overdue && <ToneBadge tone="destructive">Overdue</ToneBadge>}
        </div>
        <div className="flex items-start gap-4">
          <span
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-2xl shadow-lift",
              task.overdue ? "bg-destructive text-destructive-foreground" : "bg-brand text-brand-foreground",
            )}
          >
            <Icon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="font-display text-xl leading-snug font-semibold tracking-tight text-balance text-foreground md:text-2xl">{task.title}</h2>
            <p className="max-w-[62ch] text-[15px] leading-relaxed text-pretty text-muted-foreground">{task.detail}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[13px]">{task.due_at ? <Deadline value={task.due_at} /> : <span className="text-muted-foreground">No deadline on this item</span>}</span>
          <Button asChild variant={task.overdue ? "destructive" : "brand"} size="lg" className="w-full sm:w-auto">
            <Link href={task.link}>
              {task.action_label}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function TaskRow({ task }: { task: Task }) {
  const Icon = taskIcon(task.kind);
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center md:px-6">
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            task.overdue ? "bg-destructive/12 text-destructive-ink" : "bg-surface text-glyph",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{ROLE_LABELS[task.role] ?? task.role}</Badge>
            {task.overdue && <ToneBadge tone="destructive">Overdue</ToneBadge>}
          </div>
          <p className="text-sm font-medium text-pretty text-foreground">{task.title}</p>
          <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{task.detail}</p>
          {task.due_at && (
            <span className="text-[12px]">
              <Deadline value={task.due_at} />
            </span>
          )}
        </div>
      </div>
      <Button asChild variant={task.overdue ? "default" : "secondary"} size="sm" className="self-start sm:self-center">
        <Link href={task.link}>{task.action_label}</Link>
      </Button>
    </li>
  );
}

function ClearInbox({ first }: { first?: (typeof QUICK_LINKS)[number] }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-card px-6 py-12 text-center shadow-card md:py-16">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-success/12 text-success-ink shadow-lift">
          <BadgeCheck className="size-6" />
        </span>
        <h2 className="font-display text-2xl font-semibold tracking-tight">Nothing needs you right now</h2>
        <p className="text-[15px] leading-relaxed text-pretty text-muted-foreground">
          Anything assigned to you lands here with its action beside it, and stays until it is done.
        </p>
        {first && (
          <Button asChild variant="secondary" className="mt-1">
            <Link href={first.href}>
              {first.label}
              <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}

function DepartmentSnapshot({ dashboard, title }: { dashboard: Dashboard; title: string }) {
  const stages: BarListItem[] = Object.entries(dashboard.challenges_by_stage)
    .sort(([a], [b]) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b))
    .map(([stage, count]) => ({
      name: CHALLENGE_STATE_LABELS[stage] ?? stage,
      value: count,
      href: "/challenges?state=" + stage,
    }));

  const adherence = dashboard.payment?.sla_adherence_percent;
  const turnaround = Object.entries(dashboard.payment?.average_days ?? {});
  const slowest = Math.max(1, ...turnaround.map(([, days]) => days ?? 0));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 pt-2">
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-[13px] text-muted-foreground">Figures come from the platform&apos;s own records, not from a separate report.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniFigure label="Challenges" value={dashboard.challenges_total} />
        <MiniFigure label="Pilots running" value={dashboard.pilots_active} />
        <MiniFigure label="Open service level breaches" value={dashboard.open_sla_breaches} alert={dashboard.open_sla_breaches > 0} />
        <MiniFigure label="Passports issued" value={dashboard.passports_issued} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Challenges by stage" description="Open a stage to see its challenges.">
          {stages.length ? (
            <BarList data={stages} sort="none" />
          ) : (
            <p className="text-[13px] text-muted-foreground">No challenges yet.</p>
          )}
        </Panel>

        <Panel title="Payment service level" description={`Milestones paid in the last ${dashboard.payment?.window_days ?? 90} days.`}>
          <div className="flex flex-col gap-5">
            <div className="flex items-end gap-3">
              <span className="font-display text-4xl leading-none font-semibold tracking-tight tabular-nums">
                {adherence === null || adherence === undefined ? "None yet" : `${Math.round(adherence)}%`}
              </span>
              <span className="pb-0.5 text-[13px] text-muted-foreground">
                {adherence === null || adherence === undefined ? "Not measured until a milestone is paid" : "of payments met their service level"}
              </span>
            </div>
            {turnaround.length > 0 && (
              <ul className="flex flex-col gap-3">
                {turnaround.map(([step, days]) => (
                  <li key={step} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="text-muted-foreground">{TURNAROUND_LABELS[step] ?? step.replace(/_/g, " ")}</span>
                      <span className="font-medium text-foreground tabular-nums">{days === null ? "No data" : `${days} days`}</span>
                    </div>
                    <Meter value={days ?? 0} max={slowest} tone="info" label={TURNAROUND_LABELS[step]} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>
    </section>
  );
}

function MiniFigure({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-3xl p-4 shadow-card", alert ? "bg-destructive/8" : "bg-card")}>
      <span className={cn("font-display text-2xl leading-none font-semibold tracking-tight tabular-nums", alert ? "text-destructive-ink" : "text-foreground")}>
        {value}
      </span>
      <span className="text-[12px] leading-snug text-muted-foreground">{label}</span>
    </div>
  );
}

const SUMMARY_TONE: Record<Tone, string> = {
  neutral: "bg-surface text-glyph",
  brand: "bg-brand/12 text-brand-ink",
  info: "bg-info/12 text-info-ink",
  success: "bg-success/12 text-success-ink",
  warning: "bg-warning/14 text-warning-ink",
  destructive: "bg-destructive/12 text-destructive-ink",
};

function Summary({ label, value, hint, icon: Icon, tone, href }: { label: string; value: number; hint: string; icon: LucideIcon; tone: Tone; href?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-muted-foreground sm:text-[13px]">{label}</span>
        <span className={cn("hidden size-7 shrink-0 place-items-center rounded-full sm:grid", SUMMARY_TONE[tone])}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <span className={cn("font-display text-2xl leading-none font-semibold tracking-tight tabular-nums sm:text-[28px]", tone === "destructive" && "text-destructive-ink")}>
        {value}
      </span>
      <span className="hidden text-[13px] leading-snug text-muted-foreground sm:inline-flex sm:items-center sm:gap-1">
        {hint}
        {href && <ArrowRight className="size-3" />}
      </span>
    </>
  );
  const cell = "flex min-w-0 flex-col gap-3 border-l border-border/70 p-4 first:border-l-0 sm:p-5";
  return href ? (
    <Link href={href} className={cn(cell, "transition-colors hover:bg-surface/60 focus-visible:bg-surface focus-visible:outline-none")}>
      {body}
    </Link>
  ) : (
    <div className={cell}>{body}</div>
  );
}
