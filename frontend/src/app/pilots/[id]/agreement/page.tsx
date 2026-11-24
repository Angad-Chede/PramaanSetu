import type { Metadata } from "next";
import Link from "next/link";

import {
  completeCyberChecklist,
  draftAgreement,
  pilotTransition,
} from "@/app/pilots/actions";
import { Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  Field,
  Hash,
  KeyValue,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { IP_OPTION_LABELS, PILOT_STATE_LABELS, formatDate, money } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Agreement, Pilot } from "@/lib/types";

export const metadata: Metadata = { title: "Pilot agreement" };
export const dynamic = "force-dynamic";

type Defaults = {
  milestones: {
    seq: number;
    title: string;
    deliverable: string;
    evidence_required: string;
    amount_rupees: number;
    due_date: string;
  }[];
  data_terms_fields: { key: string; label: string; required: boolean; note?: string }[];
  data_terms_defaults: Record<string, string | number>;
  ip_options: { code: string; label: string; plain_language: string; text: string }[];
  cyber_checklist: { key: string; label: string; required: boolean }[];
  exit_plan_fields: { key: string; label: string; required: boolean }[];
  sla: { accept_days: number; approve_days: number; release_days: number };
  note: string;
};

function toDateInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export default async function AgreementPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/pilots/" + params.id + "/agreement");
  const pilot = await apiGetOrNotFound<Pilot>("/pilots/" + params.id);
  const versions = await apiGet<{ items: Agreement[] }>("/pilots/" + params.id + "/agreements");
  const defaults = await apiGetOptional<Defaults>("/pilots/" + params.id + "/agreement/defaults");

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);

  const isOfficer = hasRole(session, "DO") && session.department_id === pilot.department_id;
  const isApprover = hasRole(session, "DA") && session.department_id === pilot.department_id;
  const isStartup = session.startup_id === pilot.startup_id;
  const latest = versions.items.length ? versions.items[versions.items.length - 1] : null;
  const actions = pilot.available_actions ?? [];
  const cyberDone = Boolean(pilot.cyber_completed_at);
  const planFrozen = Boolean(pilot.design?.frozen);

  return (
    <div>
      <PageHeader
        title="Pilot agreement"
        subtitle="Assembled from the Template Kit. Every version is kept and diffable, and acceptance records the hash of the exact document accepted."
        meta={
          <>
            <Pill>{pilot.reference}</Pill>
            <Pill>{PILOT_STATE_LABELS[pilot.state] ?? pilot.state}</Pill>
            {latest ? <Pill>Version {latest.number}</Pill> : <Pill tone="warn">No version yet</Pill>}
          </>
        }
        actions={
          <>
            {latest?.pdf_file_id ? (
              <a href={"/api/v1/files/" + latest.pdf_file_id} className="btn btn-secondary">
                Download the agreement
              </a>
            ) : null}
            <Link href={"/pilots/" + pilot.id} className="btn btn-secondary">
              Back to the pilot
            </Link>
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
          <Callout tone="bad" title="That could not be completed">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {latest ? (
        <Section title={"Version " + latest.number}>
          <KeyValue
            rows={[
              {
                label: "Intellectual property",
                value: IP_OPTION_LABELS[latest.ip_option] ?? latest.ip_option,
              },
              { label: "Drafted", value: <Timestamp value={null} /> },
              { label: "Approved", value: <Timestamp value={latest.approved_at} /> },
              { label: "Accepted", value: <Timestamp value={latest.accepted_at} /> },
              { label: "Signature reference", value: latest.esign_reference ?? "Not signed yet" },
              { label: "Document hash", value: <Hash value={latest.sha256} /> },
            ]}
          />

          <h3 className="mb-2 mt-5">Milestones and payment</h3>
          <DataTable columns={["No.", "Deliverable", "Evidence required", "Due", "Amount"]}>
            {latest.milestones.map((milestone) => (
              <tr key={milestone.seq}>
                <td className="num">{milestone.seq}</td>
                <td>
                  <p className="font-medium">{milestone.title}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">{milestone.deliverable}</p>
                </td>
                <td className="max-w-sm text-sm text-ink-muted">{milestone.evidence_required}</td>
                <td className="whitespace-nowrap text-sm">{formatDate(milestone.due_date)}</td>
                <td className="num text-sm">{money({ paise: milestone.amount_paise })}</td>
              </tr>
            ))}
          </DataTable>

          <h3 className="mb-2 mt-5">Data-sharing schedule</h3>
          <DataTable columns={["Term", "Agreed position"]}>
            {Object.entries(latest.data_terms).map(([key, value]) => (
              <tr key={key}>
                <td className="whitespace-nowrap font-medium">{key.replace(/_/g, " ")}</td>
                <td className="text-sm text-ink-soft">{String(value)}</td>
              </tr>
            ))}
          </DataTable>

          {latest.template_versions && Object.keys(latest.template_versions).length ? (
            <p className="mt-4 text-sm text-ink-muted">
              Template versions used:{" "}
              {Object.entries(latest.template_versions)
                .map(([kind, version]) => kind.replace(/_/g, " ") + " " + version)
                .join(", ")}
              . Drafted from public guidance and reviewed by the department legal cell before
              execution. This is not legal advice.
            </p>
          ) : null}
        </Section>
      ) : null}

      {isStartup ? (
        <Section
          title="Cybersecurity checklist"
          description="Every required control must be confirmed before the pilot can be activated. These controls must be maintained for the whole pilot period."
        >
          {cyberDone ? (
            <Callout tone="good" title="Checklist complete">
              Submitted <Timestamp value={pilot.cyber_completed_at} />. It is recorded as a schedule
              to the agreement.
            </Callout>
          ) : defaults ? (
            <form action={completeCyberChecklist} className="space-y-4">
              <input type="hidden" name="pilot_id" value={pilot.id} />
              <ul className="space-y-2">
                {defaults.cyber_checklist.map((item) => (
                  <li key={item.key} className="flex items-start gap-3 rounded border border-line px-3 py-2">
                    <input type="hidden" name="control_key" value={item.key} />
                    <input
                      id={"control_" + item.key}
                      name={"control_" + item.key}
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <label htmlFor={"control_" + item.key} className="font-normal">
                      {item.label}
                      {item.required ? <span className="ml-1 text-bad">(required)</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
              <SubmitButton pendingLabel="Submitting...">Submit the checklist</SubmitButton>
            </form>
          ) : null}
        </Section>
      ) : null}

      {isApprover && actions.includes("approve-agreement") ? (
        <Section
          title="Approve the agreement"
          description="Read the terms, the milestone schedule and the data clauses. Approving sends it to the startup for acceptance."
        >
          <form action={pilotTransition}>
            <input type="hidden" name="pilot_id" value={pilot.id} />
            <input type="hidden" name="action" value="approve-agreement" />
            <input type="hidden" name="back" value={"/pilots/" + pilot.id + "/agreement"} />
            <SubmitButton
              pendingLabel="Approving..."
              confirm="Approve this agreement? It goes to the startup for acceptance, and the pilot starts when they accept."
            >
              Approve the agreement
            </SubmitButton>
          </form>
        </Section>
      ) : null}

      {isStartup && actions.includes("accept-agreement") ? (
        <Section
          title="Accept the agreement"
          description="Acceptance is recorded with your name, the server time and the hash of the exact document, which is what the audit trail needs."
        >
          {!cyberDone ? (
            <Callout tone="warn" title="Complete the cybersecurity checklist first">
              The pilot cannot be activated until every required control is confirmed.
            </Callout>
          ) : !planFrozen ? (
            <Callout tone="warn" title="The pre-registered plan has not been frozen">
              The department must freeze the pilot design before the pilot can start.
            </Callout>
          ) : (
            <div className="space-y-4">
              <Callout tone="neutral" title="What you are agreeing to">
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    The pre-registered plan forms part of this agreement and cannot change after the
                    pilot starts without an approved, recorded amendment.
                  </li>
                  <li>
                    You will submit measurements at the agreed frequency and cooperate fully with the
                    independent validator, including providing raw data on request.
                  </li>
                  <li>
                    You will maintain the cybersecurity controls you confirmed, and report any
                    incident affecting departmental data within 24 hours.
                  </li>
                  <li>
                    On exit you will hand over an export of all departmental data in a documented
                    open format within 15 days, and delete your copies within 30.
                  </li>
                </ul>
              </Callout>
              <form action={pilotTransition}>
                <input type="hidden" name="pilot_id" value={pilot.id} />
                <input type="hidden" name="action" value="accept-agreement" />
                <input type="hidden" name="back" value={"/pilots/" + pilot.id + "/agreement"} />
                <SubmitButton
                  pendingLabel="Accepting..."
                  confirm="Accept this agreement? The pilot becomes active and the pre-registered plan is locked."
                >
                  Accept and start the pilot
                </SubmitButton>
              </form>
              <Disclosure summary="Request changes instead">
                <form action={pilotTransition} className="space-y-3">
                  <input type="hidden" name="pilot_id" value={pilot.id} />
                  <input type="hidden" name="action" value="request-changes" />
                  <input type="hidden" name="back" value={"/pilots/" + pilot.id + "/agreement"} />
                  <Field label="What needs to change, and why" name="change_reason" required>
                    <textarea id="change_reason" name="reason" rows={3} required minLength={10} />
                  </Field>
                  <SubmitButton variant="secondary">Request changes</SubmitButton>
                </form>
              </Disclosure>
            </div>
          )}
        </Section>
      ) : null}

      {isOfficer && defaults && ["AgreementDraft"].includes(pilot.state) ? (
        <Section
          title={latest ? "Issue a revised version" : "Draft the agreement"}
          description={defaults.note}
        >
          <form action={draftAgreement} className="space-y-5">
            <input type="hidden" name="pilot_id" value={pilot.id} />

            <Field label="Intellectual property option" name="ip_option" required>
              <select id="ip_option" name="ip_option" defaultValue={latest?.ip_option ?? "startup_retains"}>
                {defaults.ip_options.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="space-y-2">
              {defaults.ip_options.map((option) => (
                <p key={option.code} className="text-sm text-ink-muted">
                  <span className="font-medium text-ink">{option.label}.</span>{" "}
                  {option.plain_language}
                </p>
              ))}
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">Data-sharing schedule</legend>
              <div className="max-w-form space-y-3">
                {defaults.data_terms_fields
                  .filter((field) => field.key !== "retention_months")
                  .map((field) => (
                    <Field
                      key={field.key}
                      label={field.label}
                      name={"data_" + field.key}
                      required={field.required}
                      help={field.note}
                    >
                      <textarea
                        id={"data_" + field.key}
                        name={"data_" + field.key}
                        rows={2}
                        defaultValue={
                          (latest?.data_terms?.[field.key] as string) ??
                          String(defaults.data_terms_defaults[field.key] ?? "")
                        }
                      />
                    </Field>
                  ))}
                <Field label="Retention period in months" name="data_retention_months" required>
                  <input
                    id="data_retention_months"
                    name="data_retention_months"
                    type="number"
                    min={1}
                    max={120}
                    defaultValue={Number(defaults.data_terms_defaults.retention_months ?? 12)}
                  />
                </Field>
                <Field
                  label="Export format"
                  name="data_export_format"
                  help="An open, documented format keeps the Vendor Dependency Score low."
                >
                  <input
                    id="data_export_format"
                    name="data_export_format"
                    defaultValue={
                      (latest?.data_terms?.export_format as string) ??
                      "CSV with a documented schema, plus raw records in open JSON."
                    }
                  />
                </Field>
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">Milestones</legend>
              <p className="help mb-3">
                Between 2 and 6. At least one must fall due before pilot completion, so the startup
                is paid during the pilot and not only after it. The department accepts or rejects
                within {defaults.sla.accept_days} days, the approver clears payment within{" "}
                {defaults.sla.approve_days}, and the finance office records release within{" "}
                {defaults.sla.release_days}.
              </p>
              <div className="space-y-4">
                {(latest?.milestones?.length
                  ? latest.milestones.map((m) => ({
                      seq: m.seq,
                      title: m.title,
                      deliverable: m.deliverable,
                      evidence_required: m.evidence_required,
                      amount_rupees: m.amount_paise / 100,
                      due_date: m.due_date,
                    }))
                  : defaults.milestones
                ).map((milestone, index) => (
                  <div key={index} className="rounded border border-line bg-paper-soft p-4">
                    <input type="hidden" name="milestone_seq" value={milestone.seq} />
                    <div className="grid gap-4 sm:grid-cols-[1fr,10rem,10rem]">
                      <Field label="Title" name={"milestone_title_" + index}>
                        <input
                          id={"milestone_title_" + index}
                          name="milestone_title"
                          defaultValue={milestone.title}
                        />
                      </Field>
                      <Field label="Amount in rupees" name={"milestone_amount_" + index}>
                        <input
                          id={"milestone_amount_" + index}
                          name="milestone_amount"
                          type="number"
                          min={0}
                          defaultValue={milestone.amount_rupees}
                        />
                      </Field>
                      <Field label="Due date" name={"milestone_due_" + index}>
                        <input
                          id={"milestone_due_" + index}
                          name="milestone_due"
                          type="date"
                          defaultValue={toDateInput(milestone.due_date)}
                        />
                      </Field>
                    </div>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <Field label="Deliverable" name={"milestone_deliverable_" + index}>
                        <textarea
                          id={"milestone_deliverable_" + index}
                          name="milestone_deliverable"
                          rows={2}
                          defaultValue={milestone.deliverable}
                        />
                      </Field>
                      <Field
                        label="Evidence required"
                        name={"milestone_evidence_" + index}
                        help="A rejection must cite the part of this requirement that was not met."
                      >
                        <textarea
                          id={"milestone_evidence_" + index}
                          name="milestone_evidence"
                          rows={2}
                          defaultValue={milestone.evidence_required}
                        />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>

            {latest ? (
              <Field label="What changed in this version" name="change_note">
                <textarea id="change_note" name="change_note" rows={2} />
              </Field>
            ) : null}

            <SubmitButton pendingLabel="Drafting...">
              {latest ? "Issue a revised version" : "Draft the agreement"}
            </SubmitButton>
          </form>
        </Section>
      ) : null}

      {versions.items.length > 1 ? (
        <Section
          title="Version history"
          description="Every revision is kept, with the differences from the version before it."
        >
          <div className="space-y-5">
            {versions.items
              .slice()
              .reverse()
              .map((version) => (
                <div key={version.id} className="rounded border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3>Version {version.number}</h3>
                    <div className="flex flex-wrap gap-2">
                      {version.approved_at ? <Pill tone="good">Approved</Pill> : null}
                      {version.accepted_at ? <Pill tone="good">Accepted</Pill> : null}
                      {version.change_request ? <Pill tone="warn">Changes requested</Pill> : null}
                    </div>
                  </div>
                  {version.change_request ? (
                    <p className="mt-2 text-sm text-ink-soft">
                      Startup requested: {version.change_request}
                    </p>
                  ) : null}
                  {version.changes_from_previous.length ? (
                    <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                      {version.changes_from_previous.map((change, index) => (
                        <li key={index}>
                          {change.field}: {String(change.from)} to {String(change.to)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-ink-muted">First version.</p>
                  )}
                  <p className="mt-2">
                    <Hash value={version.sha256} />
                  </p>
                </div>
              ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
