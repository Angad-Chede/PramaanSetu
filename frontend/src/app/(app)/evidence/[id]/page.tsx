import type { Metadata } from "next";
import { ArrowUpRight, Building2, CheckCircle2, Download, FileText, GitBranch, MapPin, Repeat2, Rocket, TriangleAlert } from "lucide-react";

import { raiseAdoption } from "@/app/pilots/actions";
import { SelectField, SubmitButton, TextAreaField, TextField } from "@/components/app/forms";
import { Callout, Flash, KeyValues, LinkButton, Page, PageHeader, Panel, ToneBadge, fieldErrorFor } from "@/components/app/kit";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { all, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { decimal, formatDate, signed } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import type { Passport } from "@/lib/types";

import { CopyLink } from "../_components/copy-link";
import { ResultVisual, contextItems } from "../_components/result";
import { ScoreCard } from "../_components/score";

export const metadata: Metadata = { title: "Innovation Passport" };
export const dynamic = "force-dynamic";

type Fit = {
  rows: { key: string; label: string; original: unknown; adopting: unknown; comparable: boolean; note: string }[];
  comparable: boolean;
  summary: string;
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PassportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [session, passport, fit] = await all(
    requireSession("/evidence/" + id),
    apiGetOrNotFound<Passport>("/passports/" + id),
    apiGetOptional<Fit>("/passports/" + id + "/context-fit"),
  );

  const canAdopt = hasRole(session, "DO", "DA");
  const result = passport.result_summary ?? {};
  const context = passport.context ?? {};
  const err = (field: string) => fieldErrorFor(query, field);

  return (
    <Page>
      <PageHeader
        back={{ href: "/evidence", label: "Validated evidence" }}
        eyebrow={
          <>
            <span className="font-mono text-[12px] tracking-tight">{passport.reference}</span>
            <span className="text-border">/</span>
            <Badge variant="secondary">{passport.category}</Badge>
            {passport.state_code && (
              <Badge variant="outline">
                <MapPin />
                {[passport.district, passport.state_code].filter(Boolean).join(", ")}
              </Badge>
            )}
          </>
        }
        title={passport.solution_name}
        description={passport.status_note}
        actions={
          passport.links?.evidence_pdf_file_id ? (
            <LinkButton href={"/api/v1/files/" + passport.links.evidence_pdf_file_id} variant="outline" external>
              <Download />
              Evidence Report
            </LinkButton>
          ) : undefined
        }
      />

      <Flash searchParams={query} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="What was measured" description="The result of one pilot in one setting, verified by someone with no stake in it.">
          <ResultVisual result={result} />
        </Panel>
        <ScoreCard score={passport.confidence_score} band={passport.band} validator={passport.validator_name} validatedOn={passport.validated_on} />
      </div>

      <Callout title="How to read this">
        The measured change is the best single estimate from this pilot. The interval is the range the true change most likely lies in. Plan against the
        cautious end of the interval, not the headline number.
      </Callout>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="The statistics" description="Every figure behind the headline, as the pre-registered analysis produced it.">
            <KeyValues
              columns={3}
              className="grid-cols-2"
              items={[
                { label: "Measure", value: String(result.measure ?? "Not recorded") },
                { label: "Unit", value: String(result.unit ?? "Not recorded") },
                { label: "Analysis method", value: String(result.method ?? "Not recorded") },
                { label: "Baseline", value: <span className="tabular-nums">{decimal(Number(result.baseline_mean), 3)}</span> },
                { label: "During the pilot", value: <span className="tabular-nums">{decimal(Number(result.pilot_mean), 3)}</span> },
                {
                  label: "Measured change",
                  value: (
                    <span className="font-semibold tabular-nums">
                      {signed(Number(result.effect), 3)} {String(result.unit ?? "")}
                    </span>
                  ),
                },
                { label: "Relative change", value: <span className="tabular-nums">{decimal(Number(result.relative_effect_percent), 1)} percent</span> },
                {
                  label: "95 percent interval",
                  value: (
                    <span className="tabular-nums">
                      {decimal(Number(result.ci_low), 3)} to {decimal(Number(result.ci_high), 3)}
                    </span>
                  ),
                },
                { label: "p-value", value: <span className="tabular-nums">{decimal(Number(result.p_value), 6)}</span> },
                {
                  label: "Pass mark met",
                  value: result.pass_mark_met ? <ToneBadge tone="success">Yes</ToneBadge> : <ToneBadge tone="warning">No</ToneBadge>,
                },
              ]}
            />
          </Panel>

          <Panel title="The context it ran in" description="A result is evidence about the setting it came from. These are the facts you need to judge whether it transfers.">
            {Object.keys(context).length ? (
              <KeyValues items={contextItems(context)} />
            ) : (
              <p className="text-sm text-muted-foreground">No context was recorded for this pilot.</p>
            )}
          </Panel>

          {fit && fit.rows.length ? (
            <Panel
              flush
              title="Context fit check"
              description="Your department's context against the original. Every difference is a judgement you have to make."
              action={fit.comparable ? <ToneBadge tone="success">Comparable</ToneBadge> : <ToneBadge tone="warning">Differs</ToneBadge>}
            >
              <div className="px-5 pb-4 md:px-6">
                <Callout tone={fit.comparable ? "success" : "warning"}>{fit.summary}</Callout>
              </div>
              <ul className="divide-y divide-border/70 border-t md:hidden">
                {fit.rows.map((row) => (
                  <li key={row.key} className="flex flex-col gap-2 px-5 py-4 text-[13px]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">{row.label}</span>
                      {row.comparable ? <ToneBadge tone="success">Yes</ToneBadge> : <ToneBadge tone="warning">Differs</ToneBadge>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[12px] text-muted-foreground">Original</span>
                        <span className="line-clamp-3 text-foreground">{String(row.original ?? "Not recorded")}</span>
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[12px] text-muted-foreground">Yours</span>
                        <span className="text-foreground">{String(row.adopting ?? "Not given")}</span>
                      </span>
                    </div>
                    <p className="text-muted-foreground">{row.note || "No concern"}</p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <Table className="min-w-[40rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="first:pl-5 md:first:pl-6">Factor</TableHead>
                      <TableHead>Original</TableHead>
                      <TableHead>Yours</TableHead>
                      <TableHead>Comparable</TableHead>
                      <TableHead className="last:pr-5 md:last:pr-6">What to watch</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fit.rows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium first:pl-5 md:first:pl-6">{row.label}</TableCell>
                        <TableCell className="max-w-56 whitespace-normal text-muted-foreground">
                          <span className="line-clamp-3">{String(row.original ?? "Not recorded")}</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{String(row.adopting ?? "Not given")}</TableCell>
                        <TableCell>
                          {row.comparable ? <ToneBadge tone="success">Yes</ToneBadge> : <ToneBadge tone="warning">Differs</ToneBadge>}
                        </TableCell>
                        <TableCell className="max-w-64 whitespace-normal text-muted-foreground last:pr-5 md:last:pr-6">{row.note || "No concern"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="The passport">
            <div className="flex flex-col gap-5">
              <ul className="flex flex-col gap-3.5 text-sm">
                {[
                  { icon: FileText, label: "Reference", value: <span className="font-mono text-[13px]">{passport.reference}</span> },
                  { icon: Rocket, label: "Startup", value: passport.startup_name ?? "Not recorded" },
                  { icon: Building2, label: "Department", value: passport.department_name ?? "Not recorded" },
                  { icon: CheckCircle2, label: "Validator", value: passport.validator_name },
                  { icon: GitBranch, label: "Version", value: <span className="tabular-nums">Version {passport.passport_version}, {formatDate(passport.validated_on)}</span> },
                ].map((row) => (
                  <li key={row.label} className="flex gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface text-glyph">
                      <row.icon className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[12px] text-muted-foreground">{row.label}</span>
                      <span className="break-words text-foreground">{row.value}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {(passport.links?.challenge_reference || passport.links?.pilot_reference) && (
                <div className="flex flex-wrap gap-1.5">
                  {passport.links?.challenge_reference && <Badge variant="outline">Challenge {passport.links.challenge_reference}</Badge>}
                  {passport.links?.pilot_reference && <Badge variant="outline">Pilot {passport.links.pilot_reference}</Badge>}
                </div>
              )}
              {passport.share_token && (
                <div className="flex flex-col gap-2">
                  <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Read-only share link</p>
                  <CopyLink path={"/passports/shared/" + passport.share_token} />
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    Anyone with this link can read the result and its context without signing in.
                  </p>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Reuse so far" description={passport.adoption_requests?.length ? undefined : "No department has asked to reuse this evidence yet."}>
            {passport.adoption_requests?.length ? (
              <ol className="relative flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
                {passport.adoption_requests.map((request) => (
                  <li key={request.id} className="relative flex gap-3">
                    <span className="z-10 grid size-8 shrink-0 place-items-center rounded-full bg-brand/12 text-brand-ink ring-4 ring-card">
                      <Repeat2 className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-col gap-1 text-sm">
                      <span className="font-medium text-foreground">{request.intent === "new_challenge" ? "New challenge" : "Pilot extension"}</span>
                      <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                        Raised {formatDate(request.created_at)}
                        <Badge variant="secondary">{request.state}</Badge>
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : undefined}
          </Panel>
        </div>
      </div>

      {canAdopt ? (
        <Panel
          id="adopt"
          title="Reuse this evidence"
          description="An adoption request pre-fills a challenge from the original with this evidence attached, leaving the baseline blank for you to collect locally."
        >
          <form action={raiseAdoption} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <input type="hidden" name="passport_id" value={passport.id} />
            <div className="flex flex-col gap-5">
              <SelectField
                label="What do you want to do?"
                name="intent"
                defaultValue="new_challenge"
                required
                error={err("intent")}
                options={[
                  { value: "new_challenge", label: "Run my own challenge, pre-filled from this one" },
                  { value: "pilot_extension", label: "Ask about extending the original pilot to my area" },
                ]}
              />
              <TextAreaField label="Why this is relevant to your department" name="note" rows={4} optional error={err("note")} />
              <Callout tone="warning" icon={TriangleAlert} title="What you still have to do">
                Reuse shortens the route to a pilot; it does not remove the need for local evidence. Collect your own baseline before your pilot starts,
                because the original baseline belongs to a different context.
              </Callout>
            </div>
            <fieldset className="flex flex-col gap-5 rounded-3xl bg-surface/60 p-5">
              <legend className="sr-only">Your context, so the fit can be checked</legend>
              <div aria-hidden className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">Your context</p>
                <p className="text-[13px] text-muted-foreground">Filled in, these drive the context fit check above.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField label="Number of units" name="scale_units" type="number" min={1} inputMode="numeric" optional error={err("context.scale_units")} />
                <TextField label="Population served" name="population" type="number" min={1} inputMode="numeric" optional error={err("context.population")} />
                <TextField label="State code" name="state_code" maxLength={4} defaultValue="" placeholder="MH" optional error={err("context.state_code")} />
                <TextField label="Sector" name="sector" defaultValue={passport.sector ?? ""} optional error={err("context.sector")} />
              </div>
              <TextAreaField label="Operating environment" name="environment" rows={2} optional error={err("context.environment")} />
              <SubmitButton variant="brand" size="lg" pendingLabel="Raising the request" className="self-start">
                Raise an adoption request
                <ArrowUpRight />
              </SubmitButton>
            </fieldset>
          </form>
        </Panel>
      ) : null}
    </Page>
  );
}
