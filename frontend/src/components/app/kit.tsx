import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowUpRight, CheckCircle2, Clock, Copy, Info, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { formatDateTime, relativeDeadline } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import type { BlockingProblem, FieldError } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Tones                                                                       */
/* -------------------------------------------------------------------------- */

export type Tone = "neutral" | "brand" | "info" | "success" | "warning" | "destructive";

const GOOD_STATES = [
  "Published", "Scaled", "Completed", "Shortlisted", "Active", "Released", "Approved", "Accepted", "Validated",
  "SignedOff", "Signed", "Succeeded", "Strong", "Eligible", "Passed", "Verified", "Paid", "Frozen", "Adopted",
];
const WARN_STATES = [
  "InReview", "Screening", "Evaluation", "Validation", "DecisionPending", "AwaitingStartup", "Paused", "Submitted",
  "UnderEvaluation", "Pending", "Moderate", "Running", "Queued", "Disputed", "Due", "AwaitingApproval",
  "AwaitingRelease", "Review", "Locked", "Screened", "PilotDesign", "Draft", "AgreementDraft", "Shortlisted",
];
const BAD_STATES = [
  "Cancelled", "Terminated", "NotShortlisted", "Withdrawn", "Rejected", "Failed", "Weak", "Breached", "Overdue",
  "Ineligible", "Refused", "DeadLetter", "Escalated", "Closed",
];
const INFO_STATES = ["PilotActive", "ApplicationsClosed", "Shortlisted"];

/** Map any workflow state to a tone. Words always travel with the colour. */
export function toneFor(state: string | null | undefined): Tone {
  if (!state) return "neutral";
  if (state === "Draft" || state === "AgreementDraft") return "neutral";
  if (INFO_STATES.includes(state)) return "info";
  if (GOOD_STATES.includes(state)) return "success";
  if (BAD_STATES.includes(state)) return "destructive";
  if (WARN_STATES.includes(state)) return "warning";
  return "neutral";
}

/** The tone of an Evidence Confidence Score band. */
export function bandToneOf(band: string | null | undefined): Tone {
  if (band === "Strong") return "success";
  if (band === "Moderate") return "warning";
  if (band === "Weak") return "destructive";
  return "neutral";
}

const BADGE_VARIANT: Record<Tone, "secondary" | "brand" | "info" | "success" | "warning" | "destructive"> = {
  neutral: "secondary",
  brand: "brand",
  info: "info",
  success: "success",
  warning: "warning",
  destructive: "destructive",
};

export function ToneBadge({ tone = "neutral", dot = true, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <Badge variant={BADGE_VARIANT[tone]} dot={dot} className={className}>
      {children}
    </Badge>
  );
}

/** A state pill: the state's sentence from a label map, tinted by its tone. */
export function StateBadge({ state, labels, tone, className }: { state: string; labels?: Record<string, string>; tone?: Tone; className?: string }) {
  return (
    <ToneBadge tone={tone ?? toneFor(state)} className={className}>
      {labels?.[state] ?? state.replace(/([a-z])([A-Z])/g, "$1 $2")}
    </ToneBadge>
  );
}

/* -------------------------------------------------------------------------- */
/* Page structure                                                              */
/* -------------------------------------------------------------------------- */

/** The page column. Every signed-in page renders inside one. */
export function Page({ children, className, width = "default" }: { children: ReactNode; className?: string; width?: "default" | "narrow" | "wide" }) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 pt-6 pb-16 md:px-8 md:pt-8",
        width === "narrow" && "max-w-3xl",
        width === "default" && "max-w-6xl",
        width === "wide" && "max-w-[88rem]",
        className,
      )}
    >
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  back,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 animate-enter", className)}>
      {back && (
        <Link
          href={back.href}
          className="group inline-flex w-fit items-center gap-1.5 rounded-full text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ArrowLeft className="size-3.5 transition-transform duration-200 ease-ios group-hover:-translate-x-0.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          {eyebrow && <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-muted-foreground">{eyebrow}</div>}
          <h1 className="font-serif text-[30px] leading-[1.1] tracking-[-0.025em] text-balance text-foreground md:text-[40px] md:leading-[1.05]">{title}</h1>
          {description && <p className="max-w-[68ch] text-[15px] leading-relaxed text-pretty text-muted-foreground">{description}</p>}
          {meta && <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A card with an optional header row. The workhorse container. */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  flush = false,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** no body padding, for tables and lists that run edge to edge */
  flush?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cn("flex flex-col overflow-hidden rounded-3xl bg-card text-card-foreground shadow-card", className)}>
      {(title || action) && (
        <div className={cn("flex items-start justify-between gap-4 px-5 pt-5 md:px-6", flush ? "pb-4" : "pb-0")}>
          <div className="flex min-w-0 flex-col gap-1">
            {title && <h2 className="font-display text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>}
            {description && <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {children !== undefined && <div className={cn(flush ? "" : "p-5 md:p-6", !flush && title ? "pt-4 md:pt-4" : "", bodyClassName)}>{children}</div>}
    </section>
  );
}

/** A quiet section heading between panels. */
export function SectionHeading({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 pt-2">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Figures                                                                     */
/* -------------------------------------------------------------------------- */

/** A static figure tile. Use dashkit's StatCard when the number should roll. */
export function Figure({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  className?: string;
}) {
  const ring: Record<Tone, string> = {
    neutral: "bg-surface text-glyph",
    brand: "bg-brand/12 text-brand-ink",
    info: "bg-info/12 text-info-ink",
    success: "bg-success/12 text-success-ink",
    warning: "bg-warning/14 text-warning-ink",
    destructive: "bg-destructive/12 text-destructive-ink",
  };
  return (
    <div className={cn("flex flex-col gap-3 rounded-3xl bg-card p-5 shadow-card", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span className={cn("grid size-7 place-items-center rounded-full", ring[tone])}>
            <Icon className="size-3.5" />
          </span>
        )}
      </div>
      <div className="font-serif text-[34px] leading-none tracking-[-0.03em] text-foreground tabular-nums">{value}</div>
      {hint && <div className="text-[13px] leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function FigureGrid({ children, columns = 4, className }: { children: ReactNode; columns?: 2 | 3 | 4; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2",
        columns === 3 && "lg:grid-cols-3",
        columns === 4 && "lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A label and value list. */
export function KeyValues({ items, columns = 2, className }: { items: { label: ReactNode; value: ReactNode; wide?: boolean }[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-4",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={index} className={cn("flex min-w-0 flex-col gap-1", item.wide && "sm:col-span-full")}>
          <dt className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">{item.label}</dt>
          <dd className="text-sm leading-relaxed text-pretty break-words text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A horizontal meter with its value spoken in words beside it. */
export function Meter({ value, max = 100, tone = "brand", className, label }: { value: number; max?: number; tone?: Tone; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const fill: Record<Tone, string> = {
    neutral: "bg-glyph",
    brand: "bg-brand",
    info: "bg-info",
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
  };
  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-foreground/10", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out-soft", fill[tone])} style={{ width: pct + "%" }} />
    </div>
  );
}

export function Deadline({ value, label = "Due" }: { value: string | null | undefined; label?: string }) {
  if (!value) return <span className="text-muted-foreground">No deadline</span>;
  const relative = relativeDeadline(value);
  const overdue = relative.includes("overdue");
  return (
    <span className={cn("inline-flex items-center gap-1.5", overdue ? "text-destructive-ink" : "text-muted-foreground")}>
      <Clock className="size-3.5 shrink-0" />
      <span>
        {label} {formatDateTime(value)} <span className={cn(overdue && "font-semibold")}>({relative})</span>
      </span>
    </span>
  );
}

export function Hash({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">Not recorded</span>;
  return (
    <code title={value} className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12px] text-muted-foreground", className)}>
      <Copy className="size-3 shrink-0 opacity-60" />
      {value.slice(0, 12)}…{value.slice(-6)}
    </code>
  );
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

export function Callout({ tone = "neutral", title, children, icon, className, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: LucideIcon; className?: string; action?: ReactNode }) {
  const styles: Record<Tone, string> = {
    neutral: "bg-surface text-foreground [--callout-icon:var(--color-glyph)]",
    brand: "bg-brand/8 [--callout-icon:var(--color-brand)]",
    info: "bg-info/8 [--callout-icon:var(--color-info)]",
    success: "bg-success/10 [--callout-icon:var(--color-success)]",
    warning: "bg-warning/10 [--callout-icon:var(--color-warning)]",
    destructive: "bg-destructive/8 [--callout-icon:var(--color-destructive)]",
  };
  const Icon = icon ?? (tone === "destructive" || tone === "warning" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info);
  return (
    <div role={tone === "destructive" ? "alert" : undefined} className={cn("flex gap-3 rounded-2xl px-4 py-3.5 text-sm", styles[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0 text-(--callout-icon)" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <p className="font-medium text-foreground">{title}</p>}
        {children && <div className="leading-relaxed text-pretty text-muted-foreground">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  outcome_statement: "Outcome",
  problem_statement: "Problem description",
  pilot_scope: "Pilot scope",
  application_deadline: "Application deadline",
  budget_ceiling_paise: "Budget ceiling",
  kpis: "Measures",
  criteria: "Evaluation criteria",
  proposal_summary: "Proposal summary",
  approach: "Approach",
  kpi_commitments: "Committed values",
  pilot_cost_paise: "Pilot cost",
  timeline_weeks: "Timeline",
  ip_declaration: "Intellectual property option",
  conflict_declaration: "Conflict of interest declaration",
  reason: "Reason",
  acknowledge: "Confirmation",
  cyber_checklist: "Cybersecurity checklist",
};

export function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  if (field.startsWith("kpis.")) return "Measure " + field.slice(5);
  if (field.startsWith("criteria.")) return "Criterion " + field.slice(9);
  if (field.startsWith("data_terms.")) return "Data term " + field.slice(11).replace(/_/g, " ");
  if (field.startsWith("checklist.")) return "Verification step";
  return field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function ProblemList({ problems, title = "These need attention before you can continue" }: { problems: (BlockingProblem | FieldError)[]; title?: string }) {
  if (!problems.length) return null;
  return (
    <Callout tone="destructive" title={title}>
      <ul className="mt-1 flex flex-col gap-1.5">
        {problems.map((problem, index) => (
          <li key={problem.field + index}>
            <span className="font-medium text-foreground">{fieldLabel(problem.field)}:</span> {problem.detail} <span className="opacity-80">{problem.fix}</span>
          </li>
        ))}
      </ul>
    </Callout>
  );
}

type SearchParams = Record<string, string | string[] | undefined> | undefined;

/** The result of the last action, carried in the query string so it survives a refresh. */
export function Flash({ searchParams }: { searchParams: SearchParams }) {
  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  if (!notice && !problem) return null;
  return (
    <div className="flex flex-col gap-3 animate-enter" aria-live="polite">
      {notice && <Callout tone="success" title={notice} />}
      {problem &&
        (problem.fields.length ? (
          <ProblemList problems={problem.fields} title={problem.message} />
        ) : (
          <Callout tone="destructive" title="That did not go through">
            {problem.message}
          </Callout>
        ))}
    </div>
  );
}

/** The error for one field from the last failed action, if any. */
export function fieldErrorFor(searchParams: SearchParams, field: string): string | undefined {
  const problem = readProblem(searchParams);
  const match = problem?.fields.find((entry) => entry.field === field);
  return match ? match.detail + (match.fix ? " " + match.fix : "") : undefined;
}

/* -------------------------------------------------------------------------- */
/* Empty and links                                                             */
/* -------------------------------------------------------------------------- */

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Empty className={cn("rounded-3xl border border-dashed bg-card/40 py-12", className)}>
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
  size = "default",
  className,
  external,
}: {
  href: string;
  children: ReactNode;
  variant?: "default" | "brand" | "secondary" | "outline" | "ghost" | "destructive" | "link";
  size?: "default" | "sm" | "lg";
  className?: string;
  external?: boolean;
}) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {children}
      </Link>
    </Button>
  );
}

/** A whole-row link used in lists of records. */
export function RowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-surface/70 focus-visible:bg-surface focus-visible:outline-none md:px-6",
        className,
      )}
    >
      {children}
      <ArrowUpRight className="ml-auto size-4 shrink-0 text-glyph opacity-0 transition-[opacity,translate] duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
    </Link>
  );
}

export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("divide-y divide-border/70", className)}>{children}</ul>;
}
