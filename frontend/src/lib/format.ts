/**
 * Display conventions from PRD 6.4: dates as DD MMM YYYY, times in IST, relative
 * deadlines in plain words, currency in rupees with Indian digit grouping.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const IST_OFFSET_MINUTES = 330;

function toIst(value: string | Date): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Date(date.getTime() + (IST_OFFSET_MINUTES + date.getTimezoneOffset()) * 60000);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const date = toIst(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return (
    String(date.getDate()).padStart(2, "0") +
    " " +
    MONTHS[date.getMonth()] +
    " " +
    date.getFullYear()
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not set";
  const date = toIst(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return (
    formatDate(value) +
    ", " +
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0") +
    " IST"
  );
}

/** "due in 3 days", "3 days overdue", "due today". */
export function relativeDeadline(value: string | null | undefined): string {
  if (!value) return "";
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return "";
  const diffDays = (target - Date.now()) / 86400000;

  if (diffDays < -1) return Math.round(-diffDays) + " days overdue";
  if (diffDays < 0) {
    const hours = Math.round(-diffDays * 24);
    return hours <= 1 ? "just overdue" : hours + " hours overdue";
  }
  if (diffDays < 1) {
    const hours = Math.floor(diffDays * 24);
    if (hours < 1) return "due within the hour";
    return "due in " + hours + (hours === 1 ? " hour" : " hours");
  }
  if (diffDays < 2) return "due tomorrow";
  return "due in " + Math.round(diffDays) + " days";
}

export function isOverdue(value: string | null | undefined): boolean {
  if (!value) return false;
  const target = new Date(value).getTime();
  return !Number.isNaN(target) && target < Date.now();
}

/** Indian digit grouping, for example 12,50,000.00. */
export function formatRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "Not set";
  const negative = paise < 0;
  const absolute = Math.abs(Math.round(paise));
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;

  let text = String(whole);
  if (text.length > 3) {
    const tail = text.slice(-3);
    let head = text.slice(0, -3);
    const parts: string[] = [];
    while (head.length > 2) {
      parts.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    if (head) parts.unshift(head);
    text = parts.join(",") + "," + tail;
  }
  const result = text + "." + String(fraction).padStart(2, "0");
  return (negative ? "-" : "") + result;
}

export function money(value: { paise: number; display?: string } | null | undefined): string {
  if (!value) return "Not set";
  return "INR " + (value.display ?? formatRupees(value.paise));
}

/** A compact form for tables: 45.0 lakh, 2.8 crore. */
export function compactRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "Not set";
  const rupees = paise / 100;
  if (rupees >= 10000000) return "INR " + (rupees / 10000000).toFixed(2) + " crore";
  if (rupees >= 100000) return "INR " + (rupees / 100000).toFixed(1) + " lakh";
  return "INR " + formatRupees(paise);
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "Not available";
  return (value * 100).toFixed(digits) + " percent";
}

export function decimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "Not available";
  return value.toFixed(digits);
}

export function signed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "Not available";
  return (value > 0 ? "+" : "") + value.toFixed(digits);
}

/** Every state gets a sentence, so status is never carried by colour alone (PRD 6.4). */
export const CHALLENGE_STATE_LABELS: Record<string, string> = {
  Draft: "Draft",
  InReview: "Awaiting approval",
  Published: "Open for applications",
  ApplicationsClosed: "Applications closed",
  Screening: "Eligibility screening",
  Evaluation: "Under evaluation",
  Shortlisted: "Scores locked, shortlist pending",
  PilotDesign: "Pilot being designed",
  PilotActive: "Pilot running",
  Validation: "Awaiting independent validation",
  DecisionPending: "Awaiting scale decision",
  Scaled: "Scaled",
  Closed: "Closed",
  Cancelled: "Cancelled",
};

export const PILOT_STATE_LABELS: Record<string, string> = {
  AgreementDraft: "Agreement being drafted",
  AwaitingStartup: "Awaiting startup acceptance",
  Active: "Running",
  Paused: "Paused",
  Completed: "Complete",
  Terminated: "Terminated",
};

export const APPLICATION_STATE_LABELS: Record<string, string> = {
  Draft: "Draft",
  Submitted: "Submitted",
  Locked: "Locked at the deadline",
  Screened: "Screened",
  UnderEvaluation: "Under evaluation",
  Shortlisted: "Shortlisted",
  NotShortlisted: "Not shortlisted",
  Withdrawn: "Withdrawn",
};

export const ROLE_LABELS: Record<string, string> = {
  DO: "Department Officer",
  DA: "Department Approver",
  SU: "Startup User",
  EE: "Expert Evaluator",
  IV: "Independent Validator",
  FO: "Finance Officer",
  PA: "Platform Admin",
};

export const ANALYSIS_METHOD_LABELS: Record<string, string> = {
  paired_t: "Paired comparison of the same units before and after",
  wilcoxon: "Paired rank comparison of the same units before and after",
  welch_did: "Pilot units compared against similar non-pilot units",
  two_proportion: "Comparison of two rates",
};

export const IP_OPTION_LABELS: Record<string, string> = {
  startup_retains: "Startup retains ownership, government gets a licence to use",
  joint: "Joint ownership of what is built for this pilot",
  government_owned: "Government owns the bespoke work",
};

export function stateLabel(map: Record<string, string>, state: string): string {
  return map[state] ?? state;
}

export function bandTone(band: string | null | undefined): "good" | "warn" | "bad" | "neutral" {
  if (band === "Strong") return "good";
  if (band === "Moderate") return "warn";
  if (band === "Weak") return "bad";
  return "neutral";
}

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).trimEnd() + "...";
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/** Two initials for an avatar, skipping honorifics: "Dr Anjali Rao" is "AR". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part && !/^(prof(essor)?|dr|shri|smt)\.?$/i.test(part))
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}
