import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, ClipboardList, FileCheck2, Lock, MessageCircleQuestion, Search, SearchX, Timer, Wallet } from "lucide-react";

import { EmptyState, Figure, FigureGrid, LinkButton, Page, PageHeader, Panel, ToneBadge } from "@/components/app/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { apiGet } from "@/lib/api";
import { compactRupees, formatDate, relativeDeadline } from "@/lib/format";
import { single } from "@/lib/forms";
import { getSession, hasRole } from "@/lib/session";
import { cn } from "@/lib/utils";

import { AutoSubmitForm } from "./_components/auto-submit-form";
import { SECTORS, SectorIcon } from "./_components/sector";

export const metadata: Metadata = { title: "Challenge board" };
export const dynamic = "force-dynamic";

type BoardItem = {
  id: string;
  reference: string;
  title: string;
  outcome_statement: string;
  sector: string | null;
  state_code: string | null;
  district: string | null;
  department_name: string | null;
  budget_ceiling: { paise: number } | null;
  pilot_duration_weeks: number;
  application_deadline: string | null;
  days_remaining: number | null;
  closing_soon: boolean;
  state: string;
};

type Board = {
  items: BoardItem[];
  count: number;
  filters: { budget_bands: { value: string; label: string }[] };
};

type SearchParams = Record<string, string | string[] | undefined>;

const FILTER_KEYS = ["query", "sector", "state_code", "budget_band", "closing_within_days"] as const;

const STEPS = [
  {
    icon: FileCheck2,
    title: "Check eligibility",
    body: "Prior turnover and experience are relaxed automatically for a recognised startup. Quality and technical criteria are not.",
  },
  {
    icon: ClipboardList,
    title: "Apply from your profile",
    body: "The form is generated from the challenge, so you commit to a value on every published measure.",
  },
  {
    icon: Timer,
    title: "Edit until the deadline",
    body: "The last submitted version counts. The deadline is enforced against server time, to the second.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Ask in the open",
    body: "Every question is answered to all applicants at once, and the asker is never named.",
  },
];

/** The board URL with one filter changed, keeping the rest. */
function hrefWith(params: SearchParams, key: string, value: string | null) {
  const next = new URLSearchParams();
  for (const name of [...FILTER_KEYS, "include_closed"]) {
    const current = single(params[name]);
    if (current) next.set(name, current);
  }
  if (value) next.set(key, value);
  else next.delete(key);
  const query = next.toString();
  return "/challenges-board" + (query ? "?" + query : "");
}

export default async function BoardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = single(params[key]);
    if (value) query.set(key, value);
  }
  const includeClosed = single(params.include_closed) === "yes";
  if (includeClosed) query.set("include_closed", "true");
  query.set("limit", "100");

  const [board, session] = await Promise.all([apiGet<Board>("/public/challenges?" + query.toString()), getSession()]);
  const isStartup = hasRole(session, "SU");
  const activeSector = single(params.sector);
  const filtered = FILTER_KEYS.some((key) => single(params[key])) || includeClosed;

  const onOffer = board.items.reduce((sum, item) => sum + (item.budget_ceiling?.paise ?? 0), 0);
  const closingSoon = board.items.filter((item) => item.closing_soon || (item.days_remaining !== null && item.days_remaining <= 14)).length;
  const departments = new Set(board.items.map((item) => item.department_name).filter(Boolean)).size;

  return (
    <Page className={cn(!session && "pt-10 md:pt-14")}>
      <PageHeader
        eyebrow={
          <>
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 [animation-duration:2.4s]" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            Open to every eligible startup
          </>
        }
        title="Challenge board"
        description="Open challenges from every department on the platform. Any eligible startup can apply, whether or not the platform matched it to the challenge."
        actions={
          isStartup ? (
            <LinkButton href="/my-applications" variant="secondary">
              My applications
            </LinkButton>
          ) : !session ? (
            <LinkButton href="/signin?next=%2Fchallenges-board" variant="default">
              Sign in to apply
              <ArrowRight />
            </LinkButton>
          ) : null
        }
      />

      <FigureGrid columns={4}>
        <Figure label={filtered ? "Matching challenges" : "Open challenges"} value={board.count} hint={`From ${departments} department${departments === 1 ? "" : "s"}`} icon={ClipboardList} tone="brand" />
        <Figure label="Budget on offer" value={compactRupees(onOffer).replace("INR ", "₹")} hint="Sum of published pilot ceilings" icon={Wallet} tone="success" />
        <Figure label="Closing within 14 days" value={closingSoon} hint={closingSoon ? "Apply soon, deadlines are exact" : "Nothing closes this fortnight"} icon={CalendarClock} tone={closingSoon ? "warning" : "neutral"} />
        <Figure
          label="Typical pilot"
          value={
            board.items.length
              ? Math.round(board.items.reduce((sum, item) => sum + item.pilot_duration_weeks, 0) / board.items.length) + " weeks"
              : "None"
          }
          hint="Average pilot length on this board"
          icon={Timer}
        />
      </FigureGrid>

      <Panel>
        <AutoSubmitForm className="flex flex-col gap-4">
          {activeSector && <input type="hidden" name="sector" value={activeSector} />}
          {single(params.state_code) && <input type="hidden" name="state_code" value={single(params.state_code) ?? ""} />}
          {includeClosed && <input type="hidden" name="include_closed" value="yes" />}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative flex-1">
              <span className="sr-only">Search challenges</span>
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-glyph" />
              <Input name="query" defaultValue={single(params.query) ?? ""} placeholder="Search titles and outcomes" className="h-10 pl-10" />
            </label>
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-none">
              <label className="sm:w-48">
                <span className="sr-only">Budget band</span>
                <NativeSelect name="budget_band" defaultValue={single(params.budget_band) ?? ""} className="h-10">
                  <NativeSelectOption value="">Any budget</NativeSelectOption>
                  {board.filters.budget_bands.map((band) => (
                    <NativeSelectOption key={band.value} value={band.value}>
                      {band.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="sm:w-44">
                <span className="sr-only">Closing within</span>
                <NativeSelect name="closing_within_days" defaultValue={single(params.closing_within_days) ?? ""} className="h-10">
                  <NativeSelectOption value="">Any closing date</NativeSelectOption>
                  <NativeSelectOption value="7">Closes in 7 days</NativeSelectOption>
                  <NativeSelectOption value="14">Closes in 14 days</NativeSelectOption>
                  <NativeSelectOption value="30">Closes in 30 days</NativeSelectOption>
                </NativeSelect>
              </label>
              <Button type="submit" className="col-span-2 h-10 sm:col-span-1">
                Search
              </Button>
            </div>
          </div>
          <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-none md:flex-wrap md:overflow-visible">
            <SectorChip href={hrefWith(params, "sector", null)} active={!activeSector}>
              Every sector
            </SectorChip>
            {SECTORS.map((sector) => (
              <SectorChip key={sector} href={hrefWith(params, "sector", activeSector === sector ? null : sector)} active={activeSector === sector}>
                <SectorIcon sector={sector} size="sm" className="-ml-1.5 size-6 rounded-full bg-transparent" />
                {sector}
              </SectorChip>
            ))}
            <span className="mx-1 h-5 w-px shrink-0 bg-border" />
            <SectorChip href={hrefWith(params, "include_closed", includeClosed ? null : "yes")} active={includeClosed}>
              <Lock className="size-3.5" />
              Include closed
            </SectorChip>
          </div>
        </AutoSubmitForm>
      </Panel>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight">{filtered ? "Matching challenges" : "Open challenges"}</h2>
          <p className="text-[13px] text-muted-foreground">Sorted by closing date, soonest first.</p>
        </div>
        {filtered && (
          <Link href="/challenges-board" className="text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Clear every filter
          </Link>
        )}
      </div>

      {board.items.length ? (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {board.items.map((item, index) => (
            <li key={item.id} className="min-w-0 animate-enter" style={{ animationDelay: Math.min(index, 8) * 45 + "ms" }}>
              <ChallengeCard item={item} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={SearchX}
          title="No challenge matches this filter"
          description="Clear the filter, or open the demand view to see which sectors departments are preparing challenges in."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/challenges-board">Clear the filter</LinkButton>
              <LinkButton href="/demand" variant="ghost">
                See where demand is
              </LinkButton>
            </div>
          }
        />
      )}

      <Panel title="How applying works" description="Four rules that apply to every challenge on this board.">
        <ol className="grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-surface text-glyph shadow-lift">
                  <step.icon className="size-4" />
                </span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">0{index + 1}</span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-pretty text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </Page>
  );
}

function SectorChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-200 ease-ios outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
        active ? "bg-foreground text-background shadow-lift" : "bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function ChallengeCard({ item }: { item: BoardItem }) {
  const open = item.state === "Published";
  const urgent = open && (item.closing_soon || (item.days_remaining !== null && item.days_remaining <= 7));
  const budget = item.budget_ceiling && item.budget_ceiling.paise > 0 ? compactRupees(item.budget_ceiling.paise).replace("INR ", "₹") : "Not published";
  const place = [item.district, item.state_code].filter(Boolean).join(", ");

  return (
    <Link
      href={"/challenges-board/" + item.id}
      className="group flex h-full flex-col rounded-3xl bg-card p-5 shadow-card transition-[translate,box-shadow] duration-300 ease-ios outline-none hover:-translate-y-0.5 hover:shadow-float focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <SectorIcon sector={item.sector} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium text-foreground">{item.sector ?? "Any sector"}</span>
            <span className="truncate text-[12px] text-muted-foreground">{item.department_name ?? "Department"}</span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{item.reference}</span>
      </div>

      <h3 className="mt-4 font-display text-[17px] leading-snug font-semibold tracking-tight text-balance text-foreground">{item.title}</h3>
      <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-pretty text-muted-foreground">{item.outcome_statement}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {place && <ToneBadge dot={false}>{place}</ToneBadge>}
        <ToneBadge dot={false}>{item.pilot_duration_weeks} week pilot</ToneBadge>
        {!open && <ToneBadge tone="destructive">Closed</ToneBadge>}
      </div>

      <div className="mt-auto pt-5">
        <div className="flex items-end justify-between gap-3 border-t border-border/70 pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Budget ceiling</span>
            <span className="font-display text-base font-semibold tracking-tight text-foreground tabular-nums">{budget}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {item.application_deadline ? "Closes " + formatDate(item.application_deadline) : "Deadline"}
            </span>
            {item.application_deadline ? (
              <span className={cn("inline-flex items-center gap-1 text-[13px] font-medium tabular-nums", urgent ? "text-warning-ink" : "text-foreground")}>
                {urgent && <Timer className="size-3.5" />}
                {relativeDeadline(item.application_deadline).replace(/^due /, "")}
              </span>
            ) : (
              <span className="text-[13px] text-muted-foreground">Not set</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
