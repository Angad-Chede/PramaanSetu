import Link from "next/link";
import { redirect } from "next/navigation";

import { apiGetOptional } from "@/lib/api";
import { compactRupees } from "@/lib/format";
import { getSession } from "@/lib/session";

import { ButtonLink, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

type Transparency = {
  challenges_published: number;
  pilots_run: number;
  validated_passports: number;
  average_confidence_score: number;
  registered_startups: number;
  average_days_submission_to_payment: number | null;
};

type Demand = {
  open_by_sector: { sector: string; open_challenges: number; total_budget: { paise: number } }[];
};

const STAGES = [
  {
    name: "Define",
    detail:
      "An officer describes the problem in their own words. The platform drafts a structured, outcome-based challenge with measures, a baseline plan and an evaluation rubric from the Template Kit. Nothing is published without a named approver.",
  },
  {
    name: "Discover",
    detail:
      "Startups are ranked against the challenge by meaning, keywords, sector and location, and the reasons are shown in plain words. Matching decides who is invited, never who may apply.",
  },
  {
    name: "Screen",
    detail:
      "A rules engine applies the published criteria and records a reason per rule. Where the government relaxation of prior turnover and experience applies to a recognised startup, it is applied automatically and the rule used is recorded.",
  },
  {
    name: "Evaluate",
    detail:
      "A panel of at least three experts scores each application against anchored criteria, blind to the applicant in round one, with a written justification for every score.",
  },
  {
    name: "Simulate",
    detail:
      "The Pilot Flight Simulator runs the pilot ten thousand times before it starts, and says whether the design could detect the improvement being claimed, and at what cost.",
  },
  {
    name: "Pilot",
    detail:
      "A standard agreement, milestone payments with service level timers, and measurement against a plan frozen before any data was collected.",
  },
  {
    name: "Validate",
    detail:
      "The Evidence Engine runs the pre-registered analysis and produces an Evidence Confidence Score. An independent validator verifies the data and signs it off, or refuses.",
  },
  {
    name: "Procure and scale",
    detail:
      "A compliant procurement route is recommended with its rule inputs shown, the approver records the decision, and the validated result becomes an Innovation Passport another department can reuse.",
  },
];

export default async function LandingPage() {
  const session = await getSession();
  if (session) redirect("/home");

  const transparency = await apiGetOptional<Transparency>("/public/transparency");
  const demand = await apiGetOptional<Demand>("/public/demand/summary");

  return (
    <div className="space-y-8">
      <section className="card overflow-hidden">
        <div className="border-b border-line bg-brand-light px-5 py-8 sm:px-8 sm:py-10">
          <p className="stat-label text-brand">Smart India Hackathon 2026, SIH26136</p>
          <h1 className="mt-3 max-w-[22ch] text-[1.9rem] leading-[1.15] sm:text-[2.4rem]">
            Every rupee spent on scaling an innovation, backed by measured evidence
          </h1>
          <p className="mt-4 max-w-prose text-ink-soft">
            PramaanSetu takes a government department from a plain-language operational problem to an
            evidence-backed procurement decision on a startup solution, in one auditable workflow. No
            stage advances on a vendor&apos;s word: every gate needs a recorded artefact, and a named
            official approves every consequential step.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/challenges-board" variant="primary">
              See open challenges
            </ButtonLink>
            <ButtonLink href="/signin">Sign in</ButtonLink>
            <ButtonLink href="/evidence">Browse validated evidence</ButtonLink>
          </div>
        </div>

        {transparency ? (
          <dl className="grid grid-cols-2 divide-line border-line sm:grid-cols-3 sm:divide-x lg:grid-cols-5">
            {[
              { label: "Challenges published", value: transparency.challenges_published },
              { label: "Pilots run", value: transparency.pilots_run },
              { label: "Validated passports", value: transparency.validated_passports },
              { label: "Startups registered", value: transparency.registered_startups },
              {
                label: "Days, submission to payment",
                value:
                  transparency.average_days_submission_to_payment === null
                    ? "Not yet measured"
                    : transparency.average_days_submission_to_payment,
              },
            ].map((item) => (
              <div key={item.label} className="border-b border-line px-5 py-4 last:border-b-0 sm:border-b-0">
                <dd className="stat">{item.value}</dd>
                <dt className="mt-1 stat-label">{item.label}</dt>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      {transparency ? (
        <p className="-mt-4 text-sm text-ink-muted">
          Figures recomputed from the platform&apos;s own records. No personal data.
        </p>
      ) : null}

      <Section
        title="How a problem becomes a procurement decision"
        description="Eight stages, each with a named actor, a precondition and an artefact that must exist before the next stage can start."
      >
        <ol className="grid gap-4 sm:grid-cols-2">
          {STAGES.map((stage, index) => (
            <li
              key={stage.name}
              className="card card-interactive flex gap-3.5 bg-paper-soft p-4"
            >
              <span
                className="num mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand/25 bg-brand-light text-sm font-semibold text-brand"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="sr-only">Stage {index + 1}</p>
                <h3>{stage.name}</h3>
                <p className="mt-1 text-sm text-ink-soft">{stage.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {demand && demand.open_by_sector.length ? (
        <Section
          title="Where demand is right now"
          description="Open challenges by sector, so a startup can plan its product and its bids instead of discovering opportunities by chance."
          actions={<ButtonLink href="/demand">Full demand view</ButtonLink>}
        >
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {demand.open_by_sector.slice(0, 6).map((row) => (
              <li key={row.sector} className="card card-interactive px-4 py-3">
                <p className="font-medium text-ink">{row.sector}</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {row.open_challenges} open challenge{row.open_challenges === 1 ? "" : "s"}, up to{" "}
                  {compactRupees(row.total_budget.paise)}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="For startups">
        <div className="prose-block space-y-2 text-ink-soft">
          <p>
            Prior turnover and prior experience criteria are relaxed for startups recognised by the
            Department for Promotion of Industry and Internal Trade, and the relaxation is applied
            automatically with the rule recorded against your application. Quality and technical
            criteria are never relaxed.
          </p>
          <p>
            Every milestone carries a service level: the department accepts or rejects within seven
            days, the approver clears payment within five, and the finance office records release
            within seven. A breach escalates on its own, and you can see who holds your milestone
            and how long they have left.
          </p>
          <p>
            A validated pilot produces an Innovation Passport you can share with any department,
            through a read-only link, so the evidence travels with you.
          </p>
        </div>
        <p className="mt-4">
          <Link href="/signin">Sign in or register a startup</Link>
        </p>
      </Section>
    </div>
  );
}
