import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, BadgeCheck, Clock3, FileCheck2, IndianRupee, Stamp, Users } from "lucide-react";

import { HeroWindow, type HeroPassport } from "@/components/landing/hero-window";
import { LiquidType, MarqueeRow } from "@/components/landing/moments";
import { SiteHeader } from "@/components/site/site-header";
import { Button } from "@/components/ui/button";
import { apiGetOptional } from "@/lib/api";
import { cn } from "@/lib/utils";
import { navigationFor } from "@/lib/session";

export const metadata: Metadata = {
  title: { absolute: "PramaanSetu: startup pilots for government departments" },
  description:
    "Write an outcome-based challenge, design the pilot before it starts, and buy on a result an independent validator has signed.",
};
export const dynamic = "force-dynamic";

/*
  tasteskill deal (software): hero split · palette from the product's own saffron and paper, so the
  site and the app it signs you into read as one · type Reddit Sans + JetBrains Mono · buttons pill ·
  rhythm dark-band · close-word · footer-statement · moments liquid-type (statement) and marquee-row.
*/

type Transparency = {
  challenges_published: number;
  registered_startups: number;
  average_confidence_score: number | null;
  average_days_submission_to_payment: number | null;
  validated_passports: number;
};

type PublicChallenge = {
  id: string;
  reference: string;
  title: string;
  sector: string | null;
  district: string | null;
  state_code: string | null;
  department_name: string | null;
  outcome_statement?: string;
  budget_ceiling: { display: string } | null;
  pilot_duration_weeks: number;
  days_remaining: number | null;
};

type Passport = {
  reference: string;
  department_name: string;
  confidence_score: number;
  band: string;
  result_summary: {
    measure: string;
    unit: string;
    baseline_mean: number;
    pilot_mean: number;
    relative_effect_percent: number;
    ci_low: number;
    ci_high: number;
  };
};

const STATE_NAMES: Record<string, string> = {
  MH: "Maharashtra",
  RJ: "Rajasthan",
  TN: "Tamil Nadu",
  KA: "Karnataka",
  GJ: "Gujarat",
  DL: "Delhi",
  UP: "Uttar Pradesh",
};

function rupeesShort(display: string | undefined) {
  if (!display) return "Budget on request";
  const value = Number(display.replace(/,/g, ""));
  if (!Number.isFinite(value)) return "Rs " + display;
  if (value >= 1e7) return "Rs " + (value / 1e7).toFixed(2).replace(/\.?0+$/, "") + " crore";
  return "Rs " + (value / 1e5).toFixed(1).replace(/\.0$/, "") + " lakh";
}

/* -------------------------------------------------------------------------- */

function Wrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("wrap relative z-[1] mx-auto w-full max-w-[1280px] px-6 md:px-12 xl:px-0", className)}>{children}</div>;
}

function Screen({ id, children, className, screens = 1, dark = false }: { id?: string; children: ReactNode; className?: string; screens?: 1 | 2; dark?: boolean }) {
  return (
    <section
      id={id}
      className={cn(
        "section relative pt-24 pb-16 lg:pt-[120px] lg:pb-16",
        "min-h-svh",
        screens === 1 ? "lg:h-svh" : "sm:min-h-[200svh] lg:h-[200svh]",
        dark && "dark bg-[#0e0e10] bg-[radial-gradient(60%_30%_at_50%_0%,rgba(255,255,255,0.06),transparent)] text-foreground",
        className,
      )}
    >
      {children}
    </section>
  );
}

function H2({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("max-w-[20ch] font-display text-[30px] leading-[1.08] font-medium tracking-[-0.03em] text-balance lg:text-[48px]", className)}>{children}</h2>;
}

function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("max-w-[52ch] text-[17px] leading-[1.55] text-pretty text-muted-foreground lg:text-[19px]", className)}>{children}</p>;
}

function PrimaryActions({ size = "lg", className }: { size?: "lg" | "default"; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", className)}>
      <Button asChild size={size} variant="default" className="h-12 px-6 text-[15px] hover:-translate-y-px dark:bg-white dark:text-[#111]">
        <Link href="/signin">
          Sign in to your workspace
          <ArrowRight className="transition-transform duration-200 ease-ios group-hover:translate-x-0.5" />
        </Link>
      </Button>
      <Button asChild size={size} variant="secondary" className="h-12 px-6 text-[15px] hover:-translate-y-px">
        <Link href="/challenges-board">See open challenges</Link>
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Card fragments: real product UI, small                                       */
/* -------------------------------------------------------------------------- */

function GateCard({ title, body, children, className }: { title: string; body: string; children: ReactNode; className?: string }) {
  return (
    <article className={cn("card group flex flex-col overflow-hidden rounded-[28px] bg-white/[0.04] ring-1 ring-white/[0.08] transition-[translate,background-color] duration-200 ease-ios hover:-translate-y-0.5 hover:bg-white/[0.06]", className)}>
      <div className="relative hidden min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(120%_90%_at_50%_0%,rgba(255,255,255,0.07),transparent_70%)] p-5 sm:flex">{children}</div>
      <div className="flex flex-col gap-1.5 p-6 pt-4">
        <h3 className="font-display text-[19px] font-medium tracking-tight text-white">{title}</h3>
        <p className="text-[15px] leading-relaxed text-white/60">{body}</p>
      </div>
    </article>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-ui className={cn("w-full max-w-[340px] rounded-2xl bg-[#1c1c1e] p-4 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.07),0_20px_40px_-12px_rgba(0,0,0,0.6)]", className)}>{children}</div>;
}

function BuilderFragment() {
  const rows = [
    { name: "Non-revenue water", base: "31.1%", target: "26.0%" },
    { name: "Complaints resolved in 48 h", base: "62%", target: "80%" },
  ];
  return (
    <Panel>
      <p className="text-[11px] text-white/45">Measures drafted from Template Kit v3</p>
      <div className="mt-3 flex flex-col gap-2">
        {rows.map((row, index) => (
          <div key={row.name} className="rounded-xl bg-white/[0.05] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="truncate font-medium">{row.name}</span>
              {index === 0 && <span className="shrink-0 rounded-full bg-brand/20 px-2 py-0.5 text-[10px] font-medium text-[#ff9a6b]">Primary</span>}
            </div>
            <div className="mt-1.5 flex gap-4 font-mono text-[11px] text-white/55">
              <span>baseline {row.base}</span>
              <span>target {row.target}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SimulatorFragment() {
  const points = [8, 14, 23, 34, 46, 58, 68, 76, 82, 86, 89, 91];
  const path = points.map((y, i) => `${i === 0 ? "M" : "L"}${(i / (points.length - 1)) * 280},${100 - y}`).join(" ");
  return (
    <Panel>
      <div className="flex items-center justify-between text-[11px] text-white/45">
        <span>Power by sample size, 10,000 runs</span>
        <span className="font-mono text-[#ff9a6b]">n = 48</span>
      </div>
      <svg viewBox="0 0 280 100" className="mt-3 h-24 w-full overflow-visible" aria-hidden>
        <line x1="0" x2="280" y1="20" y2="20" stroke="rgba(255,255,255,0.25)" strokeDasharray="3 4" />
        <text x="0" y="14" fill="rgba(255,255,255,0.45)" fontSize="9">80% power</text>
        <path d={path} fill="none" stroke="#fc4c01" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={(8 / 11) * 280} cy="20" r="4.5" fill="#fc4c01" stroke="#1c1c1e" strokeWidth="2" />
      </svg>
      <p className="mt-2 text-[12px] text-white/60">Smallest design inside the budget ceiling</p>
    </Panel>
  );
}

function EvidenceFragment({ score }: { score: number }) {
  return (
    <Panel>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] text-white/45">Evidence Confidence Score</p>
          <p className="mt-1 font-display text-[28px] font-medium tracking-tight tabular-nums">{score.toFixed(1)}</p>
        </div>
        <span className="rounded-full bg-[#30d158]/15 px-2 py-0.5 text-[11px] font-medium text-[#30d158]">Strong</span>
      </div>
      <div className="mt-3 flex h-2 gap-1 overflow-hidden rounded-full">
        {[30, 25, 20, 15, 10].map((weight, index) => (
          <span key={weight} className="h-full rounded-full" style={{ flex: weight, background: index === 0 ? "#fc4c01" : `rgba(255,255,255,${0.55 - index * 0.09})` }} />
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] text-white/45">effect 30 · confidence 25 · data 20 · protocol 15 · validation 10</p>
    </Panel>
  );
}

function PulseFragment({ days }: { days: number | null }) {
  const steps = [
    { label: "Accept", sla: "7 days", state: "done" },
    { label: "Approve", sla: "5 days", state: "done" },
    { label: "Release", sla: "7 days", state: "now" },
  ];
  return (
    <Panel className="max-w-[460px] lg:scale-110">
      <div className="flex items-center justify-between text-[11px] text-white/45">
        <span>Milestone 2 of 3 · Rs 9.6 lakh</span>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="size-3" />
          Finance Officer holds it
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {steps.map((step) => (
          <div key={step.label} className="flex flex-col gap-2">
            <span className={cn("h-1.5 rounded-full", step.state === "done" ? "bg-white/70" : "bg-white/10")}>
              {step.state === "now" && <span className="block h-full w-[62%] rounded-full bg-brand" />}
            </span>
            <span className="text-[13px] font-medium">{step.label}</span>
            <span className="font-mono text-[11px] text-white/45">{step.sla}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-white/60">
        Reminder at 75 percent of the clock. {days ? `Average ${Math.round(days)} days from submission to payment.` : ""}
      </p>
    </Panel>
  );
}

function PassportFragment({ passport }: { passport: HeroPassport }) {
  return (
    <Panel className="max-w-[460px] lg:scale-110">
      <div className="flex items-center justify-between text-[11px] text-white/45">
        <span className="font-mono">{passport.reference}</span>
        <span className="inline-flex items-center gap-1 text-[#30d158]">
          <BadgeCheck className="size-3.5" />
          Validated
        </span>
      </div>
      <p className="mt-3 font-display text-[17px] font-medium tracking-tight">{passport.measure}</p>
      <p className="mt-1 font-display text-[28px] font-medium tracking-tight text-[#ff9a6b] tabular-nums">{passport.relative.toFixed(1)}%</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["Urban utility", "Metered supply", "Similar zone size"].map((fit) => (
          <span key={fit} className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] text-white/70">
            {fit}
          </span>
        ))}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export default async function LandingPage() {
  const [transparency, board, passports] = await Promise.all([
    apiGetOptional<Transparency>("/public/transparency").catch(() => null),
    apiGetOptional<{ items: PublicChallenge[] }>("/public/challenges?limit=50").catch(() => null),
    apiGetOptional<{ items: Passport[] }>("/public/passports").catch(() => null),
  ]);

  const open = board?.items ?? [];
  const departments = new Set(open.map((item) => item.department_name).filter(Boolean));
  const words = Array.from(
    new Set(
      open.flatMap((item) => [item.sector, item.district ?? (item.state_code ? STATE_NAMES[item.state_code] ?? item.state_code : null)]).filter((word): word is string => Boolean(word)),
    ),
  );
  const marquee = words.length >= 4 ? words : [...words, "Water", "Urban solid waste", "Energy", "Agriculture", "Public health"].filter((word, index, all) => all.indexOf(word) === index);

  const top = passports?.items?.[0];
  const passport: HeroPassport = top
    ? {
        reference: top.reference,
        department: top.department_name,
        measure: top.result_summary.measure,
        unit: top.result_summary.unit,
        baseline: top.result_summary.baseline_mean,
        pilot: top.result_summary.pilot_mean,
        relative: top.result_summary.relative_effect_percent,
        ciLow: top.result_summary.ci_low,
        ciHigh: top.result_summary.ci_high,
        score: top.confidence_score,
        band: top.band,
      }
    : {
        reference: "IP-VGXDMZ",
        department: "Pune Municipal Corporation",
        measure: "Non-revenue water",
        unit: "percent of water supplied",
        baseline: 31.1,
        pilot: 25.4,
        relative: -18.5,
        ciLow: -7.2,
        ciHigh: -4.3,
        score: 91.2,
        band: "Strong",
      };

  const figures = [
    { value: transparency?.challenges_published ?? 0, label: "challenges published", icon: FileCheck2 },
    { value: transparency?.registered_startups ?? 0, label: "startups registered", icon: Users },
    { value: transparency?.average_confidence_score != null ? transparency.average_confidence_score.toFixed(1) : "0", label: "average confidence score of validated pilots", icon: BadgeCheck },
    { value: transparency?.average_days_submission_to_payment != null ? Math.round(transparency.average_days_submission_to_payment) : 0, label: "days from milestone submission to payment, on average", icon: IndianRupee },
  ];

  const signers = [
    { gate: "Publication", who: "Department Approver", icon: Stamp },
    { gate: "Shortlist", who: "Expert panel, scoring blinded", icon: Users },
    { gate: "Evidence", who: "Independent Validator", icon: BadgeCheck },
    { gate: "Payment", who: "Finance Officer", icon: IndianRupee },
  ];

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: "document.documentElement.classList.add('m-enter');setTimeout(()=>document.documentElement.classList.add('m-enter-done'),700)",
        }}
      />
      <SiteHeader items={navigationFor(null)} overlay className="font-display" />
      <main id="main" className="font-display" data-type="software">
        {/* hero: split, one screen under the header */}
        <section className="hero relative flex min-h-svh flex-col overflow-clip bg-[radial-gradient(50%_45%_at_75%_0%,color-mix(in_oklab,var(--brand)_10%,transparent),transparent_70%)] pt-[96px] pb-16 lg:h-svh lg:pt-[120px] lg:pb-16" data-enter>
          <Wrap className="flex flex-1 flex-col">
            <div className="hero-text flex flex-1 flex-col gap-8 lg:grid lg:h-full lg:grid-cols-12 lg:gap-6">
            <div className="flex min-w-0 flex-col lg:col-span-5">
              <p className="text-[14px] font-medium text-brand-ink animate-enter">{open.length} challenges open for applications</p>
              <h1 className="mt-4 text-[40px] leading-[1.02] font-medium tracking-[-0.04em] text-balance lg:text-[72px]">
                <span className="block animate-enter [animation-delay:60ms]">Startup pilots for</span>
                <span className="block animate-enter [animation-delay:140ms]">government departments</span>
              </h1>
              <p className="mt-6 max-w-[42ch] text-[17px] leading-[1.5] text-pretty text-muted-foreground animate-enter [animation-delay:240ms] lg:text-[20px]">
                Write an outcome-based challenge, design the pilot before it starts, and buy on a result an independent validator has signed.
              </p>
              <PrimaryActions className="mt-8 animate-enter [animation-delay:320ms]" />
            </div>
            <div className="hero__window relative min-w-0 animate-settle rounded-[28px] [animation-delay:120ms] lg:col-span-6 lg:col-start-7 lg:h-full lg:overflow-hidden">
              <HeroWindow passport={passport} />
            </div>
            </div>
          </Wrap>
        </section>

        {/* open challenges, with the marquee-row moment */}
        <Screen id="challenges" className="bg-card">
          <Wrap className="flex h-full flex-col">
            <div className="grid gap-6 lg:grid-cols-12">
              <H2 className="lg:col-span-6">Open challenges from {departments.size || "several"} departments</H2>
              <Lead className="lg:col-span-6 lg:col-start-7">
                Each one states its measure, its baseline and its budget ceiling. Apply with a proposal; turnover is never the first filter.
              </Lead>
            </div>
            <MarqueeRow items={marquee} className="mt-6 lg:mt-8" />
            <ul className="mt-6 grid gap-6 lg:mt-6 lg:min-h-0 lg:flex-1 lg:grid-cols-3">
              {open.slice(0, 3).map((item) => (
                <li key={item.id}>
                  <Link
                    href={"/challenges-board/" + item.id}
                    className="card group flex h-full min-h-[240px] flex-col rounded-[28px] bg-surface p-6 transition-[translate,box-shadow] duration-200 ease-ios outline-none hover:-translate-y-0.5 hover:shadow-float focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                  >
                    <div className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
                      <span>{item.sector ?? "Open challenge"}</span>
                      <ArrowUpRight className="size-4 transition-transform duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </div>
                    <h3 className="mt-4 text-[20px] leading-snug font-medium tracking-tight text-balance">{item.title}</h3>
                    <p className="mt-2 line-clamp-2 text-[14px] text-muted-foreground">{item.department_name}</p>
                    {item.outcome_statement && (
                      <p className="mt-5 hidden border-l-2 border-brand/50 pl-3 text-[14px] leading-relaxed text-pretty text-foreground/80 lg:line-clamp-3">{item.outcome_statement}</p>
                    )}
                    <div className="mt-auto flex items-end justify-between gap-3 pt-6">
                      <div>
                        <p className="text-[12px] text-muted-foreground">Budget ceiling</p>
                        <p className="text-[17px] font-medium tabular-nums">{rupeesShort(item.budget_ceiling?.display)}</p>
                      </div>
                      <p className="rounded-full bg-surface px-2.5 py-1 text-[12px] text-muted-foreground tabular-nums">
                        {item.days_remaining != null ? `${Math.max(0, Math.round(item.days_remaining))} days left` : `${item.pilot_duration_weeks} week pilot`}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Wrap>
        </Screen>

        {/* the five gates, a dark band over two screens */}
        <Screen id="how" screens={2} dark>
          <Wrap className="flex h-full flex-col gap-6 text-white">
            <div className="flex min-h-0 flex-1 flex-col gap-10 lg:max-h-[calc(100svh-184px)]">
              <div className="grid gap-6 lg:grid-cols-12">
                <H2 className="text-white lg:col-span-6">Five records between a problem and a purchase order</H2>
                <Lead className="text-white/60 lg:col-span-6 lg:col-start-7">
                  Each stage of PramaanSetu produces one artefact. The next stage cannot open until that artefact exists and a named official has accepted it.
                </Lead>
              </div>
              <div className="grid min-h-0 flex-1 gap-6 md:grid-cols-3">
                <GateCard title="Turns two paragraphs into a challenge" body="Measures, methods, a baseline plan and a weighted rubric, drafted from a versioned Template Kit.">
                  <BuilderFragment />
                </GateCard>
                <GateCard title="Runs the pilot 10,000 times first" body="It picks the smallest design that reaches 80 percent power inside the budget, or says none does.">
                  <SimulatorFragment />
                </GateCard>
                <GateCard title="Scores the evidence from 0 to 100" body="The pre-registered analysis runs on a hash-locked dataset. An independent validator signs or refuses.">
                  <EvidenceFragment score={passport.score} />
                </GateCard>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 gap-6 pt-16 md:grid-cols-2 lg:max-h-[calc(100svh-120px)] lg:pt-[120px]">
              <GateCard title="Puts a clock on every payment" body="Each milestone state carries a service level. The holder is reminded at 75 percent; a breach escalates exactly once.">
                <PulseFragment days={transparency?.average_days_submission_to_payment ?? null} />
              </GateCard>
              <GateCard title="Lets another department reuse the result" body="An Innovation Passport carries the validated result, with a context fit check for where it may not transfer.">
                <PassportFragment passport={passport} />
              </GateCard>
            </div>
          </Wrap>
        </Screen>

        {/* statement, with the liquid-type moment */}
        <Screen id="rule">
          <Wrap className="flex h-full flex-col">
            <LiquidType className="max-w-[14ch] text-[44px] leading-[1] font-medium tracking-[-0.045em] text-balance sm:text-[88px] lg:text-[120px]">
              Nothing advances on a vendor&apos;s word.
            </LiquidType>
            <Lead className="mt-8">Every gate needs a recorded artefact, and a named official approves each consequential step. Every approval lands in a hash-chained audit log.</Lead>
            <ul className="mt-10 grid grid-cols-2 gap-3 lg:mt-auto lg:grid-cols-4 lg:gap-6">
              {signers.map((signer) => (
                <li key={signer.gate} className="flex flex-col gap-4 rounded-[28px] bg-card p-5 shadow-card lg:gap-6 lg:p-6">
                  <span className="grid size-10 place-items-center rounded-2xl bg-brand/10 text-brand-ink">
                    <signer.icon className="size-[18px]" />
                  </span>
                  <div>
                    <p className="text-[13px] text-muted-foreground">{signer.gate}</p>
                    <p className="mt-1 text-[16px] leading-snug font-medium tracking-tight lg:text-[18px]">{signer.who}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Wrap>
        </Screen>

        {/* figures and who it serves */}
        <Screen id="figures" className="bg-card">
          <Wrap className="flex h-full flex-col">
            <div className="grid gap-6 lg:grid-cols-12">
              <H2 className="lg:col-span-6">Platform figures from its own event records</H2>
              <Lead className="lg:col-span-6 lg:col-start-7">Recomputed from the platform&apos;s records on every visit. None of them carries personal data.</Lead>
            </div>
            <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
              {figures.map((figure) => (
                <div key={figure.label} className="flex flex-col gap-2 border-t pt-5">
                  <dt className="order-2 max-w-[24ch] text-[14px] leading-snug text-muted-foreground">{figure.label}</dt>
                  <dd className="order-1 text-[38px] leading-none font-medium tracking-[-0.03em] tabular-nums lg:text-[56px]">{figure.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:mt-auto">
              {[
                {
                  title: "For departments",
                  href: "/signin",
                  cta: "Sign in to your workspace",
                  points: ["Standard pilot terms and an agreement drafted from the challenge", "A sample size and budget checked before anyone signs", "A defensible basis to procure, or a clear reason not to"],
                },
                {
                  title: "For startups",
                  href: "/demand",
                  cta: "See departmental demand",
                  points: ["Where departmental demand is, by sector and state", "Who holds your payment and how long they have left", "Validated results that travel to the next department"],
                },
              ].map((side) => (
                <div key={side.title} className="card flex flex-col gap-5 rounded-[28px] bg-surface p-6 lg:p-8">
                  <h3 className="text-[22px] font-medium tracking-tight">{side.title}</h3>
                  <ul className="flex flex-col gap-3">
                    {side.points.map((point) => (
                      <li key={point} className="flex gap-3 text-[15px] leading-snug text-muted-foreground">
                        <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
                        {point}
                      </li>
                    ))}
                  </ul>
                  <Link href={side.href} className="group mt-auto inline-flex w-fit items-center gap-1.5 text-[15px] font-medium underline-offset-4 hover:underline">
                    {side.cta}
                    <ArrowRight className="size-4 transition-transform duration-200 ease-ios group-hover:translate-x-0.5" />
                  </Link>
                </div>
              ))}
            </div>
          </Wrap>
        </Screen>
      </main>

      {/* close and footer as one section: close-word, footer-statement */}
      <footer className="closing dark relative overflow-hidden bg-[#0e0e10] bg-[radial-gradient(50%_40%_at_50%_105%,rgba(252,76,1,0.28),transparent)] pt-24 pb-10 font-display text-white lg:h-svh lg:pt-[120px]">
        <Wrap className="flex h-full flex-col">
          <div className="flex flex-col gap-6">
            <p className="max-w-[30ch] text-[22px] leading-snug tracking-tight text-white/70 lg:text-[28px]">
              Built for Smart India Hackathon 2026, problem statement SIH26136, by team CODE REAPERS.
            </p>
            <PrimaryActions />
          </div>
          <div className="mt-16 flex flex-col lg:mt-10">
          <div className="grid gap-6 border-t border-white/10 pt-10 sm:grid-cols-3">
            <nav aria-label="Explore" className="flex flex-col gap-1">
              <p className="mb-2 text-[13px] text-white/45">Explore</p>
              {navigationFor(null).map((item) => (
                <Link key={item.href} href={item.href} className="flex min-h-11 w-fit items-center text-[15px] text-white/75 transition-colors hover:text-white">
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="flex flex-col gap-1">
              <p className="mb-2 text-[13px] text-white/45">Accounts</p>
              <Link href="/signin" className="flex min-h-11 w-fit items-center text-[15px] text-white/75 transition-colors hover:text-white">
                Sign in
              </Link>
              <Link href="/startup" className="flex min-h-11 w-fit items-center text-[15px] text-white/75 transition-colors hover:text-white">
                Startup profile
              </Link>
            </div>
            <p className="self-end text-[13px] text-white/70">PramaanSetu, 2026</p>
          </div>
          <div aria-hidden className="mt-8 select-none lg:mt-10">
            <span className="text-[56px] leading-none font-medium tracking-[-0.05em] text-white sm:text-[96px] lg:text-[112px]">PramaanSetu</span>
          </div>
          </div>
        </Wrap>
      </footer>
    </>
  );
}
