import type { Metadata } from "next";
import { ArrowRight, Building2, CalendarCheck, Eye, ShieldCheck } from "lucide-react";

import { Callout, KeyValues, LinkButton, Page, PageHeader, Panel } from "@/components/app/kit";
import { Badge } from "@/components/ui/badge";
import { apiGetOrNotFound } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Passport } from "@/lib/types";

import { ResultVisual, contextItems } from "../../../evidence/_components/result";
import { ScoreCard } from "../../../evidence/_components/score";

export const metadata: Metadata = { title: "Shared Innovation Passport" };
export const dynamic = "force-dynamic";

/**
 * A read-only view from a share link. No sign-in is needed, so a startup can send a
 * department the evidence for its own pilot without either side creating an account
 * first (FR-SR-05).
 */
export default async function SharedPassportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const passport = await apiGetOrNotFound<Passport & { read_only: boolean }>("/passports/shared/" + token);
  const result = passport.result_summary ?? {};
  const context = passport.context ?? {};

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <span className="font-mono text-[12px] tracking-tight">{passport.reference}</span>
            <span className="text-border">/</span>
            <Badge variant="secondary">
              <Eye />
              Read only
            </Badge>
            {passport.category && <Badge variant="outline">{passport.category}</Badge>}
          </>
        }
        title={passport.solution_name}
        description="A read-only record of an independently validated pilot result, shared by the startup that ran it."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-3.5" />
              {passport.department_name ?? "Department not recorded"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarCheck className="size-3.5" />
              Validated {formatDate(passport.validated_on)}
            </span>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="What was measured" description={String(result.method ?? "Analysis method not recorded")}>
          <ResultVisual result={result} />
        </Panel>
        <ScoreCard score={passport.confidence_score} band={passport.band} validator={passport.validator_name} validatedOn={passport.validated_on} />
      </div>

      <Callout title="How to read this">
        The measured change is the best single estimate from one pilot in one setting. The interval is the range the true change most likely lies in. Plan
        against the cautious end of it.
      </Callout>

      <Panel title="The context it ran in" description="A result is evidence about the setting it came from. Check these before assuming the same result elsewhere.">
        {Object.keys(context).length ? (
          <KeyValues columns={3} items={contextItems(context)} />
        ) : (
          <p className="text-sm text-muted-foreground">No context was recorded for this pilot.</p>
        )}
      </Panel>

      <section className="relative overflow-hidden rounded-3xl bg-[#0e0e10] p-6 text-white ring-white/10 md:p-8 dark:bg-card dark:ring-1">
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(252,76,1,0.35),transparent)]" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-2xl flex-col gap-2">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/80">
              <ShieldCheck className="size-3" />
              Reuse this evidence
            </span>
            <h2 className="font-display text-xl font-semibold tracking-tight md:text-2xl">Start from a result, not from zero</h2>
            <p className="text-[15px] leading-relaxed text-white/65">
              A department signed in to PramaanSetu can raise an adoption request from this passport. The platform pre-fills a challenge from the original with
              this evidence attached, leaving the baseline blank so the adopting department collects its own.
            </p>
          </div>
          <LinkButton href="/signin" variant="brand" size="lg" className="shrink-0">
            Sign in to raise a request
            <ArrowRight />
          </LinkButton>
        </div>
      </section>
    </Page>
  );
}
