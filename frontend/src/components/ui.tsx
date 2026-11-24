import Link from "next/link";
import type { ReactNode } from "react";

import { formatDateTime, relativeDeadline } from "@/lib/format";
import type { BlockingProblem, FieldError } from "@/lib/types";

/** Plain building blocks. One screen, one job; status is always spelled out in words. */

export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
}: {
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1>{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-prose text-ink-muted">{subtitle}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2 no-print">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  description,
  children,
  actions,
  id,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="card mb-5">
      <div className="flex flex-col gap-2 rounded-t-lg border-b border-line bg-paper-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2>{title}</h2>
          {description ? <p className="mt-0.5 max-w-prose text-sm text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2 no-print">{actions}</div> : null}
      </div>
      <div className="card-pad">{children}</div>
    </section>
  );
}

export function Pill({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad";
  /** A status dot, which restates the tone the words already carry, never replaces it. */
  dot?: boolean;
  children: ReactNode;
}) {
  const cls = {
    neutral: "pill pill-neutral",
    good: "pill pill-good",
    warn: "pill pill-warn",
    bad: "pill pill-bad",
  }[tone];
  return (
    <span className={cls}>
      {dot ? <span className="pill-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function StatusPill({ state, label }: { state: string; label: string }) {
  const good = ["Published", "Active", "Paid", "Scaled", "SignedOff", "Eligible", "Accepted"];
  const bad = ["Cancelled", "Terminated", "Refused", "Ineligible", "Rejected", "NotShortlisted"];
  const warn = [
    "InReview", "AwaitingStartup", "Paused", "NeedsReview", "AwaitingValidation",
    "DecisionPending", "Submitted", "PaymentApproved",
  ];
  const tone = good.includes(state) ? "good" : bad.includes(state) ? "bad" : warn.includes(state) ? "warn" : "neutral";
  return (
    <Pill tone={tone} dot>
      {label}
    </Pill>
  );
}

export function KeyValue({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="stat-label">{row.label}</dt>
          <dd className="mt-1 text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataTable({
  columns,
  children,
  empty,
  caption,
}: {
  columns: string[];
  children: ReactNode;
  empty?: string;
  caption?: string;
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (!hasRows && empty) {
    return <EmptyState message={empty} />;
  }
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0 sm:overflow-hidden sm:rounded-lg sm:border sm:border-line">
      <table>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-paper-soft px-4 py-10 text-center">
      <p className="mx-auto max-w-prose text-ink-muted">{message}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad";
  title?: string;
  children: ReactNode;
}) {
  const border = {
    neutral: "border-line-strong bg-paper-soft",
    good: "border-good bg-good-light",
    warn: "border-warn bg-warn-light",
    bad: "border-bad bg-bad-light",
  }[tone];
  const textTone = {
    neutral: "text-ink",
    good: "text-good",
    warn: "text-warn",
    bad: "text-bad",
  }[tone];
  return (
    <div
      className={"rounded-lg border border-l-4 px-4 py-3 " + border}
      role={tone === "bad" ? "alert" : undefined}
    >
      {title ? <p className={"font-semibold " + textTone}>{title}</p> : null}
      <div className={"text-sm " + (title ? "mt-1 " : "") + "text-ink-soft"}>{children}</div>
    </div>
  );
}

export function ProblemList({
  problems,
  title = "These items need attention before you can continue",
}: {
  problems: (BlockingProblem | FieldError)[];
  title?: string;
}) {
  if (!problems.length) return null;
  return (
    <Callout tone="bad" title={title}>
      <ul className="space-y-2">
        {problems.map((problem, index) => (
          <li key={problem.field + index}>
            <span className="font-medium text-ink">{fieldLabel(problem.field)}:</span> {problem.detail}{" "}
            <span className="text-ink-muted">{problem.fix}</span>
          </li>
        ))}
      </ul>
    </Callout>
  );
}

export function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
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
  if (labels[field]) return labels[field];
  if (field.startsWith("kpis.")) return "Measure " + field.slice(5);
  if (field.startsWith("criteria.")) return "Criterion " + field.slice(9);
  if (field.startsWith("data_terms.")) return "Data term " + field.slice(11).replace(/_/g, " ");
  if (field.startsWith("checklist.")) return "Verification step";
  return field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function Deadline({ value, label = "Due" }: { value: string | null; label?: string }) {
  if (!value) return <span className="text-ink-muted">No deadline set</span>;
  const relative = relativeDeadline(value);
  const overdue = relative.includes("overdue");
  return (
    <span className={overdue ? "text-bad" : "text-ink"}>
      {label} {formatDateTime(value)}
      <span className={"ml-2 " + (overdue ? "font-semibold" : "text-ink-muted")}>({relative})</span>
    </span>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "secondary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <Link href={href} className={"btn btn-" + variant}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  name,
  help,
  error,
  children,
  required,
}: {
  label: string;
  name: string;
  help?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>
        {label}
        {required ? <span className="ml-1 text-bad">(required)</span> : null}
      </label>
      {help ? (
        <p id={name + "-help"} className="help">
          {help}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={name + "-error"} className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Meter({
  value,
  max,
  label,
  tone = "neutral",
}: {
  value: number;
  max: number;
  label: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const fill = {
    neutral: "bg-ink-soft",
    good: "bg-good",
    warn: "bg-warn",
    bad: "bg-bad",
  }[tone];
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-soft">{label}</span>
        <span className="num text-ink">
          {value} of {max}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-paper-sunk"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          className={"h-full rounded-full transition-[width] " + fill}
          style={{ width: (share * 100).toFixed(1) + "%" }}
        />
      </div>
    </div>
  );
}

export function Definition({ term, children }: { term: string; children: ReactNode }) {
  return (
    <p className="text-sm">
      <span className="font-medium text-ink">{term}.</span>{" "}
      <span className="text-ink-muted">{children}</span>
    </p>
  );
}

export function Timestamp({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-muted">Not recorded</span>;
  return <time dateTime={value}>{formatDateTime(value)}</time>;
}

export function Hash({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-ink-muted">Not recorded</span>;
  return (
    <span className="num break-all text-xs text-ink-muted" title={value}>
      {value}
    </span>
  );
}
