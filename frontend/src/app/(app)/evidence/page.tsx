import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Building2, CalendarCheck, FileSearch, Lock, Ruler, Scale, Search, ShieldCheck, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { SelectField, TextField } from "@/components/app/forms";
import { EmptyState, LinkButton, Page, PageHeader, SectionHeading, bandToneOf } from "@/components/app/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import { decimal, formatDate, signed } from "@/lib/format";
import { single } from "@/lib/forms";
import { getSession } from "@/lib/session";
import type { Passport } from "@/lib/types";

import { improved } from "./_components/result";
import { ScoreRing } from "./_components/score";

export const metadata: Metadata = { title: "Validated evidence" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STEPS = [
  { icon: Ruler, title: "Read the interval", body: "Read the measured result with its confidence interval, not just the headline number. The interval is the range the true effect most likely lies in." },
  { icon: FileSearch, title: "Read the context", body: "A result from 24 metering areas in one city is evidence about that setting, not a guarantee about yours." },
  { icon: Scale, title: "Check the fit", body: "Run the context fit check against your own scale, population and environment. It highlights the differences you have to judge." },
  { icon: Sparkles, title: "Raise an adoption request", body: "The platform pre-fills a challenge from the original with the evidence attached, leaving the baseline blank for you to collect locally." },
];

export default async function EvidenceIndexPage({ searchParams }: Props) {
  const params = await searchParams;
  const session = await getSession();
  const query = new URLSearchParams({ limit: "60" });
  for (const key of ["category", "sector", "query", "min_score"]) {
    const value = single(params[key]);
    if (value) query.set(key, value);
  }

  const path = session ? "/passports?" + query.toString() : "/public/passports?" + query.toString();
  const body = await apiGet<{ items: Passport[]; count?: number; note?: string }>(path);
  const categories = Array.from(new Set(body.items.map((item) => item.category))).sort();
  const filtered = ["category", "sector", "query", "min_score"].some((key) => single(params[key]));
  const count = body.items.length;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck className="size-3.5 text-success" />
            Independently validated
          </>
        }
        title="Validated evidence"
        description="Every entry rests on a pilot whose plan was frozen before data collection and whose result an independent validator verified. Read the context before assuming the same result in a different setting."
        meta={
          <Badge variant="secondary" className="tabular-nums">
            {count} Innovation Passport{count === 1 ? "" : "s"}
          </Badge>
        }
      />

      <form method="get" className="grid items-end gap-4 rounded-3xl bg-card p-5 shadow-card sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" role="search">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <TextField label="Search" name="query" defaultValue={single(params.query) ?? ""} placeholder="Solution or problem category" className="[&_input]:pl-9" />
          <Search aria-hidden className="pointer-events-none absolute bottom-2.5 left-3 size-4 text-glyph" />
        </div>
        <SelectField
          label="Category"
          name="category"
          defaultValue={single(params.category) ?? ""}
          placeholder="Every category"
          options={categories.map((category) => ({ value: category, label: category }))}
        />
        <SelectField
          label="Minimum score"
          name="min_score"
          defaultValue={single(params.min_score) ?? ""}
          placeholder="Any score"
          options={[
            { value: "80", label: "Strong, 80 and above" },
            { value: "60", label: "Moderate or better, 60 and above" },
          ]}
        />
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" className="flex-1 lg:flex-none">
            Apply
          </Button>
          {filtered && (
            <LinkButton href="/evidence" variant="ghost">
              Clear
            </LinkButton>
          )}
        </div>
      </form>

      {session && body.note && <p className="-mt-2 px-1 text-[13px] text-muted-foreground">{body.note}</p>}

      {count ? (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {body.items.map((passport, index) => (
            <li key={passport.reference} className="min-w-0 animate-enter" style={{ animationDelay: index * 50 + "ms" }}>
              <PassportCard passport={passport} href={session && passport.id ? "/evidence/" + passport.id : null} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title={filtered ? "Nothing matches this filter" : "No validated evidence yet"}
          description="A passport is issued automatically when an independent validator signs off a pilot."
          action={filtered ? <LinkButton href="/evidence">Clear the filter</LinkButton> : undefined}
        />
      )}

      <SectionHeading title="How to use a passport" description="Four steps between someone else's result and your own pilot." />
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-3 rounded-3xl bg-card p-5 shadow-card">
            <div className="flex items-center justify-between">
              <span className="grid size-9 place-items-center rounded-full bg-surface text-glyph">
                <step.icon className="size-4" />
              </span>
              <span className="font-display text-[13px] font-semibold text-muted-foreground tabular-nums">0{index + 1}</span>
            </div>
            <h3 className="font-display text-[15px] font-semibold tracking-tight">{step.title}</h3>
            <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
    </Page>
  );
}

function PassportCard({ passport, href }: { passport: Passport; href: string | null }) {
  const result = passport.result_summary ?? {};
  const better = improved(result);
  const effect = Number(result.effect);
  const Trend = effect < 0 ? ArrowDownRight : ArrowUpRight;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{passport.category}</Badge>
            {passport.state_code && <Badge variant="outline">{passport.state_code}</Badge>}
          </div>
          <h3 className="line-clamp-3 font-display text-[15px] leading-snug font-semibold tracking-tight text-balance text-foreground">{passport.solution_name}</h3>
          <p className="truncate text-[13px] text-muted-foreground">{passport.startup_name}</p>
        </div>
        <ScoreRing score={passport.confidence_score} band={passport.band} />
      </div>

      <div className="rounded-2xl bg-surface/70 p-4">
        {result.measure ? (
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">{String(result.measure)}</span>
            <div className="flex items-baseline gap-2">
              <span className={cn("font-display text-2xl font-semibold tracking-tight tabular-nums", better ? "text-success-ink" : better === false ? "text-destructive-ink" : "text-foreground")}>
                {signed(effect, 2)}
              </span>
              {result.relative_effect_percent != null && (
                <span className={cn("ml-auto inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums", better ? "text-success-ink" : "text-destructive-ink")}>
                  <Trend className="size-3" />
                  {signed(Number(result.relative_effect_percent), 1)}%
                </span>
              )}
            </div>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {String(result.unit ?? "")}, interval {decimal(Number(result.ci_low), 2)} to {decimal(Number(result.ci_high), 2)}
            </span>
          </div>
        ) : (
          <span className="text-[13px] text-muted-foreground">Result not recorded</span>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2 text-[12px] text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <Building2 className="size-3.5 shrink-0" />
          <span className="truncate">{passport.department_name}</span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <CalendarCheck className="size-3.5 shrink-0" />
            Validated {formatDate(passport.validated_on)}
          </span>
          <span className={cn("font-medium", bandToneOf(passport.band) === "success" ? "text-success-ink" : "text-warning-ink")}>{passport.band}</span>
        </span>
      </div>
    </>
  );

  const shell = "flex h-full flex-col gap-4 rounded-3xl bg-card p-5 shadow-card";

  if (!href) {
    return (
      <article className={shell}>
        {inner}
        <Link href="/signin?next=/evidence" className="flex items-center gap-1.5 border-t pt-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <Lock className="size-3.5" />
          Sign in to read the full passport
        </Link>
      </article>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        shell,
        "group transition-[translate,box-shadow] duration-200 ease-ios outline-none hover:-translate-y-0.5 hover:shadow-float focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {inner}
    </Link>
  );
}
