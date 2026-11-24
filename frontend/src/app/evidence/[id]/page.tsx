import type { Metadata } from "next";
import Link from "next/link";

import { raiseAdoption } from "@/app/pilots/actions";
import { SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  Field,
  KeyValue,
  PageHeader,
  Pill,
  ProblemList,
  Section,
} from "@/components/ui";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { bandTone, decimal, formatDate, signed, titleCase } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Passport } from "@/lib/types";

export const metadata: Metadata = { title: "Innovation Passport" };
export const dynamic = "force-dynamic";

type Fit = {
  rows: { key: string; label: string; original: unknown; adopting: unknown; comparable: boolean; note: string }[];
  comparable: boolean;
  summary: string;
};

export default async function PassportPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/evidence/" + params.id);
  const passport = await apiGetOrNotFound<Passport>("/passports/" + params.id);
  const fit = await apiGetOptional<Fit>("/passports/" + params.id + "/context-fit");

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const canAdopt = hasRole(session, "DO", "DA");
  const result = passport.result_summary ?? {};
  const context = passport.context ?? {};

  return (
    <div>
      <PageHeader
        title={passport.solution_name}
        subtitle={passport.status_note}
        meta={
          <>
            <Pill>{passport.reference}</Pill>
            <Pill tone={bandTone(passport.band)}>
              {decimal(passport.confidence_score, 1)} of 100, {passport.band}
            </Pill>
            <Pill>{passport.category}</Pill>
            {passport.state_code ? <Pill>{passport.state_code}</Pill> : null}
          </>
        }
        actions={<Link href="/evidence" className="btn btn-secondary">Back to validated evidence</Link>}
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That request could not be recorded">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section
            title="What was measured"
            description="The result of one pilot in one context, verified by someone with no stake in it."
          >
            <KeyValue
              rows={[
                { label: "Measure", value: String(result.measure ?? "Not recorded") },
                { label: "Unit", value: String(result.unit ?? "") },
                { label: "Baseline", value: decimal(Number(result.baseline_mean), 3) },
                { label: "During the pilot", value: decimal(Number(result.pilot_mean), 3) },
                {
                  label: "Measured change",
                  value: (
                    <span className="num font-semibold">
                      {signed(Number(result.effect), 3)} {String(result.unit ?? "")}
                    </span>
                  ),
                },
                {
                  label: "Relative change",
                  value: decimal(Number(result.relative_effect_percent), 1) + " percent",
                },
                {
                  label: "95 percent interval",
                  value: (
                    <span className="num">
                      {decimal(Number(result.ci_low), 3)} to {decimal(Number(result.ci_high), 3)}
                    </span>
                  ),
                },
                { label: "p-value", value: decimal(Number(result.p_value), 6) },
                { label: "Analysis method", value: String(result.method ?? "Not recorded") },
                {
                  label: "Pass mark met",
                  value: result.pass_mark_met ? <Pill tone="good">Yes</Pill> : <Pill tone="warn">No</Pill>,
                },
              ]}
            />

            <div className="mt-5">
              <Callout tone="neutral" title="How to read this">
                The measured change is the best single estimate from this pilot. The interval is the
                range the true change most likely lies in. Plan against the cautious end of the
                interval, not the headline number.
              </Callout>
            </div>
          </Section>

          <Section
            title="The context it ran in"
            description="A result is evidence about the setting it came from. These are the facts you need to judge whether it transfers."
          >
            <DataTable columns={["Factor", "In the original pilot"]}>
              {Object.entries(context)
                .filter(([, value]) => value !== null && value !== undefined && value !== "")
                .map(([key, value]) => (
                  <tr key={key}>
                    <td className="whitespace-nowrap font-medium">{titleCase(key)}</td>
                    <td className="text-sm text-ink-soft">{String(value)}</td>
                  </tr>
                ))}
            </DataTable>
          </Section>

          {fit && fit.rows.length ? (
            <Section
              title="Context fit check"
              description={fit.summary}
            >
              <DataTable columns={["Factor", "Original", "Yours", "Comparable", "What to watch"]}>
                {fit.rows.map((row) => (
                  <tr key={row.key}>
                    <td className="font-medium">{row.label}</td>
                    <td className="text-sm">{String(row.original ?? "Not recorded")}</td>
                    <td className="text-sm">{String(row.adopting ?? "Not given")}</td>
                    <td>
                      {row.comparable ? <Pill tone="good">Yes</Pill> : <Pill tone="warn">Differs</Pill>}
                    </td>
                    <td className="text-sm text-ink-muted">{row.note || "No concern"}</td>
                  </tr>
                ))}
              </DataTable>
            </Section>
          ) : null}
        </div>

        <div>
          <Section title="The passport">
            <KeyValue
              rows={[
                { label: "Reference", value: <span className="num">{passport.reference}</span> },
                { label: "Startup", value: passport.startup_name ?? "Not recorded" },
                { label: "Department", value: passport.department_name ?? "Not recorded" },
                { label: "Validator", value: passport.validator_name },
                { label: "Validated on", value: formatDate(passport.validated_on) },
                { label: "Version", value: passport.passport_version },
              ]}
            />
            {passport.share_token ? (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-ink-muted">Read-only share link</p>
                <p className="num mt-1 break-all text-sm">
                  /passports/shared/{passport.share_token}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  Anyone with this link can read the result and its context, without signing in.
                </p>
              </div>
            ) : null}
            {passport.links?.evidence_pdf_file_id ? (
              <p className="mt-4">
                <a
                  href={"/api/v1/files/" + passport.links.evidence_pdf_file_id}
                  className="btn btn-secondary"
                >
                  Download the Evidence Report
                </a>
              </p>
            ) : null}
          </Section>

          {passport.adoption_requests?.length ? (
            <Section title="Reuse so far">
              <ul className="space-y-2 text-sm">
                {passport.adoption_requests.map((request) => (
                  <li key={request.id}>
                    <span className="font-medium text-ink">
                      {request.intent === "new_challenge" ? "New challenge" : "Pilot extension"}
                    </span>{" "}
                    <span className="text-ink-muted">
                      raised {formatDate(request.created_at)}, state {request.state}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>

      {canAdopt ? (
        <Section
          title="Reuse this evidence"
          description="Raising an adoption request pre-fills a challenge from the original, with this evidence attached, leaving the baseline blank for you to collect locally."
        >
          <form action={raiseAdoption} className="max-w-form space-y-4">
            <input type="hidden" name="passport_id" value={passport.id} />

            <Field label="What do you want to do?" name="intent" required>
              <select id="intent" name="intent" defaultValue="new_challenge" required>
                <option value="new_challenge">
                  Run my own challenge, pre-filled from this one
                </option>
                <option value="pilot_extension">
                  Ask about extending the original pilot to my area
                </option>
              </select>
            </Field>

            <Field label="Why this is relevant to your department" name="note">
              <textarea id="note" name="note" rows={3} />
            </Field>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">
                Your context, so the fit can be checked
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Number of units" name="scale_units">
                  <input id="scale_units" name="scale_units" type="number" min={1} />
                </Field>
                <Field label="Population served" name="population">
                  <input id="population" name="population" type="number" min={1} />
                </Field>
                <Field label="State code" name="state_code">
                  <input id="state_code" name="state_code" maxLength={4} defaultValue={""} />
                </Field>
                <Field label="Sector" name="sector">
                  <input id="sector" name="sector" defaultValue={passport.sector ?? ""} />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Operating environment" name="environment">
                  <textarea id="environment" name="environment" rows={2} />
                </Field>
              </div>
            </fieldset>

            <Callout tone="neutral" title="What you still have to do">
              Reuse shortens the route to a pilot; it does not remove the need for local evidence.
              Collect your own baseline before your pilot starts, because the original baseline
              belongs to a different context.
            </Callout>

            <SubmitButton pendingLabel="Raising the request...">Raise an adoption request</SubmitButton>
          </form>
        </Section>
      ) : null}
    </div>
  );
}
