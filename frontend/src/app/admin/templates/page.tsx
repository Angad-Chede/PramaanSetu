import type { Metadata } from "next";

import { installTemplates } from "@/app/actions";
import { Disclosure, SubmitButton } from "@/components/forms";
import { Callout, DataTable, PageHeader, Pill, Section } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { readNotice } from "@/lib/forms";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Template Kit" };
export const dynamic = "force-dynamic";

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

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession("/admin/templates");
  const body = await apiGet<{ items: Template[]; note: string }>("/admin/templates");
  const notice = readNotice(searchParams);

  return (
    <div>
      <PageHeader
        title="Template Kit"
        subtitle={body.note}
        meta={<Pill>{body.items.length} template version{body.items.length === 1 ? "" : "s"}</Pill>}
        actions={
          <form action={installTemplates}>
            <SubmitButton variant="secondary">Install any missing versions</SubmitButton>
          </form>
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}

      <div className="mb-5">
        <Callout tone="warn" title="These are drafts for legal review">
          Every template is drafted from publicly available guidance, including the General
          Financial Rules, 2017, the procurement manuals and the Digital Personal Data Protection
          Act, 2023. They support, and do not replace, the judgement of the department legal cell.
        </Callout>
      </div>

      <Section title="Installed templates">
        <DataTable columns={["Kind", "Title", "Version", "Published", "What it is for"]}>
          {body.items.map((template) => (
            <tr key={template.id}>
              <td className="font-medium">{titleCase(template.kind)}</td>
              <td className="text-sm">{template.title}</td>
              <td className="num text-sm">
                {template.version}
                {template.superseded_at ? (
                  <span className="ml-2">
                    <Pill tone="warn">Superseded</Pill>
                  </span>
                ) : (
                  <span className="ml-2">
                    <Pill tone="good">Current</Pill>
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap text-sm">{formatDate(template.published_at)}</td>
              <td className="max-w-md text-sm text-ink-muted">
                {KIND_PURPOSE[template.kind] ?? ""}
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section
        title="Template contents"
        description="What each version actually says. A challenge or an agreement records the exact versions it used, so a reviewer years later can reconstruct what was agreed."
      >
        <div className="space-y-3">
          {body.items.map((template) => (
            <Disclosure
              key={template.id}
              summary={titleCase(template.kind) + " version " + template.version}
            >
              <p className="mb-3 text-xs text-ink-muted">{template.source_note}</p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-paper-sunk p-3 text-xs">
                {JSON.stringify(template.body, null, 2)}
              </pre>
            </Disclosure>
          ))}
        </div>
      </Section>
    </div>
  );
}
