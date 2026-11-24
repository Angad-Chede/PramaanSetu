import type { Metadata } from "next";
import Link from "next/link";

import { saveStartupProfile, verifyDpiit } from "@/app/actions";
import { AutosaveForm, SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  EmptyState,
  Field,
  KeyValue,
  Meter,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOptional } from "@/lib/api";
import { bandTone, decimal, formatDate, money, signed } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { requireSession } from "@/lib/session";
import type { Passport } from "@/lib/types";

export const metadata: Metadata = { title: "Startup profile" };
export const dynamic = "force-dynamic";

type Startup = {
  id: string;
  legal_name: string;
  cin: string | null;
  dpiit_number: string | null;
  dpiit_status: string;
  dpiit_checked_at: string | null;
  sectors: string[];
  state_code: string | null;
  district: string | null;
  product_description: string;
  capability_text: string;
  team_size: number;
  website: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  case_references: { title: string; client?: string; summary?: string; year?: number; outcome?: string }[];
  annual_turnover: { paise: number; display: string } | null;
  years_of_experience: number;
  profile_completeness_percent: number;
  missing_fields: string[];
  can_apply: boolean;
  version: number;
};

const FIELD_LABELS: Record<string, string> = {
  legal_name: "Legal name",
  cin: "Corporate identity number",
  dpiit_number: "Startup recognition number",
  sectors: "Sectors",
  product_description: "Product description",
  capability_text: "Capability statement",
  contact_name: "Contact name",
  contact_email: "Contact email address",
};

export default async function StartupProfilePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/startup");

  if (!session.startup_id) {
    return (
      <div>
        <PageHeader title="Startup profile" />
        <Section title="No profile linked">
          <EmptyState message="Your account is not attached to a startup profile. Ask the platform administrator to link it." />
        </Section>
      </div>
    );
  }

  const startup = await apiGet<Startup>("/startups/" + session.startup_id);
  const passports = await apiGetOptional<{ items: Passport[]; note: string }>(
    "/startups/" + session.startup_id + "/passports",
  );

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={startup.legal_name}
        subtitle="Your profile is reused across every application, so you fill it once. The capability statement is what the matching engine reads."
        meta={
          <>
            <Pill
              tone={
                startup.dpiit_status === "Verified"
                  ? "good"
                  : startup.dpiit_status === "Pending"
                    ? "warn"
                    : "bad"
              }
            >
              Recognition: {startup.dpiit_status}
            </Pill>
            <Pill tone={startup.can_apply ? "good" : "warn"}>
              {startup.can_apply ? "Ready to apply" : "Profile incomplete"}
            </Pill>
          </>
        }
        actions={<Link href="/challenges-board" className="btn btn-primary">Find a challenge</Link>}
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That could not be saved">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      <Section
        title="Profile completeness"
        description="These are exactly the fields that block you from applying."
      >
        <Meter
          label="Complete"
          value={startup.profile_completeness_percent}
          max={100}
          tone={startup.can_apply ? "good" : "warn"}
        />
        {startup.missing_fields.length ? (
          <div className="mt-4">
            <Callout tone="warn" title="Still needed before you can apply">
              <ul className="list-disc space-y-1 pl-5">
                {startup.missing_fields.map((field) => (
                  <li key={field}>{FIELD_LABELS[field] ?? field}</li>
                ))}
              </ul>
            </Callout>
          </div>
        ) : (
          <div className="mt-4">
            <Callout tone="good">Your profile is complete. You can apply to any open challenge.</Callout>
          </div>
        )}
      </Section>

      <Section
        title="Recognition status"
        description="Prior turnover and prior experience criteria are relaxed automatically for a recognised startup. The check runs through the Startup India adapter."
        actions={
          <form action={verifyDpiit}>
            <input type="hidden" name="startup_id" value={startup.id} />
            <input type="hidden" name="back" value="/startup" />
            <SubmitButton variant="secondary" pendingLabel="Checking...">
              Run the check again
            </SubmitButton>
          </form>
        }
      >
        <KeyValue
          rows={[
            { label: "Recognition number", value: startup.dpiit_number ?? "Not given" },
            { label: "Status", value: startup.dpiit_status },
            { label: "Last checked", value: <Timestamp value={startup.dpiit_checked_at} /> },
          ]}
        />
      </Section>

      <AutosaveForm action={saveStartupProfile} className="space-y-5">
        <input type="hidden" name="startup_id" value={startup.id} />
        <input type="hidden" name="version" value={startup.version} />

        <Section title="Registry details">
          <div className="max-w-form space-y-4">
            <Field label="Legal name" name="legal_name" required>
              <input id="legal_name" name="legal_name" defaultValue={startup.legal_name} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Corporate identity number" name="cin" required>
                <input id="cin" name="cin" defaultValue={startup.cin ?? ""} />
              </Field>
              <Field
                label="Startup recognition number"
                name="dpiit_number"
                required
                help="For example DIPP123456. Changing it resets the recognition check."
              >
                <input id="dpiit_number" name="dpiit_number" defaultValue={startup.dpiit_number ?? ""} />
              </Field>
              <Field label="State code" name="state_code" help="Two letters, for example MH.">
                <input id="state_code" name="state_code" maxLength={4} defaultValue={startup.state_code ?? ""} />
              </Field>
              <Field label="District" name="district">
                <input id="district" name="district" defaultValue={startup.district ?? ""} />
              </Field>
              <Field label="Team size" name="team_size">
                <input id="team_size" name="team_size" type="number" min={1} defaultValue={startup.team_size} />
              </Field>
              <Field label="Website" name="website">
                <input id="website" name="website" type="url" defaultValue={startup.website ?? ""} />
              </Field>
              <Field
                label="Annual turnover in rupees"
                name="annual_turnover_rupees"
                help="Used only where a challenge publishes a turnover criterion, and relaxed automatically if you are recognised."
              >
                <input
                  id="annual_turnover_rupees"
                  name="annual_turnover_rupees"
                  type="number"
                  min={0}
                  defaultValue={startup.annual_turnover ? startup.annual_turnover.paise / 100 : 0}
                />
              </Field>
              <Field label="Years of experience" name="years_of_experience">
                <input
                  id="years_of_experience"
                  name="years_of_experience"
                  type="number"
                  min={0}
                  defaultValue={startup.years_of_experience}
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section
          title="What you do"
          description="The capability statement is the text the matching engine compares against each challenge. Be specific about the problem you solve and how you measure it."
        >
          <div className="max-w-form space-y-4">
            <Field label="Sectors" name="sectors" required help="Comma separated, for example Water, Energy.">
              <input id="sectors" name="sectors" defaultValue={(startup.sectors ?? []).join(", ")} />
            </Field>
            <Field label="Product description" name="product_description" required>
              <textarea
                id="product_description"
                name="product_description"
                rows={3}
                defaultValue={startup.product_description}
              />
            </Field>
            <Field
              label="Capability statement"
              name="capability_text"
              required
              help="Two or three paragraphs. Name the problem, the mechanism and what you measure."
            >
              <textarea
                id="capability_text"
                name="capability_text"
                rows={8}
                defaultValue={startup.capability_text}
              />
            </Field>
          </div>
        </Section>

        <Section title="Contact">
          <div className="grid max-w-form gap-4 sm:grid-cols-2">
            <Field label="Contact name" name="contact_name" required>
              <input id="contact_name" name="contact_name" defaultValue={startup.contact_name} />
            </Field>
            <Field label="Contact email address" name="contact_email" required>
              <input id="contact_email" name="contact_email" type="email" defaultValue={startup.contact_email} />
            </Field>
            <Field label="Contact phone" name="contact_phone">
              <input id="contact_phone" name="contact_phone" defaultValue={startup.contact_phone ?? ""} />
            </Field>
          </div>
        </Section>

        <div className="flex justify-end no-print">
          <SubmitButton pendingLabel="Saving...">Save the profile</SubmitButton>
        </div>
      </AutosaveForm>

      {startup.case_references.length ? (
        <Section
          title="Case references"
          description="Up to five, reused across applications so you do not retype them."
        >
          <DataTable columns={["Title", "Client", "Year", "What happened"]}>
            {startup.case_references.map((reference, index) => (
              <tr key={index}>
                <td className="font-medium">{reference.title}</td>
                <td className="text-sm">{reference.client ?? "Not given"}</td>
                <td className="num text-sm">{reference.year ?? ""}</td>
                <td className="text-sm text-ink-muted">
                  {reference.summary}
                  {reference.outcome ? <span className="block">{reference.outcome}</span> : null}
                </td>
              </tr>
            ))}
          </DataTable>
          <p className="mt-3 text-sm text-ink-muted">
            In round one of evaluation, client names in these references are hidden from evaluators.
          </p>
        </Section>
      ) : null}

      {passports && passports.items.length ? (
        <Section title="Your Innovation Passports" description={passports.note}>
          <DataTable columns={["Reference", "Solution", "Result", "Score", "Validated", "Share link"]}>
            {passports.items.map((passport) => {
              const result = passport.result_summary ?? {};
              return (
                <tr key={passport.id}>
                  <td className="num text-sm">{passport.reference}</td>
                  <td>
                    <Link href={"/evidence/" + passport.id} className="font-medium">
                      {passport.solution_name}
                    </Link>
                  </td>
                  <td className="text-sm">
                    <span className="num">{signed(Number(result.effect), 2)}</span>{" "}
                    {String(result.unit ?? "")} on {String(result.measure ?? "")}
                  </td>
                  <td>
                    <Pill tone={bandTone(passport.band)}>
                      {decimal(passport.confidence_score, 0)} of 100
                    </Pill>
                  </td>
                  <td className="whitespace-nowrap text-sm">{formatDate(passport.validated_on)}</td>
                  <td className="num break-all text-xs text-ink-muted">
                    {passport.share_token ? "/passports/shared/" + passport.share_token : "Not issued"}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        </Section>
      ) : null}
    </div>
  );
}
