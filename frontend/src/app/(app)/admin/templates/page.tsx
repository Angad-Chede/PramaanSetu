import type { Metadata } from "next";
import {
  AlertOctagon,
  BookOpenCheck,
  ClipboardList,
  DoorOpen,
  Download,
  FileSignature,
  Lightbulb,
  Scale,
  ShieldCheck,
  Table2,
  type LucideIcon,
} from "lucide-react";

import { installTemplates } from "@/app/actions";
import { Disclosure, SubmitButton } from "@/components/app/forms";
import { Callout, Flash, Page, PageHeader, ToneBadge } from "@/components/app/kit";
import { Badge } from "@/components/ui/badge";
import { all, apiGet } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Template Kit" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

type Template = {
  id: string;
  kind: string;
  version: string;
  locale: string;
  title: string;
  published_at: string;
  superseded_at: string | null;
  source_note: string;
  body: Record<string, unknown>;
};

const KIND_PURPOSE: Record<string, string> = {
  problem_statement: "Structures a challenge into a problem, a current situation, an outcome, constraints, scope and commercial terms.",
  evaluation_rubric: "Sets the anchored 1 to 5 scale, the blind round-one rule and the variance flag threshold.",
  pilot_agreement: "The twelve clauses of the controlled pilot agreement.",
  data_sharing: "The data-sharing schedule: datasets, identifiers removed, storage location, retention and deletion.",
  ip_clause: "The three intellectual property options, each with a plain-language explanation.",
  cyber_checklist: "The controls a startup must confirm before a pilot can be activated.",
  risk_register: "Starter risks with owners, mitigations and the trigger that means the risk has arrived.",
  exit_plan: "What must be true for the department to leave: export format, transition, alternatives and deletion.",
};

const KIND_ICON: Record<string, LucideIcon> = {
  problem_statement: Lightbulb,
  evaluation_rubric: Scale,
  pilot_agreement: FileSignature,
  data_sharing: Table2,
  ip_clause: BookOpenCheck,
  cyber_checklist: ShieldCheck,
  risk_register: AlertOctagon,
  exit_plan: DoorOpen,
};

const KIND_ORDER = ["problem_statement", "evaluation_rubric", "pilot_agreement", "data_sharing", "ip_clause", "cyber_checklist", "risk_register", "exit_plan"];

function sizeOf(body: Record<string, unknown>): string {
  const parts = Object.entries(body).map(([key, value]) => {
    const count = Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : null;
    return count === null ? null : `${count} ${key.replace(/_/g, " ")}`;
  });
  return parts.filter(Boolean).slice(0, 2).join(", ");
}

export default async function TemplatesPage({ searchParams }: Props) {
  const params = await searchParams;
  const [, body] = await all(requireSession("/admin/templates"), apiGet<{ items: Template[]; note: string }>("/admin/templates"));

  const items = [...body.items].sort((a, b) => {
    const order = (kind: string) => (KIND_ORDER.indexOf(kind) === -1 ? 99 : KIND_ORDER.indexOf(kind));
    return order(a.kind) - order(b.kind) || b.version.localeCompare(a.version);
  });
  const current = items.filter((template) => !template.superseded_at).length;

  return (
    <Page width="wide">
      <PageHeader
        title="Template Kit"
        description={body.note}
        meta={
          <>
            <Badge variant="secondary" className="tabular-nums">
              {items.length} template version{items.length === 1 ? "" : "s"}
            </Badge>
            <ToneBadge tone="success">{current} current</ToneBadge>
          </>
        }
        actions={
          <form action={installTemplates}>
            <SubmitButton variant="secondary" pendingLabel="Installing">
              <Download />
              Install any missing versions
            </SubmitButton>
          </form>
        }
      />

      <Flash searchParams={params} />

      <Callout tone="warning" title="These are drafts for legal review">
        Every template is drafted from publicly available guidance, including the General Financial Rules, 2017, the procurement manuals and the Digital Personal Data Protection
        Act, 2023. They support, and do not replace, the judgement of the department legal cell.
      </Callout>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((template) => {
          const Icon = KIND_ICON[template.kind] ?? ClipboardList;
          const size = sizeOf(template.body);
          return (
            <article key={template.id} className="flex min-w-0 flex-col gap-4 rounded-3xl bg-card p-5 shadow-card md:p-6">
              <div className="flex items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface text-foreground shadow-lift">
                  <Icon className="size-5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">{titleCase(template.kind)}</span>
                  </div>
                  <h2 className="font-display text-base font-semibold tracking-tight text-pretty">{template.title}</h2>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="rounded-lg bg-surface px-2 py-0.5 font-mono text-[12px] text-foreground">v{template.version}</span>
                  <ToneBadge tone={template.superseded_at ? "warning" : "success"}>{template.superseded_at ? "Superseded" : "Current"}</ToneBadge>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{KIND_PURPOSE[template.kind] ?? template.source_note}</p>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground tabular-nums">
                <span>Published {formatDate(template.published_at)}</span>
                {template.superseded_at && <span>Superseded {formatDate(template.superseded_at)}</span>}
                <span className="uppercase">{template.locale}</span>
                {size && <span>{size}</span>}
              </div>

              <Disclosure summary="Read this version" className="mt-auto">
                <p className="mb-3 text-[12px] text-muted-foreground">{template.source_note}</p>
                <pre className="max-h-96 overflow-auto rounded-xl bg-recess/70 p-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-foreground/85">
                  {JSON.stringify(template.body, null, 2)}
                </pre>
              </Disclosure>
            </article>
          );
        })}
      </div>
    </Page>
  );
}
