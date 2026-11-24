import type { Metadata } from "next";
import Link from "next/link";

import { Callout, DataTable, KeyValue, PageHeader, Pill, Section } from "@/components/ui";
import { apiGet, apiGetOrNotFound } from "@/lib/api";
import { bandTone, decimal, formatDate, signed, titleCase } from "@/lib/format";
import type { Passport } from "@/lib/types";

export const metadata: Metadata = { title: "Shared Innovation Passport" };
export const dynamic = "force-dynamic";

/**
 * A read-only view from a share link. No sign-in is needed, so a startup can send a
 * department the evidence for its own pilot without either side creating an account
 * first (FR-SR-05).
 */
export default async function SharedPassportPage({ params }: { params: { token: string } }) {
  const passport = await apiGetOrNotFound<Passport & { read_only: boolean }>(
    "/passports/shared/" + params.token,
  );
  const result = passport.result_summary ?? {};
  const context = passport.context ?? {};

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={passport.solution_name}
        subtitle="A read-only record of an independently validated pilot result, shared by the startup that ran it."
        meta={
          <>
            <Pill>{passport.reference}</Pill>
            <Pill tone={bandTone(passport.band)}>
              {decimal(passport.confidence_score, 1)} of 100, {passport.band}
            </Pill>
            <Pill>Read only</Pill>
          </>
        }
      />

      <Section title="What was measured">
        <KeyValue
          rows={[
            { label: "Measure", value: String(result.measure ?? "Not recorded") },
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
              label: "95 percent interval",
              value: (
                <span className="num">
                  {decimal(Number(result.ci_low), 3)} to {decimal(Number(result.ci_high), 3)}
                </span>
              ),
            },
            { label: "Analysis method", value: String(result.method ?? "Not recorded") },
            { label: "Department that ran it", value: passport.department_name ?? "Not recorded" },
            { label: "Validated by", value: passport.validator_name },
            { label: "Validated on", value: formatDate(passport.validated_on) },
          ]}
        />
        <div className="mt-5">
          <Callout tone="neutral" title="How to read this">
            The measured change is the best single estimate from one pilot in one setting. The
            interval is the range the true change most likely lies in. Plan against the cautious end
            of it.
          </Callout>
        </div>
      </Section>

      <Section
        title="The context it ran in"
        description="A result is evidence about the setting it came from. Check these before assuming the same result elsewhere."
      >
        <DataTable columns={["Factor", "In this pilot"]}>
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

      <Section title="Reuse this evidence">
        <p className="max-w-prose text-sm text-ink-soft">
          A department signed in to PramaanSetu can raise an adoption request from this passport.
          The platform pre-fills a challenge from the original with this evidence attached, leaving
          the baseline blank so the adopting department collects its own.
        </p>
        <p className="mt-3">
          <Link href="/signin">Sign in to raise an adoption request</Link>
        </p>
      </Section>
    </div>
  );
}
