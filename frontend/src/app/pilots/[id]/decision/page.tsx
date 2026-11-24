import type { Metadata } from "next";
import Link from "next/link";

import { projectScale, recordDecision } from "@/app/pilots/actions";
import { Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  Field,
  KeyValue,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { bandTone, compactRupees, decimal, money, signed } from "@/lib/format";
import { readNotice, readProblem, single } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { EvidenceReport, Pilot } from "@/lib/types";

export const metadata: Metadata = { title: "Pathway and decision" };
export const dynamic = "force-dynamic";

type Pathway = {
  recommended: { code: string; name: string; rationale: string; conditions: string[]; reference: string };
  alternatives: { code: string; name: string; rationale: string; conditions: string[]; reference: string }[];
  rule_inputs: Record<string, unknown>;
  caveat: string;
  marketplace: { category: string; listed: boolean; qualified_vendor_count: number; detail: string };
};

type Dependency = {
  score: number;
  level: string;
  exit_plan_required: boolean;
  message: string;
  factors: { code: string; label: string; weight: number; present: boolean; mitigation: string }[];
};

type Projection = {
  units: number;
  total_cost_paise: number;
  benefit_low: number;
  benefit_expected: number;
  benefit_high: number;
  benefit_unit: string;
  monetised_low_paise: number | null;
  monetised_expected_paise: number | null;
  monetised_high_paise: number | null;
  payback_months: number | null;
  assumptions: string[];
  measure: string;
  effect_used: { low: number; expected: number; high: number };
};

type Decision = {
  decision: string;
  reason: string;
  estimated_value: { paise: number; display: string };
  pathway: Pathway | Record<string, never>;
  vendor_dependency: Dependency | Record<string, never>;
  handoff_file_id: string | null;
  decided_at: string;
};

export default async function DecisionPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/pilots/" + params.id + "/decision");
  const pilot = await apiGetOrNotFound<Pilot>("/pilots/" + params.id);
  const report = await apiGetOptional<EvidenceReport>("/pilots/" + params.id + "/evidence");
  const existing = await apiGetOptional<Decision>("/pilots/" + params.id + "/decision");

  const estimatedValue = Number(single(searchParams?.value) ?? 0);
  const units = Number(single(searchParams?.units) ?? 0);
  const costPerUnit = Number(single(searchParams?.cost) ?? 0);

  const pathway = report?.status?.startsWith("SignedOff")
    ? await apiGetOptional<Pathway>(
        "/pilots/" + params.id + "/pathway?estimated_value_rupees=" + (estimatedValue || 0),
      )
    : null;
  const dependency = report?.status?.startsWith("SignedOff")
    ? await apiGetOptional<Dependency>("/pilots/" + params.id + "/vendor-dependency")
    : null;

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const canDecide = hasRole(session, "DA") && session.department_id === pilot.department_id;
  const validated = Boolean(report && report.status.startsWith("SignedOff"));
  const analysis = report?.analysis ?? {};

  return (
    <div>
      <PageHeader
        title="Procurement pathway and scale decision"
        subtitle="A route is recommended from the rule inputs shown. The final choice rests with the competent authority, advised by the department legal and finance cells."
        meta={
          <>
            <Pill>{pilot.reference}</Pill>
            {report ? (
              <Pill tone={bandTone(report.band)}>
                Evidence {decimal(report.confidence_score ?? 0, 1)} of 100, {report.band ?? "no band"}
              </Pill>
            ) : (
              <Pill tone="warn">No Evidence Report</Pill>
            )}
            {existing ? <Pill tone="good">Decision recorded: {existing.decision}</Pill> : null}
          </>
        }
        actions={<Link href={"/pilots/" + pilot.id} className="btn btn-secondary">Back to the pilot</Link>}
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That decision could not be recorded">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {!validated ? (
        <Section title="Not yet available">
          <Callout tone="warn" title="A scale decision needs a signed-off Evidence Report">
            {report
              ? "The report for this pilot is in state " + report.status + "."
              : "No Evidence Report has been produced for this pilot yet."}{" "}
            This rule is enforced by the platform, not just by the interface.
          </Callout>
          <p className="mt-3">
            <Link href={"/pilots/" + pilot.id + "/evidence"}>Open the Evidence Report</Link>
          </p>
        </Section>
      ) : null}

      {existing ? (
        <Section title="The decision on record">
          <KeyValue
            rows={[
              { label: "Decision", value: existing.decision },
              { label: "Estimated scale-up value", value: money(existing.estimated_value) },
              { label: "Recorded", value: <Timestamp value={existing.decided_at} /> },
            ]}
          />
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-ink-muted">Reasons</p>
            <p className="mt-1 max-w-prose whitespace-pre-line text-ink-soft">{existing.reason}</p>
          </div>
          {existing.handoff_file_id ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <a href={"/api/v1/pilots/" + pilot.id + "/handoff.pdf"} className="btn btn-primary">
                Download the procurement handoff pack
              </a>
              <a href={"/api/v1/pilots/" + pilot.id + "/handoff.json"} className="btn btn-secondary">
                The same pack as JSON
              </a>
            </div>
          ) : null}
        </Section>
      ) : null}

      {validated && report ? (
        <Section title="What the pilot measured">
          <KeyValue
            rows={[
              { label: "Measure", value: String(analysis.primary_kpi_name ?? "") },
              {
                label: "Validated change",
                value: (
                  <span className="num font-semibold">
                    {signed(Number(analysis.effect), 3)} {String(analysis.primary_kpi_unit ?? "")}
                  </span>
                ),
              },
              {
                label: "95 percent interval",
                value: (
                  <span className="num">
                    {decimal(Number(analysis.ci_low), 3)} to {decimal(Number(analysis.ci_high), 3)}
                  </span>
                ),
              },
              { label: "Evidence Confidence Score", value: decimal(report.confidence_score ?? 0, 1) + " of 100" },
              { label: "Band", value: report.band ?? "Not issued" },
              { label: "Validator", value: report.validator_name ?? "Recorded" },
            ]}
          />
        </Section>
      ) : null}

      {pathway ? (
        <Section
          title="Recommended procurement route"
          description="Generated from the rule inputs below."
        >
          <div className="rounded border border-brand bg-brand-light p-4">
            <h3>{pathway.recommended.name}</h3>
            <p className="mt-1 text-ink-soft">{pathway.recommended.rationale}</p>
            {pathway.recommended.conditions.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {pathway.recommended.conditions.map((condition) => (
                  <li key={condition}>{condition}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-sm text-ink-muted">Reference: {pathway.recommended.reference}</p>
          </div>

          <div className="mt-4">
            <Disclosure summary="Rule inputs and the other routes considered">
              <DataTable columns={["Input", "Value"]}>
                {Object.entries(pathway.rule_inputs).map(([key, value]) => (
                  <tr key={key}>
                    <td className="whitespace-nowrap font-medium">{key.replace(/_/g, " ")}</td>
                    <td className="text-sm">
                      {key.endsWith("paise") ? compactRupees(Number(value)) : String(value)}
                    </td>
                  </tr>
                ))}
              </DataTable>
              <p className="mt-3 text-sm">
                Marketplace check: {pathway.marketplace.detail} (source{" "}
                {pathway.marketplace.listed ? "listed" : "not listed"},{" "}
                {pathway.marketplace.qualified_vendor_count} qualified vendors).
              </p>
              {pathway.alternatives.length ? (
                <ul className="mt-4 space-y-3">
                  {pathway.alternatives.map((option) => (
                    <li key={option.code}>
                      <p className="font-medium text-ink">{option.name}</p>
                      <p className="text-sm text-ink-muted">{option.rationale}</p>
                      <p className="text-xs text-ink-muted">Reference: {option.reference}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Disclosure>
          </div>

          <div className="mt-4">
            <Callout tone="neutral">{pathway.caveat}</Callout>
          </div>
        </Section>
      ) : null}

      {dependency ? (
        <Section
          title="Vendor Dependency Score"
          description="Higher means more dependency. Above 60, an exit plan must be on record before a scale decision can be approved."
        >
          <div className="flex flex-wrap items-center gap-5">
            <div
              className={
                "rounded border px-5 py-3 text-center " +
                (dependency.score > 60
                  ? "border-bad bg-bad-light"
                  : dependency.score > 30
                    ? "border-warn bg-warn-light"
                    : "border-good bg-good-light")
              }
            >
              <p className="num text-3xl font-semibold text-ink">{dependency.score}</p>
              <p className="mt-1 text-sm text-ink-soft">{dependency.level} dependency</p>
            </div>
            <p className="max-w-prose flex-1 text-ink-soft">{dependency.message}</p>
          </div>
          <div className="mt-4">
            <DataTable columns={["Factor", "Weight", "Present", "Mitigation"]}>
              {dependency.factors.map((factor) => (
                <tr key={factor.code}>
                  <td>{factor.label}</td>
                  <td className="num">{factor.weight}</td>
                  <td>{factor.present ? <Pill tone="bad">Yes</Pill> : <Pill tone="good">No</Pill>}</td>
                  <td className="text-sm text-ink-muted">{factor.mitigation || "Not applicable"}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </Section>
      ) : null}

      {validated && canDecide ? (
        <Section
          title="Project the rollout"
          description="The conservative case uses the cautious end of the validated interval. Plan against that case, not the optimistic one."
        >
          <form action={projectScale} className="grid max-w-form gap-4 sm:grid-cols-3">
            <input type="hidden" name="pilot_id" value={pilot.id} />
            <Field label="Units to roll out to" name="units">
              <input id="units" name="units" type="number" min={1} defaultValue={units || 96} />
            </Field>
            <Field label="Cost per unit in rupees" name="cost_per_unit_rupees">
              <input
                id="cost_per_unit_rupees"
                name="cost_per_unit_rupees"
                type="number"
                min={0}
                defaultValue={costPerUnit || 185000}
              />
            </Field>
            <Field
              label="Value of one unit of improvement, in rupees"
              name="value_per_effect_unit_rupees"
              help="Optional. Used to monetise the benefit."
            >
              <input
                id="value_per_effect_unit_rupees"
                name="value_per_effect_unit_rupees"
                type="number"
                min={0}
                defaultValue={42000}
              />
            </Field>
            <div className="sm:col-span-3">
              <SubmitButton variant="secondary">Project the rollout</SubmitButton>
            </div>
          </form>
        </Section>
      ) : null}

      {validated && canDecide && !existing ? (
        <Section
          title="Record the decision"
          description="Scale, extend the pilot, or close. Every decision is recorded with reasons and appears in the audit trail."
        >
          <form action={recordDecision} className="max-w-form space-y-4">
            <input type="hidden" name="pilot_id" value={pilot.id} />

            <Field label="Decision" name="decision" required>
              <select id="decision" name="decision" required defaultValue="Scale">
                <option value="Scale">Scale: take this to procurement</option>
                <option value="ExtendPilot">Extend the pilot and gather more evidence</option>
                <option value="Close">Close: do not proceed on this evidence</option>
              </select>
            </Field>

            <Field
              label="Reasons"
              name="reason"
              required
              help="At least 20 characters. State what in the evidence led to this decision."
            >
              <textarea id="reason" name="reason" rows={5} required minLength={20} />
            </Field>

            <Field label="Estimated scale-up value in rupees" name="estimated_value_rupees" required>
              <input
                id="estimated_value_rupees"
                name="estimated_value_rupees"
                type="number"
                min={0}
                defaultValue={estimatedValue || 28000000}
                required
              />
            </Field>

            <Field
              label="Qualified vendors for this category"
              name="qualified_vendor_count"
              help="Leave blank to use the marketplace check."
            >
              <input id="qualified_vendor_count" name="qualified_vendor_count" type="number" min={0} />
            </Field>

            {dependency?.exit_plan_required ? (
              <div className="rounded border border-warn bg-warn-light px-4 py-3">
                <div className="flex items-start gap-3">
                  <input
                    id="exit_plan_on_record"
                    name="exit_plan_on_record"
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <label htmlFor="exit_plan_on_record" className="font-normal">
                    An exit plan is on record for this solution. Required because the Vendor
                    Dependency Score is {dependency.score}, above the threshold of 60.
                  </label>
                </div>
              </div>
            ) : null}

            <Callout tone="neutral" title="What recording a Scale decision does">
              It produces a procurement handoff pack with the challenge, the agreement, the Evidence
              Report, the pathway recommendation and an outcome-based specification, as a PDF and as
              JSON for the marketplace adapter. The specification names no product and no vendor.
            </Callout>

            <SubmitButton
              pendingLabel="Recording..."
              confirm="Record this decision? It appears in the audit trail and, for a Scale decision, produces the procurement handoff pack."
            >
              Record the decision
            </SubmitButton>
          </form>
        </Section>
      ) : null}
    </div>
  );
}
