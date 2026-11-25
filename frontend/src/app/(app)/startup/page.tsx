import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Briefcase, Building2, CircleCheck, CircleDashed, Link2, RefreshCw, Save, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";

import { saveStartupProfile, verifyDpiit } from "@/app/actions";
import { AutosaveForm, SubmitButton, TextAreaField, TextField } from "@/components/app/forms";
import { Callout, EmptyState, Flash, LinkButton, Page, PageHeader, Panel, ToneBadge, type Tone } from "@/components/app/kit";
import { Gauge } from "@/components/ui/gauge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { all, apiGet, apiGetOptional } from "@/lib/api";
import { bandTone, decimal, formatDate, formatDateTime, signed } from "@/lib/format";
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

const BAND_TONE: Record<string, Tone> = { good: "success", warn: "warning", bad: "destructive", neutral: "neutral" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function StartupProfilePage({ searchParams }: Props) {
  const query = await searchParams;
  const sessionRead = requireSession("/startup");
  // the profile reads start as soon as the session names the startup, not after the check below
  const [session, profile] = await all(
    sessionRead,
    sessionRead.then((s) =>
      s.startup_id
        ? all(
            apiGet<Startup>("/startups/" + s.startup_id),
            apiGetOptional<{ items: Passport[]; note: string }>("/startups/" + s.startup_id + "/passports"),
          )
        : null,
    ),
  );

  if (!session.startup_id || !profile) {
    return (
      <Page>
        <PageHeader title="Startup profile" />
        <EmptyState
          icon={Building2}
          title="No startup profile is linked to your account"
          description="Ask the platform administrator to link your account to the startup you represent."
        />
      </Page>
    );
  }

  const [startup, passports] = profile;

  const recognised = startup.dpiit_status === "Verified";
  const recognitionTone: Tone = recognised ? "success" : startup.dpiit_status === "Pending" ? "warning" : "destructive";
  const initials = startup.legal_name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

  return (
    <Page>
      <PageHeader
        eyebrow={<span>Startup profile</span>}
        title={
          <span className="flex items-center gap-4">
            <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-foreground font-display text-lg font-semibold text-background shadow-lift md:size-14">
              {initials}
            </span>
            <span className="min-w-0">{startup.legal_name}</span>
          </span>
        }
        description="Your profile is reused across every application, so you fill it once. The capability statement is the text the matching engine reads."
        meta={
          <>
            <ToneBadge tone={recognitionTone}>Recognition {startup.dpiit_status.toLowerCase()}</ToneBadge>
            <ToneBadge tone={startup.can_apply ? "success" : "warning"}>{startup.can_apply ? "Ready to apply" : "Profile incomplete"}</ToneBadge>
            {startup.sectors.map((sector) => (
              <ToneBadge key={sector} dot={false}>
                {sector}
              </ToneBadge>
            ))}
          </>
        }
        actions={
          <LinkButton href="/challenges-board" variant="default">
            Find a challenge
            <ArrowRight />
          </LinkButton>
        }
      />

      <Flash searchParams={query} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <AutosaveForm action={saveStartupProfile} className="flex min-w-0 flex-col gap-6 lg:order-1">
          <input type="hidden" name="startup_id" value={startup.id} />
          <input type="hidden" name="version" value={startup.version} />

          <Panel title="Registry details" description="Checked against the company registry and the Startup India record.">
            <div className="flex flex-col gap-5">
              <TextField label="Legal name" name="legal_name" required defaultValue={startup.legal_name} />
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField label="Corporate identity number" name="cin" defaultValue={startup.cin ?? ""} className="[&_input]:font-mono" />
                <TextField
                  label="Startup recognition number"
                  name="dpiit_number"
                  defaultValue={startup.dpiit_number ?? ""}
                  hint="For example DIPP123456. Changing it resets the recognition check."
                  className="[&_input]:font-mono"
                />
                <TextField label="State code" name="state_code" maxLength={4} defaultValue={startup.state_code ?? ""} hint="Two letters, for example MH." optional />
                <TextField label="District" name="district" defaultValue={startup.district ?? ""} optional />
                <TextField label="Team size" name="team_size" type="number" min={1} defaultValue={startup.team_size} />
                <TextField label="Website" name="website" type="url" defaultValue={startup.website ?? ""} optional />
                <TextField
                  label="Annual turnover in rupees"
                  name="annual_turnover_rupees"
                  type="number"
                  min={0}
                  defaultValue={startup.annual_turnover ? startup.annual_turnover.paise / 100 : 0}
                  hint="Used only where a challenge publishes a turnover criterion, and relaxed automatically if you are recognised."
                />
                <TextField label="Years of experience" name="years_of_experience" type="number" min={0} defaultValue={startup.years_of_experience} />
              </div>
            </div>
          </Panel>

          <Panel
            title="What you do"
            description="The capability statement is compared against each challenge. Be specific about the problem you solve and how you measure it."
            action={
              <span className="hidden items-center gap-1.5 text-[12px] text-muted-foreground sm:inline-flex">
                <Sparkles className="size-3.5" />
                Read by matching
              </span>
            }
          >
            <div className="flex flex-col gap-5">
              <TextField label="Sectors" name="sectors" defaultValue={(startup.sectors ?? []).join(", ")} hint="Comma separated, for example Water, Energy." />
              <TextAreaField label="Product description" name="product_description" rows={3} defaultValue={startup.product_description} />
              <TextAreaField
                label="Capability statement"
                name="capability_text"
                rows={8}
                defaultValue={startup.capability_text}
                hint="Two or three paragraphs. Name the problem, the mechanism and what you measure."
              />
            </div>
          </Panel>

          <Panel title="Contact" description="Who departments and the platform team reach about your applications.">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label="Contact name" name="contact_name" defaultValue={startup.contact_name} />
              <TextField label="Contact email address" name="contact_email" type="email" defaultValue={startup.contact_email} />
              <TextField label="Contact phone" name="contact_phone" defaultValue={startup.contact_phone ?? ""} optional />
            </div>
          </Panel>

          <div className="flex justify-end">
            <SubmitButton formAction={saveStartupProfile} pendingLabel="Saving" size="lg">
              <Save />
              Save the profile
            </SubmitButton>
          </div>
        </AutosaveForm>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:order-2">
          <Panel title="Profile completeness" description="These are exactly the fields that block you from applying.">
            <div className="flex justify-center">
              <Gauge
                value={startup.profile_completeness_percent}
                suffix="%"
                size={190}
                needle={false}
                tone={startup.can_apply ? "success" : "warning"}
                label={startup.can_apply ? "Ready to apply" : "Still needed"}
              />
            </div>
            {startup.missing_fields.length ? (
              <ul className="mt-4 flex flex-col gap-2">
                {startup.missing_fields.map((field) => (
                  <li key={field} className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-[13px] text-foreground">
                    <CircleDashed className="size-4 shrink-0 text-warning" />
                    {FIELD_LABELS[field] ?? field}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2.5 text-[13px] text-foreground">
                <CircleCheck className="size-4 shrink-0 text-success" />
                Complete. You can apply to any open challenge.
              </p>
            )}
          </Panel>

          <Panel
            title="Recognition status"
            description="Recognised startups have prior turnover and experience criteria relaxed automatically. The check runs through the Startup India adapter."
          >
            <div className="flex items-center gap-3 rounded-2xl bg-surface/70 p-3.5">
              <span
                className={
                  "grid size-10 shrink-0 place-items-center rounded-xl " +
                  (recognised ? "bg-success/12 text-success-ink" : recognitionTone === "warning" ? "bg-warning/14 text-warning-ink" : "bg-destructive/10 text-destructive-ink")
                }
              >
                {recognised ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-foreground">{startup.dpiit_status}</span>
                <span className="truncate font-mono text-[12px] text-muted-foreground">{startup.dpiit_number ?? "No number given"}</span>
              </div>
            </div>
            <p className="mt-3 text-[12px] text-muted-foreground">Last checked {startup.dpiit_checked_at ? formatDateTime(startup.dpiit_checked_at) : "never"}</p>
            <form action={verifyDpiit} className="mt-4">
              <input type="hidden" name="startup_id" value={startup.id} />
              <input type="hidden" name="back" value="/startup" />
              <SubmitButton variant="secondary" pendingLabel="Checking" className="w-full">
                <RefreshCw />
                Run the check again
              </SubmitButton>
            </form>
          </Panel>
        </aside>
      </div>

      {startup.case_references.length > 0 && (
        <Panel title="Case references" description="Up to five, reused across applications so you do not retype them. Client names are hidden from evaluators in round one.">
          <ul className="grid gap-3 md:grid-cols-2">
            {startup.case_references.map((reference, index) => (
              <li key={index} className="flex flex-col gap-2 rounded-2xl bg-surface/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-card text-glyph shadow-lift">
                      <Briefcase className="size-4" />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-foreground">{reference.title}</span>
                      <span className="truncate text-[12px] text-muted-foreground">{reference.client ?? "Client not given"}</span>
                    </div>
                  </div>
                  {reference.year && <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">{reference.year}</span>}
                </div>
                {reference.summary && <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{reference.summary}</p>}
                {reference.outcome && (
                  <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                    <BadgeCheck className="size-3.5 text-success" />
                    {reference.outcome}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Your Innovation Passports" description={passports?.note ?? "Validated pilot results you can share with any department."} flush={Boolean(passports?.items.length)}>
        {passports && passports.items.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Solution</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Validated</TableHead>
                <TableHead className="pr-6">Share link</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passports.items.map((passport) => {
                const result = passport.result_summary ?? {};
                return (
                  <TableRow key={passport.id}>
                    <TableCell className="pl-6">
                      <Link href={"/evidence/" + passport.id} className="font-medium text-foreground underline-offset-4 hover:underline">
                        {passport.solution_name}
                      </Link>
                      <span className="block font-mono text-[11px] text-muted-foreground">{passport.reference}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold tabular-nums">{signed(Number(result.effect), 2)}</span> {String(result.unit ?? "")}{" "}
                      <span className="text-muted-foreground">on {String(result.measure ?? "")}</span>
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={BAND_TONE[bandTone(passport.band)]}>{decimal(passport.confidence_score, 0)} of 100</ToneBadge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(passport.validated_on)}</TableCell>
                    <TableCell className="pr-6">
                      {passport.share_token ? (
                        <Link href={"/passports/shared/" + passport.share_token} className="inline-flex items-center gap-1.5 font-mono text-[12px] break-all text-muted-foreground hover:text-foreground">
                          <Link2 className="size-3.5 shrink-0" />
                          /passports/shared/{passport.share_token}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Not issued</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={BadgeCheck}
            title="No passports yet"
            description="When a pilot of yours is validated independently, its Innovation Passport appears here with a link you can send to any department."
            className="border-0 bg-surface/50 py-10"
          />
        )}
      </Panel>

      {!recognised && (
        <Callout tone="warning" title="Recognition is not verified">
          Without recognition, prior turnover and experience criteria apply to you in full. Check the number above and run the check again.
        </Callout>
      )}
    </Page>
  );
}
