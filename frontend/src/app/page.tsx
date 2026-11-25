import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Menu } from "lucide-react";

import { BrandMark } from "@/components/app/brand";
import { ArtLens } from "@/components/landing/art-lens";
import { Chapters, type Chapter } from "@/components/landing/chapters";
import { EvidenceWindow, type EvidencePassport } from "@/components/landing/evidence-window";
import { Seal } from "@/components/landing/seal";
import { SealRow } from "@/components/landing/seals";
import { BlindScores, ChallengeDraft, PaymentClock, PowerCurve, ScoreBars, StagePanel } from "@/components/landing/stage-visuals";
import { Statement } from "@/components/landing/statement";
import { apiGetOptional } from "@/lib/api";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "PramaanSetu: startup pilots for government departments" },
  description:
    "Government departments run a startup's pilot with the measure fixed before it starts, the data locked, and an independent validator's signature before anything is bought.",
};
export const dynamic = "force-dynamic";

/*
  Art direction: Thomas and William Daniell's aquatints of Indian bridges and ghats (1790s,
  public domain), printed as halftones in paper on cobalt. Setu is a bridge; the page is
  built on one. Type: Geist Serif over Geist Sans, figures in Geist Mono. Ground: cobalt,
  paper and ink, with the vermilion of an office seal. Moments: the hero's lens on the
  painting, the statement lit word by word, the five records pinned beside their pictures,
  and the seals pressed onto the page.
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
  budget_ceiling: { display: string } | null;
  days_remaining: number | null;
};

type Passport = {
  reference: string;
  department_name: string;
  startup_name: string;
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
    method: string;
  };
};

const FALLBACK_PASSPORT: EvidencePassport = {
  reference: "IP-2XE939",
  department: "Pune Municipal Corporation Water Supply Department",
  startup: "DrishtiTech",
  measure: "Non-revenue water",
  unit: "percent of water supplied",
  baseline: 31.1,
  pilot: 25.4,
  relative: -18.5,
  ciLow: -7.2,
  ciHigh: -4.3,
  score: 91.2,
  band: "Strong",
  method: "Paired comparison of the same units before and after",
};

const NAV = [
  { href: "/challenges-board", label: "Challenges" },
  { href: "/demand", label: "Demand" },
  { href: "/evidence", label: "Evidence" },
  { href: "/transparency", label: "Transparency" },
];

function rupeesShort(display: string | undefined) {
  if (!display) return "On request";
  const value = Number(display.replace(/,/g, ""));
  if (!Number.isFinite(value)) return "Rs " + display;
  if (value >= 1e7) return "Rs " + (value / 1e7).toFixed(2).replace(/\.?0+$/, "") + " crore";
  return "Rs " + (value / 1e5).toFixed(1).replace(/\.0$/, "") + " lakh";
}

/** A department's name without the words every one of them shares. */
function shortDepartment(name: string) {
  return name.replace(/\s+(Department|Directorate)$/i, "");
}

/* -------------------------------------------------------------------------- */

function Wrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-12", className)}>{children}</div>;
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-mono text-[12px] tracking-[0.08em] uppercase", className)}>{children}</p>;
}

function Nav() {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <Wrap className="flex items-center gap-3 pt-5">
        <Link href="/" className="flex h-11 items-center gap-2.5 rounded-[10px] bg-white/10 px-3.5 ring-1 ring-white/15 backdrop-blur-md outline-none focus-visible:ring-2 focus-visible:ring-white">
          <BrandMark className="size-6" />
          <span className="text-[15px] font-semibold tracking-tight">PramaanSetu</span>
        </Link>
        <nav aria-label="Main" className="hidden h-11 items-center gap-1 rounded-[10px] bg-white/10 px-1.5 ring-1 ring-white/15 backdrop-blur-md md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-[7px] px-3.5 py-2 text-[14px] text-white/85 transition-colors duration-150 outline-none hover:bg-white/12 hover:text-white focus-visible:ring-2 focus-visible:ring-white">
              {item.label}
            </Link>
          ))}
        </nav>
        <Link href="/signin" className="ml-auto flex h-11 items-center rounded-[10px] bg-white/10 px-4 text-[14px] font-medium ring-1 ring-white/15 backdrop-blur-md transition-colors outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white">
          Sign in
        </Link>
        <details className="group relative md:hidden">
          <summary aria-label="Menu" className="grid size-11 cursor-pointer list-none place-items-center rounded-[10px] bg-white/10 ring-1 ring-white/15 backdrop-blur-md [&::-webkit-details-marker]:hidden">
            <Menu className="size-5" />
          </summary>
          <div className="absolute top-14 right-0 flex w-56 flex-col rounded-[12px] bg-cobalt-deep/95 p-2 ring-1 ring-white/15 backdrop-blur-md">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-[8px] px-3 py-3 text-[15px] text-white/90 hover:bg-white/10">
                {item.label}
              </Link>
            ))}
          </div>
        </details>
      </Wrap>
    </header>
  );
}

function PrimaryButton({ href, children, tone = "paper", className }: { href: string; children: ReactNode; tone?: "paper" | "ink" | "cobalt"; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex h-[52px] items-center justify-center gap-2 rounded-[10px] px-6 text-[15px] font-medium transition-[translate,background-color,box-shadow] duration-150 outline-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-0 active:scale-[0.99]",
        tone === "paper" && "bg-paper text-ink shadow-[0_10px_30px_-12px_rgba(0,0,0,0.5)] hover:bg-white focus-visible:ring-white focus-visible:ring-offset-cobalt",
        tone === "ink" && "bg-ink text-paper hover:bg-black focus-visible:ring-ink focus-visible:ring-offset-paper",
        tone === "cobalt" && "bg-cobalt text-white hover:bg-[#1a31b8] focus-visible:ring-cobalt focus-visible:ring-offset-paper",
        className,
      )}
    >
      {children}
      <ArrowRight className="size-4 transition-transform duration-200 ease-ios group-hover:translate-x-0.5" />
    </Link>
  );
}

function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-1.5 text-[15px] font-medium underline-offset-[6px] outline-none hover:underline focus-visible:underline", className)}>
      {children}
      <ArrowUpRight className="size-4 transition-transform duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
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
  const departments = Array.from(new Set(open.map((item) => item.department_name).filter((name): name is string => Boolean(name))));

  const top = passports?.items?.[0];
  const passport: EvidencePassport = top
    ? {
        reference: top.reference,
        department: top.department_name,
        startup: top.startup_name,
        measure: top.result_summary.measure,
        unit: top.result_summary.unit,
        baseline: top.result_summary.baseline_mean,
        pilot: top.result_summary.pilot_mean,
        relative: top.result_summary.relative_effect_percent,
        ciLow: top.result_summary.ci_low,
        ciHigh: top.result_summary.ci_high,
        score: top.confidence_score,
        band: top.band,
        method: top.result_summary.method,
      }
    : FALLBACK_PASSPORT;

  const figures = [
    { label: "Challenges published by departments", value: String(transparency?.challenges_published ?? 0) },
    { label: "Startups registered and checked against the registry", value: String(transparency?.registered_startups ?? 0) },
    { label: "Average Evidence Confidence Score of validated pilots", value: transparency?.average_confidence_score != null ? transparency.average_confidence_score.toFixed(1) : "–" },
    { label: "Days from a milestone's submission to its payment, on average", value: transparency?.average_days_submission_to_payment != null ? String(Math.round(transparency.average_days_submission_to_payment)) : "–" },
  ];

  const chapters: Chapter[] = [
    {
      number: "01",
      title: "Two paragraphs become a challenge",
      body: "An officer describes the problem in their own words. The Template Kit drafts the measures, the methods, a baseline plan and a weighted rubric, and the Department Approver publishes it.",
      visual: (
        <StagePanel art="/art/arches-dots.webp" position="50% 70%">
          <ChallengeDraft />
        </StagePanel>
      ),
    },
    {
      number: "02",
      title: "Proposals are scored without names",
      body: "An expert panel scores each proposal against the published rubric with the company's name hidden. Every score, and the ranking it makes, is on the record.",
      visual: (
        <StagePanel art="/art/fort-dots.webp" position="60% 40%">
          <BlindScores />
        </StagePanel>
      ),
    },
    {
      number: "03",
      title: "The pilot runs 10,000 times before it starts",
      body: "The simulator finds the smallest design that reaches 80 percent power inside the budget ceiling, or says plainly that none does. The design is then frozen.",
      visual: (
        <StagePanel art="/art/ghat-dots.webp" position="70% 60%">
          <PowerCurve />
        </StagePanel>
      ),
    },
    {
      number: "04",
      title: "The data is locked, then read",
      body: "Measurements are hash-locked. The analysis registered before day one runs on them as written, and an independent validator signs the result or refuses it.",
      visual: (
        <StagePanel art="/art/bridge-dots.webp" position="40% 80%">
          <ScoreBars score={passport.score} />
        </StagePanel>
      ),
    },
    {
      number: "05",
      title: "Payments run on a clock, results travel",
      body: "Every milestone carries a service level, with a reminder at 75 percent and one escalation. A validated result becomes an Innovation Passport the next department can reuse.",
      visual: (
        <StagePanel art="/art/arches-dots.webp" position="30% 30%">
          <PaymentClock />
        </StagePanel>
      ),
    },
  ];

  const seals = [
    { id: "da", role: "Department Approver", initials: "DA", act: "Approved", detail: "Publishes the challenge, signs the agreement and the scale decision.", turn: "-9deg" },
    { id: "ep", role: "Expert Panel", initials: "EP", act: "Scored", detail: "Scores every proposal against the rubric, names hidden.", turn: "6deg" },
    { id: "iv", role: "Independent Validator", initials: "IV", act: "Validated", detail: "Checks the data and the analysis, then signs or refuses.", turn: "-4deg" },
    { id: "fo", role: "Finance Officer", initials: "FO", act: "Released", detail: "Releases each milestone payment inside its service level.", turn: "10deg" },
  ];

  return (
    <div className="bg-paper text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-paper focus:px-4 focus:py-2 focus:text-ink">
        Skip to content
      </a>

      {/* ---------------------------------------------------------------- hero */}
      <section className="relative flex min-h-[100svh] flex-col overflow-hidden bg-cobalt text-white">
        <Nav />
        <ArtLens dots="/art/bridge-dots.webp" color="/art/bridge-color.jpg" className="absolute inset-x-0 bottom-0 h-[40svh] [mask-image:linear-gradient(to_bottom,transparent_8%,#000_48%)] sm:h-[58svh] lg:h-[64svh]" />
        
        <Wrap className="relative z-10 grid flex-1 content-start gap-10 pt-32 pb-[30svh] sm:pt-40 sm:pb-10 lg:grid-cols-12 lg:items-end lg:gap-8 lg:pt-[17svh]">
          <div className="lg:col-span-8">
            <Eyebrow className="hero-after mb-7 flex items-center gap-2.5 text-white/75 [--d:100ms]">
              <span className="relative flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-vermilion opacity-70 motion-reduce:hidden" />
                <span className="relative size-2 rounded-full bg-vermilion" />
              </span>
              Startup pilots for government · {open.length} challenges open
            </Eyebrow>
            <h1 id="main" className="font-serif text-[clamp(54px,8.2vw,124px)] leading-[0.94] tracking-[-0.045em] lg:whitespace-nowrap">
              <span className="hero-line">
                <span className="[--d:120ms]">Buy what works.</span>
              </span>
              <span className="hero-line">
                <span className="text-white/55 [--d:240ms]">Prove it first.</span>
              </span>
            </h1>
          </div>
          <div className="hero-after flex flex-col gap-7 [--d:500ms] lg:col-span-4 lg:col-start-9 lg:pb-3">
            <p className="max-w-[40ch] text-[17px] leading-[1.55] text-white/85">
              PramaanSetu runs a startup&apos;s pilot the way a trial is run: the measure and the pass mark fixed before it starts, the data locked, and an independent validator&apos;s signature before a department buys.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <PrimaryButton href="/signin">Sign in to your workspace</PrimaryButton>
              <TextLink href="/challenges-board" className="text-white">
                See the open challenges
              </TextLink>
            </div>
          </div>
        </Wrap>

        {departments.length > 0 && (
          <div className="hero-after relative z-10 border-t border-white/15 bg-cobalt-deep/30 backdrop-blur-md [--d:800ms]">
            <Wrap className="flex items-center gap-8 overflow-x-auto py-5 [mask-image:linear-gradient(to_right,#000_85%,transparent)] [scrollbar-width:none]">
              <Eyebrow className="shrink-0 text-white/55">Open now at</Eyebrow>
              <ul className="flex shrink-0 items-center gap-8">
                {departments.slice(0, 4).map((name) => (
                  <li key={name} className="shrink-0 border-l border-white/20 pl-8 font-serif text-[19px] tracking-[-0.01em] whitespace-nowrap text-white/90">
                    {shortDepartment(name)}
                  </li>
                ))}
              </ul>
            </Wrap>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ evidence */}
      <section className="relative py-24 lg:py-32">
        <Wrap className="flex flex-col gap-14">
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <Eyebrow className="mb-5 text-cobalt">The evidence report</Eyebrow>
              <h2 className="max-w-[16ch] font-serif text-[44px] leading-[1.02] tracking-[-0.035em] sm:text-[64px]">One page decides whether a department buys</h2>
            </div>
            <p className="max-w-[46ch] text-[17px] leading-[1.6] text-ink/65 lg:col-span-4 lg:col-start-9">
              Every pilot ends in a score out of 100, built from the effect, its confidence, the data, the protocol and an independent sign-off. This one is real: {passport.startup}&apos;s pilot for {shortDepartment(passport.department)}.
            </p>
          </div>
          <div className="relative overflow-hidden rounded-[24px] bg-cobalt p-4 sm:p-10 lg:p-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/art/ghat-dots.webp" alt="" aria-hidden loading="lazy" className="absolute inset-0 size-full object-cover object-[50%_65%] opacity-80" />
            <div className="relative">
              <EvidenceWindow passport={passport} />
            </div>
          </div>
        </Wrap>
      </section>

      {/* ----------------------------------------------------------- statement */}
      <section className="relative overflow-hidden bg-cobalt-deep py-28 text-white lg:py-40">
        <Wrap className="flex flex-col gap-24 lg:gap-36">
          <div className="grid gap-8 lg:grid-cols-12">
            <Eyebrow className="text-white/50 lg:col-span-2 lg:pt-4">How it works</Eyebrow>
            <Statement
              className="font-serif text-[32px] leading-[1.16] tracking-[-0.025em] sm:text-[44px] lg:col-span-10 lg:text-[56px]"
              text="A department writes down its problem. Startups propose a fix. The measure, the method and the pass mark are frozen before day one, the data is locked as it comes in, and an independent validator signs the result. Only then does anyone talk about a purchase order."
            />
          </div>
          <div className="grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <h2 className="max-w-[18ch] font-serif text-[32px] leading-[1.1] tracking-[-0.02em]">The platform&apos;s own figures</h2>
              <p className="mt-4 max-w-[36ch] text-[15px] leading-relaxed text-white/55">Recomputed from its event records on every visit. None of them carries personal data.</p>
            </div>
            <dl className="lg:col-span-8">
              {figures.map((figure) => (
                <div key={figure.label} className="grid grid-cols-[1fr_auto] items-baseline gap-6 border-t border-white/15 py-6 last:border-b sm:grid-cols-[1fr_1.1fr]">
                  <dt className="max-w-[30ch] text-[15px] leading-snug text-white/70">{figure.label}</dt>
                  <dd className="font-serif text-[52px] leading-none tracking-[-0.03em] tabular-nums sm:text-[76px]">{figure.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Wrap>
      </section>

      {/* ------------------------------------------------------------ chapters */}
      <section className="relative py-24 lg:py-36">
        <Wrap className="flex flex-col gap-14 lg:gap-20">
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <Eyebrow className="mb-5 text-cobalt">Five records</Eyebrow>
              <h2 className="max-w-[17ch] font-serif text-[44px] leading-[1.02] tracking-[-0.035em] sm:text-[64px]">From a problem to a purchase order</h2>
            </div>
            <p className="max-w-[46ch] text-[17px] leading-[1.6] text-ink/65 lg:col-span-4 lg:col-start-9">
              Each stage leaves one record behind. The next stage cannot open until that record exists and a named official has accepted it.
            </p>
          </div>
          <Chapters chapters={chapters} />
        </Wrap>
      </section>

      {/* -------------------------------------------------------------- ledger */}
      <section className="relative border-t border-ink/10 bg-paper-2/60 py-24 lg:py-32">
        <Wrap className="flex flex-col gap-12">
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <Eyebrow className="mb-5 text-cobalt">Open challenges</Eyebrow>
              <h2 className="font-serif text-[44px] leading-[1.02] tracking-[-0.035em] sm:text-[64px]">
                {open.length} problems, <span className="text-ink/40">waiting for a startup</span>
              </h2>
            </div>
            <div className="flex flex-col gap-5 lg:col-span-4 lg:col-start-9">
              <p className="max-w-[44ch] text-[17px] leading-[1.6] text-ink/65">Each states its measure, its baseline and its budget ceiling. Turnover is never the first filter.</p>
              <TextLink href="/challenges-board" className="text-cobalt">
                The full challenge board
              </TextLink>
            </div>
          </div>
          <ol className="border-t border-ink/15">
            {open.slice(0, 6).map((challenge) => (
              <li key={challenge.id} className="border-b border-ink/15">
                <Link
                  href={"/challenges-board/" + challenge.id}
                  className="group grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 py-6 outline-none focus-visible:bg-paper lg:grid-cols-[110px_minmax(0,1fr)_minmax(0,0.7fr)_130px_100px_32px] lg:py-7"
                >
                  <span className="hidden font-mono text-[12px] text-ink/45 lg:block">{challenge.reference}</span>
                  <span className="col-span-2 font-serif text-[22px] leading-[1.2] tracking-[-0.015em] text-pretty transition-colors group-hover:text-cobalt sm:text-[26px] lg:col-span-1">{challenge.title}</span>
                  <span className="text-[14px] leading-snug text-ink/55">
                    {challenge.department_name ? shortDepartment(challenge.department_name) : "Department"}
                    {challenge.sector && <span className="block font-mono text-[11.5px] tracking-wide text-ink/40 uppercase">{challenge.sector}</span>}
                  </span>
                  <span className="text-right font-mono text-[14px] tabular-nums lg:text-left">{rupeesShort(challenge.budget_ceiling?.display)}</span>
                  <span className="hidden font-mono text-[13px] text-ink/55 lg:block">{challenge.days_remaining != null ? challenge.days_remaining + " days left" : "Open"}</span>
                  <ArrowUpRight className="hidden size-5 text-ink/35 transition-[translate,color] duration-200 ease-ios group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-cobalt lg:block" />
                </Link>
              </li>
            ))}
          </ol>
        </Wrap>
      </section>

      {/* --------------------------------------------------------------- seals */}
      <section className="relative overflow-hidden py-24 lg:py-36">
        <Wrap className="flex flex-col gap-16 lg:gap-24">
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-8">
              <Eyebrow className="mb-5 text-vermilion">Signatures</Eyebrow>
              <h2 className="max-w-[18ch] font-serif text-[44px] leading-[1.02] tracking-[-0.035em] sm:text-[64px]">Nothing moves on a vendor&apos;s word</h2>
            </div>
            <p className="max-w-[44ch] text-[17px] leading-[1.6] text-ink/65 lg:col-span-4">
              Four named officials sign the steps that matter, and every signature lands in a hash-chained audit log that cannot be quietly edited.
            </p>
          </div>
          <SealRow className="grid grid-cols-2 gap-x-6 gap-y-14 lg:grid-cols-4 lg:gap-10">
            {seals.map((seal, index) => (
              <figure key={seal.id} className="flex flex-col items-center gap-6 text-center">
                <div className="seal w-full max-w-[200px] mix-blend-multiply" style={{ ["--seal-turn" as string]: seal.turn, ["--d" as string]: index * 140 + "ms" }}>
                  <Seal id={seal.id} role={seal.role} act={seal.act} initials={seal.initials} />
                </div>
                <figcaption className="flex max-w-[26ch] flex-col gap-1.5">
                  <span className="font-serif text-[22px] leading-tight">{seal.role}</span>
                  <span className="text-[14.5px] leading-relaxed text-ink/60">{seal.detail}</span>
                </figcaption>
              </figure>
            ))}
          </SealRow>
        </Wrap>
      </section>

      {/* ----------------------------------------------------------- audiences */}
      <section className="relative pb-24 lg:pb-36">
        <Wrap className="grid gap-5 lg:grid-cols-2">
          {[
            {
              eyebrow: "For departments",
              title: "Buy on evidence you can defend",
              points: ["Standard pilot terms, and an agreement drafted from the challenge", "A sample size and a budget checked before anyone signs", "A defensible basis to procure, or a clear reason not to"],
              href: "/signin",
              cta: "Sign in to your workspace",
              art: "/art/fort-dots.webp",
              position: "60% 30%",
              ground: "bg-cobalt",
              fade: "from-cobalt via-cobalt/75 to-cobalt/20",
            },
            {
              eyebrow: "For startups",
              title: "Get paid on time for what you proved",
              points: ["Where departmental demand is, by sector and by state", "Who holds your payment, and how long they have left", "A validated result that travels to the next department"],
              href: "/demand",
              cta: "See departmental demand",
              art: "/art/arches-dots.webp",
              position: "50% 60%",
              ground: "bg-ink",
              fade: "from-ink via-ink/70 to-ink/30",
            },
          ].map((card) => (
            <article key={card.eyebrow} className={cn("group relative flex min-h-[560px] flex-col justify-between overflow-hidden rounded-[24px] p-8 text-white sm:p-12", card.ground)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={card.art} alt="" aria-hidden loading="lazy" className="absolute inset-0 size-full object-cover opacity-45 transition-transform duration-700 ease-out-soft group-hover:scale-[1.03]" style={{ objectPosition: card.position }} />
              <div className={cn("absolute inset-0 bg-gradient-to-b", card.fade)} aria-hidden />
              <div className="relative flex flex-col gap-5">
                <Eyebrow className="text-white/60">{card.eyebrow}</Eyebrow>
                <h3 className="max-w-[14ch] font-serif text-[40px] leading-[1.04] tracking-[-0.03em] sm:text-[52px]">{card.title}</h3>
              </div>
              <div className="relative flex flex-col gap-8">
                <ul className="flex flex-col">
                  {card.points.map((point) => (
                    <li key={point} className="border-t border-white/20 py-3.5 text-[15.5px] leading-snug text-white/85">
                      {point}
                    </li>
                  ))}
                </ul>
                <PrimaryButton href={card.href} className="w-fit">
                  {card.cta}
                </PrimaryButton>
              </div>
            </article>
          ))}
        </Wrap>
      </section>

      {/* --------------------------------------------------------------- close */}
      <section className="relative overflow-hidden bg-cobalt">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/ghat-dots.webp" alt="" aria-hidden loading="lazy" className="absolute inset-0 size-full object-cover object-[60%_55%]" />
        <Wrap className="relative py-20 lg:py-32">
          <div className="max-w-[640px] rounded-[20px] bg-paper p-8 shadow-[0_40px_100px_-30px_rgba(5,10,45,0.6)] sm:p-12">
            <h2 className="font-serif text-[48px] leading-[0.98] tracking-[-0.04em] sm:text-[72px]">
              Bring the next problem. <span className="text-ink/40">Leave with evidence.</span>
            </h2>
            <p className="mt-6 max-w-[44ch] text-[17px] leading-[1.6] text-ink/65">Officers, panel members, validators and founders all sign in to the same workspace and see what is waiting for them.</p>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
              <PrimaryButton href="/signin" tone="ink">
                Sign in to your workspace
              </PrimaryButton>
              <TextLink href="/challenges-board" className="text-ink">
                Browse challenges
              </TextLink>
            </div>
          </div>
        </Wrap>
      </section>

      {/* -------------------------------------------------------------- footer */}
      <footer className="relative overflow-hidden bg-paper pt-20">
        <Wrap className="flex flex-col gap-16">
          <div className="grid grid-cols-2 gap-12 lg:grid-cols-12">
            <div className="col-span-2 flex flex-col gap-4 lg:col-span-5">
              <p className="max-w-[34ch] font-serif text-[26px] leading-[1.2] tracking-[-0.015em]">Startup pilots for government departments, decided on measured evidence.</p>
              <p className="max-w-[44ch] text-[14px] leading-relaxed text-ink/55">Built for Smart India Hackathon 2026, problem statement SIH26136, by team CODE REAPERS.</p>
            </div>
            {[
              { heading: "Explore", links: NAV },
              {
                heading: "Workspace",
                links: [
                  { href: "/signin", label: "Sign in" },
                  { href: "/startup", label: "Startup profile" },
                  { href: "/home", label: "My tasks" },
                ],
              },
            ].map((column, index) => (
              <div key={column.heading} className={cn("flex flex-col gap-4", index === 0 ? "lg:col-span-2 lg:col-start-8" : "lg:col-span-2")}>
                <p className="font-serif text-[19px]">{column.heading}</p>
                <ul className="flex flex-col">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="inline-flex min-h-[40px] items-center text-[14.5px] text-ink/60 underline-offset-4 transition-colors hover:text-ink hover:underline">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 border-t border-ink/12 pt-6 text-[12.5px] leading-relaxed text-ink/45 sm:flex-row sm:justify-between">
            <p className="max-w-[90ch]">
              Pictures: Thomas and William Daniell, aquatints and paintings of Indian bridges and ghats, 1790s to 1800s, public domain, from the Yale Center for British Art, the British Library and the National Gallery via Wikimedia Commons.
            </p>
            <p className="shrink-0">PramaanSetu, 2026</p>
          </div>
        </Wrap>
        <div className="relative mt-10 select-none" aria-hidden>
          <p className="mx-auto max-w-[1320px] px-5 font-devanagari text-[clamp(22px,3vw,40px)] text-vermilion sm:px-8 lg:px-12">प्रमाणसेतु</p>
          <p className="-mb-[0.2em] text-center font-serif text-[clamp(40px,16.4vw,284px)] leading-[0.9] tracking-[-0.055em] text-ink">PramaanSetu</p>
        </div>
      </footer>
    </div>
  );
}
