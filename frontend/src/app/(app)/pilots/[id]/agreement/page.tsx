import type { Metadata } from "next";
import { Check, Clock, Download, FileSignature, FileText, GitCommitVertical, ShieldCheck, Stamp, UserCheck } from "lucide-react";

import { completeCyberChecklist, draftAgreement, pilotTransition } from "@/app/pilots/actions";
import { CheckField, Disclosure, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/app/forms";
import {
  Callout,
  EmptyState,
  Flash,
  Hash,
  Page,
  PageHeader,
  Panel,
  StateBadge,
  ToneBadge,
} from "@/components/app/kit";
import { Button } from "@/components/ui/button";
import { all, apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { cn } from "@/lib/utils";
import { IP_OPTION_LABELS, PILOT_STATE_LABELS, formatDate, formatDateTime, money } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import type { Agreement, Pilot } from "@/lib/types";

import { LifecycleTrack } from "../_components/lifecycle";
import { pilotStages } from "../_components/stages";

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

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SEGMENT_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-5", "bg-chart-4", "bg-glyph"];

function toDateInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function humanize(key: string): string {
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function AgreementPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [session, pilot, versions, defaults] = await all(
    requireSession("/pilots/" + id + "/agreement"),
    apiGetOrNotFound<Pilot>("/pilots/" + id),
    apiGet<{ items: Agreement[] }>("/pilots/" + id + "/agreements"),
    apiGetOptional<Defaults>("/pilots/" + id + "/agreement/defaults"),
  );

  const isOfficer = hasRole(session, "DO") && session.department_id === pilot.department_id;
  const isApprover = hasRole(session, "DA") && session.department_id === pilot.department_id;
  const isStartup = session.startup_id === pilot.startup_id;
  const latest = versions.items.length ? versions.items[versions.items.length - 1] : null;
  const actions = pilot.available_actions ?? [];
  const cyberDone = Boolean(pilot.cyber_completed_at);
  const planFrozen = Boolean(pilot.design?.frozen);
  const canDraft = isOfficer && defaults && pilot.state === "AgreementDraft";
  const termLabels = Object.fromEntries((defaults?.data_terms_fields ?? []).map((field) => [field.key, field.label]));
  const ipOption = latest ? defaults?.ip_options.find((option) => option.code === latest.ip_option) : undefined;
  const totalPaise = latest ? latest.milestones.reduce((sum, milestone) => sum + milestone.amount_paise, 0) : 0;

  const steps = [
    { key: "drafted", label: "Drafted by the department", icon: FileText, at: null as string | null, done: Boolean(latest) },
    { key: "approved", label: "Approved by the approver", icon: Stamp, at: latest?.approved_at ?? null, done: Boolean(latest?.approved_at) },
    { key: "accepted", label: "Accepted by the startup", icon: UserCheck, at: latest?.accepted_at ?? null, done: Boolean(latest?.accepted_at) },
  ];
  const currentStep = steps.findIndex((step) => !step.done);

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/pilots/" + pilot.id, label: "Back to the pilot" }}
        eyebrow={
          <>
            <span className="font-mono text-[12px]">{pilot.reference}</span>
            <StateBadge state={pilot.state} labels={PILOT_STATE_LABELS} />
            {latest ? (
              <ToneBadge tone="neutral" dot={false}>
                Version {latest.number}
              </ToneBadge>
            ) : (
              <ToneBadge tone="warning">No version yet</ToneBadge>
            )}
          </>
        }
        title="Pilot agreement"
        description="Assembled from the Template Kit. Every version is kept and diffable, and acceptance records the hash of the exact document accepted."
        actions={
          latest?.pdf_file_id ? (
            <Button asChild variant="secondary">
              <a href={"/api/v1/files/" + latest.pdf_file_id}>
                <Download />
                Download the agreement
              </a>
            </Button>
          ) : null
        }
      />

      <Flash searchParams={query} />

      <LifecycleTrack stages={pilotStages(pilot)} active="agreement" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {latest ? (
            <article className="overflow-hidden rounded-3xl bg-card shadow-card">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-5 md:px-7">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-2xl bg-surface text-glyph shadow-lift">
                    <FileSignature className="size-[18px]" />
                  </span>
                  <div>
                    <h2 className="font-display text-lg font-semibold tracking-tight">Version {latest.number}</h2>
                    <p className="text-[13px] text-muted-foreground">
                      {latest.esign_reference ? "Signed, reference " + latest.esign_reference : "Not signed yet"}
                    </p>
                  </div>
                </div>
                <Hash value={latest.sha256} />
              </header>

              <div className="flex flex-col gap-8 px-5 py-6 md:px-7">
                <section className="flex flex-col gap-3">
                  <SectionLabel number="1" title="Intellectual property" />
                  <div className="rounded-2xl bg-surface/70 p-4">
                    <p className="font-medium text-foreground">{IP_OPTION_LABELS[latest.ip_option] ?? latest.ip_option}</p>
                    {ipOption ? <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{ipOption.plain_language}</p> : null}
                  </div>
                </section>

                <section className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <SectionLabel number="2" title="Milestones and payment" />
                    <span className="text-sm text-muted-foreground tabular-nums">
                      Total <span className="font-medium text-foreground">{money({ paise: totalPaise })}</span>
                    </span>
                  </div>
                  {totalPaise ? (
                    <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
                      {latest.milestones.map((milestone, index) => (
                        <div
                          key={milestone.seq}
                          className={cn("h-full first:rounded-l-full last:rounded-r-full", SEGMENT_COLORS[index % SEGMENT_COLORS.length])}
                          style={{ width: (milestone.amount_paise / totalPaise) * 100 + "%" }}
                        />
                      ))}
                    </div>
                  ) : null}
                  <ol className="flex flex-col">
                    {latest.milestones.map((milestone, index) => (
                      <li key={milestone.seq} className="relative flex gap-4 pb-5 last:pb-0">
                        {index < latest.milestones.length - 1 && <span aria-hidden className="absolute top-8 bottom-0 left-[13px] w-px bg-border" />}
                        <span
                          className={cn(
                            "relative z-10 grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white tabular-nums",
                            SEGMENT_COLORS[index % SEGMENT_COLORS.length],
                          )}
                        >
                          {milestone.seq}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <p className="font-medium text-foreground">{milestone.title}</p>
                            <p className="text-sm font-medium whitespace-nowrap tabular-nums">{money({ paise: milestone.amount_paise })}</p>
                          </div>
                          <p className="text-sm leading-relaxed text-muted-foreground">{milestone.deliverable}</p>
                          <div className="flex flex-col gap-1 rounded-xl bg-surface/60 px-3 py-2 text-[13px] sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <span className="text-muted-foreground">
                              <span className="font-medium text-foreground">Evidence: </span>
                              {milestone.evidence_required}
                            </span>
                            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground">
                              <Clock className="size-3.5" />
                              Due {formatDate(milestone.due_date)}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="flex flex-col gap-3">
                  <SectionLabel number="3" title="Data-sharing schedule" />
                  <dl className="divide-y divide-border/70 rounded-2xl border border-border/70">
                    {Object.entries(latest.data_terms).map(([key, value]) => (
                      <div key={key} className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                        <dt className="text-[13px] font-medium text-foreground">{termLabels[key] ?? humanize(key)}</dt>
                        <dd className="text-[13px] leading-relaxed text-muted-foreground">
                          {key === "retention_months" ? String(value) + " months" : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>

                {latest.template_versions && Object.keys(latest.template_versions).length ? (
                  <footer className="flex flex-col gap-2 border-t border-border/70 pt-5">
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(latest.template_versions).map(([kind, version]) => (
                        <span key={kind} className="rounded-full bg-surface px-2.5 py-1 text-[12px] text-muted-foreground">
                          {humanize(kind)} <span className="font-mono">{version}</span>
                        </span>
                      ))}
                    </div>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                      Drafted from public guidance and reviewed by the department legal cell before execution. This is not legal advice.
                    </p>
                  </footer>
                ) : null}
              </div>
            </article>
          ) : !canDraft ? (
            <EmptyState
              icon={FileSignature}
              title="No agreement has been drafted"
              description="The officer drafts the agreement from the Template Kit, the approver approves it, and the startup accepts it. The pilot cannot start until then."
            />
          ) : null}

          {isStartup ? (
            <Panel
              title="Cybersecurity checklist"
              description="Every required control must be confirmed before the pilot can be activated, and kept in place for the whole pilot."
            >
              {cyberDone ? (
                <Callout tone="success" icon={ShieldCheck} title="Checklist complete">
                  Submitted {formatDateTime(pilot.cyber_completed_at)}. It is recorded as a schedule to the agreement.
                </Callout>
              ) : defaults ? (
                <form action={completeCyberChecklist} className="flex flex-col gap-4">
                  <input type="hidden" name="pilot_id" value={pilot.id} />
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {defaults.cyber_checklist.map((item) => (
                      <li key={item.key} className="rounded-2xl bg-surface/70 px-4 py-3">
                        <input type="hidden" name="control_key" value={item.key} />
                        <CheckField
                          name={"control_" + item.key}
                          label={
                            <span>
                              {item.label}
                              {item.required ? <span className="ml-1.5 text-[12px] font-normal text-destructive-ink">Required</span> : null}
                            </span>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                  <SubmitButton className="self-start" pendingLabel="Submitting">
                    <ShieldCheck />
                    Submit the checklist
                  </SubmitButton>
                </form>
              ) : null}
            </Panel>
          ) : null}

          {canDraft && defaults ? (
            <Panel title={latest ? "Issue a revised version" : "Draft the agreement"} description={defaults.note}>
              <form action={draftAgreement} className="flex flex-col gap-8">
                <input type="hidden" name="pilot_id" value={pilot.id} />

                <section className="flex flex-col gap-3">
                  <SectionLabel number="1" title="Intellectual property" />
                  <SelectField
                    label="Option"
                    name="ip_option"
                    required
                    defaultValue={latest?.ip_option ?? "startup_retains"}
                    options={defaults.ip_options.map((option) => ({ value: option.code, label: option.label }))}
                  />
                  <div className="grid gap-2 md:grid-cols-3">
                    {defaults.ip_options.map((option) => (
                      <div key={option.code} className="rounded-2xl bg-surface/70 p-3.5">
                        <p className="text-[13px] font-medium text-foreground">{option.label}</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{option.plain_language}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="flex flex-col gap-4">
                  <SectionLabel number="2" title="Data-sharing schedule" />
                  <div className="grid gap-4 md:grid-cols-2">
                    {defaults.data_terms_fields
                      .filter((field) => field.key !== "retention_months")
                      .map((field) => (
                        <TextAreaField
                          key={field.key}
                          label={field.label}
                          name={"data_" + field.key}
                          rows={2}
                          required={field.required}
                          optional={!field.required}
                          hint={field.note}
                          defaultValue={(latest?.data_terms?.[field.key] as string) ?? String(defaults.data_terms_defaults[field.key] ?? "")}
                        />
                      ))}
                    <TextField
                      label="Retention period in months"
                      name="data_retention_months"
                      type="number"
                      min={1}
                      max={120}
                      required
                      defaultValue={Number(defaults.data_terms_defaults.retention_months ?? 12)}
                    />
                    <TextField
                      label="Export format"
                      name="data_export_format"
                      hint="An open, documented format keeps the Vendor Dependency Score low."
                      defaultValue={(latest?.data_terms?.export_format as string) ?? "CSV with a documented schema, plus raw records in open JSON."}
                    />
                  </div>
                </section>

                <section className="flex flex-col gap-4">
                  <SectionLabel number="3" title="Milestones" />
                  <Callout tone="info" title="Between 2 and 6 milestones">
                    At least one must fall due before pilot completion, so the startup is paid during the pilot and not only after it. The department accepts or rejects
                    within {defaults.sla.accept_days} days, the approver clears payment within {defaults.sla.approve_days}, and the finance office records release within{" "}
                    {defaults.sla.release_days}.
                  </Callout>
                  <div className="flex flex-col gap-3">
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
                      <div key={index} className="flex flex-col gap-4 rounded-2xl bg-surface/60 p-4 ring-1 ring-border/60">
                        <input type="hidden" name="milestone_seq" value={milestone.seq} />
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "grid size-6 place-items-center rounded-full text-[11px] font-semibold text-white tabular-nums",
                              SEGMENT_COLORS[index % SEGMENT_COLORS.length],
                            )}
                          >
                            {milestone.seq}
                          </span>
                          <span className="text-[13px] font-medium text-muted-foreground">Milestone {milestone.seq}</span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]">
                          <TextField id={"milestone_title_" + index} label="Title" name="milestone_title" defaultValue={milestone.title} />
                          <TextField
                            id={"milestone_amount_" + index}
                            label="Amount, INR"
                            name="milestone_amount"
                            type="number"
                            min={0}
                            defaultValue={milestone.amount_rupees}
                          />
                          <TextField
                            id={"milestone_due_" + index}
                            label="Due date"
                            name="milestone_due"
                            type="date"
                            defaultValue={toDateInput(milestone.due_date)}
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <TextAreaField
                            id={"milestone_deliverable_" + index}
                            label="Deliverable"
                            name="milestone_deliverable"
                            rows={2}
                            defaultValue={milestone.deliverable}
                          />
                          <TextAreaField
                            id={"milestone_evidence_" + index}
                            label="Evidence required"
                            name="milestone_evidence"
                            rows={2}
                            defaultValue={milestone.evidence_required}
                            hint="A rejection must cite the part of this requirement that was not met."
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {latest ? <TextAreaField label="What changed in this version" name="change_note" rows={2} /> : null}

                <SubmitButton size="lg" className="self-start" pendingLabel="Drafting">
                  <FileSignature />
                  {latest ? "Issue a revised version" : "Draft the agreement"}
                </SubmitButton>
              </form>
            </Panel>
          ) : null}

          {versions.items.length > 1 ? (
            <Panel title="Version history" description="Every revision is kept, with the differences from the version before it.">
              <ol className="flex flex-col">
                {versions.items
                  .slice()
                  .reverse()
                  .map((version, index, list) => (
                    <li key={version.id} className="relative flex gap-4 pb-6 last:pb-0">
                      {index < list.length - 1 && <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-border" />}
                      <span className="relative z-10 grid size-7 shrink-0 place-items-center rounded-full bg-surface text-glyph shadow-lift">
                        <GitCommitVertical className="size-3.5" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">Version {version.number}</span>
                          {version.approved_at ? <ToneBadge tone="success">Approved</ToneBadge> : null}
                          {version.accepted_at ? <ToneBadge tone="success">Accepted</ToneBadge> : null}
                          {version.change_request ? <ToneBadge tone="warning">Changes requested</ToneBadge> : null}
                        </div>
                        {version.change_request ? (
                          <p className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">Startup requested:</span> {version.change_request}
                          </p>
                        ) : null}
                        {version.changes_from_previous.length ? (
                          <ul className="flex flex-col gap-1 text-[13px]">
                            {version.changes_from_previous.map((change, changeIndex) => (
                              <li key={changeIndex} className="flex flex-wrap items-baseline gap-1.5">
                                <span className="font-medium text-foreground">{humanize(change.field)}</span>
                                <span className="rounded-md bg-destructive/8 px-1.5 text-destructive-ink line-through decoration-destructive/40">{String(change.from)}</span>
                                <span className="text-muted-foreground">to</span>
                                <span className="rounded-md bg-success/10 px-1.5 text-success-ink">{String(change.to)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[13px] text-muted-foreground">First version.</p>
                        )}
                        <Hash value={version.sha256} className="self-start" />
                      </div>
                    </li>
                  ))}
              </ol>
            </Panel>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20 lg:self-start">
          <Panel title="Signing">
            <ol className="flex flex-col">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const current = index === currentStep;
                return (
                  <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
                    {index < steps.length - 1 && (
                      <span aria-hidden className={cn("absolute top-8 bottom-0 left-[15px] w-px", step.done ? "bg-success/50" : "bg-border")} />
                    )}
                    <span
                      className={cn(
                        "relative z-10 grid size-8 shrink-0 place-items-center rounded-full",
                        step.done && "bg-success/14 text-success-ink",
                        current && "bg-brand text-brand-foreground shadow-[0_0_0_4px_color-mix(in_oklab,var(--brand)_16%,transparent)]",
                        !step.done && !current && "bg-surface text-glyph",
                      )}
                    >
                      {step.done ? <Check className="size-4" strokeWidth={2.5} /> : <Icon className="size-4" />}
                    </span>
                    <div className="flex flex-col gap-0.5 pt-1">
                      <span className="text-sm font-medium text-foreground">{step.label}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {step.done ? (step.at ? formatDateTime(step.at) : "Done") : current ? "Waiting now" : "Not yet"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-4 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Signature reference</span>
                <span className="font-mono text-[12px]">{latest?.esign_reference ?? "Not signed yet"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Document hash</span>
                <Hash value={latest?.sha256 ?? null} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Cybersecurity</span>
                {cyberDone ? <ToneBadge tone="success">Complete</ToneBadge> : <ToneBadge tone="warning">Not complete</ToneBadge>}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Pre-registered plan</span>
                {planFrozen ? <ToneBadge tone="success">Frozen</ToneBadge> : <ToneBadge tone="warning">Not frozen</ToneBadge>}
              </div>
            </div>
          </Panel>

          {isApprover && actions.includes("approve-agreement") ? (
            <Panel
              title="Approve the agreement"
              description="Read the terms, the milestone schedule and the data clauses. Approving sends it to the startup for acceptance."
            >
              <form action={pilotTransition}>
                <input type="hidden" name="pilot_id" value={pilot.id} />
                <input type="hidden" name="action" value="approve-agreement" />
                <input type="hidden" name="back" value={"/pilots/" + pilot.id + "/agreement"} />
                <SubmitButton
                  className="w-full"
                  pendingLabel="Approving"
                  confirmTitle="Approve this agreement?"
                  confirm="It goes to the startup for acceptance, and the pilot starts when they accept."
                >
                  <Stamp />
                  Approve the agreement
                </SubmitButton>
              </form>
            </Panel>
          ) : null}

          {isStartup && actions.includes("accept-agreement") ? (
            <Panel
              title="Accept the agreement"
              description="Acceptance is recorded with your name, the server time and the hash of the exact document."
            >
              {!cyberDone ? (
                <Callout tone="warning" title="Complete the cybersecurity checklist first">
                  The pilot cannot be activated until every required control is confirmed.
                </Callout>
              ) : !planFrozen ? (
                <Callout tone="warning" title="The pre-registered plan has not been frozen">
                  The department must freeze the pilot design before the pilot can start.
                </Callout>
              ) : (
                <div className="flex flex-col gap-4">
                  <ul className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
                    {[
                      "The pre-registered plan forms part of this agreement and cannot change after the pilot starts without an approved, recorded amendment.",
                      "You will submit measurements at the agreed frequency and cooperate fully with the independent validator, including providing raw data on request.",
                      "You will maintain the cybersecurity controls you confirmed, and report any incident affecting departmental data within 24 hours.",
                      "On exit you will hand over an export of all departmental data in a documented open format within 15 days, and delete your copies within 30.",
                    ].map((line) => (
                      <li key={line} className="flex gap-2">
                        <Check className="mt-1 size-3.5 shrink-0 text-success" />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <form action={pilotTransition}>
                    <input type="hidden" name="pilot_id" value={pilot.id} />
                    <input type="hidden" name="action" value="accept-agreement" />
                    <input type="hidden" name="back" value={"/pilots/" + pilot.id + "/agreement"} />
                    <SubmitButton
                      variant="brand"
                      className="w-full"
                      pendingLabel="Accepting"
                      confirmTitle="Accept this agreement?"
                      confirm="The pilot becomes active and the pre-registered plan is locked."
                    >
                      Accept and start the pilot
                    </SubmitButton>
                  </form>
                  <Disclosure summary="Request changes instead">
                    <form action={pilotTransition} className="flex flex-col gap-3 pt-1">
                      <input type="hidden" name="pilot_id" value={pilot.id} />
                      <input type="hidden" name="action" value="request-changes" />
                      <input type="hidden" name="back" value={"/pilots/" + pilot.id + "/agreement"} />
                      <TextAreaField id="change_reason" label="What needs to change, and why" name="reason" rows={3} required minLength={10} />
                      <SubmitButton variant="secondary">Request changes</SubmitButton>
                    </form>
                  </Disclosure>
                </div>
              )}
            </Panel>
          ) : null}
        </aside>
      </div>
    </Page>
  );
}

function SectionLabel({ number, title }: { number: string; title: string }) {
  return (
    <h3 className="flex items-center gap-2.5 font-display text-[15px] font-semibold tracking-tight text-foreground">
      <span className="font-mono text-[12px] font-normal text-muted-foreground">{number.padStart(2, "0")}</span>
      {title}
    </h3>
  );
}
