import type { Metadata } from "next";
import { Sparkles } from "lucide-react";

import { createChallenge } from "@/app/challenges/actions";
import { CheckField, SubmitButton, TextAreaField } from "@/components/app/forms";
import { Flash, LinkButton, Page, PageHeader, Panel, fieldErrorFor } from "@/components/app/kit";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Write a new challenge" };
export const dynamic = "force-dynamic";

const EXAMPLE = `For example: In the 14 wards of the eastern zone, treated water is lost between the service reservoir and household connections. Leaks are found only when residents complain, usually several days after they start, and the ward plumber locates them by digging along the suspected line.

Bulk meters are read manually once a month, so the zonal water balance is available weeks after the period it describes and cannot be used to direct crews. Supply in the affected wards is 4 to 5 hours a day against a planned 6.`;

const NEXT = [
  { title: "You edit the draft", body: "Measures, targets, the budget ceiling, deadlines and the rubric. Everything stays editable." },
  { title: "A quality check runs", body: "It flags vague outcomes, a missing budget ceiling and possible duplicates of past challenges." },
  { title: "Your approver decides", body: "They read a one-page summary and either approve it or return it with comments." },
  { title: "Applications open", body: "On approval it is published, matched startups are notified and the clock starts." },
];

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewChallengePage({ searchParams }: Props) {
  const params = await searchParams;
  const session = await requireSession("/challenges/new");

  return (
    <Page>
      <PageHeader
        back={{ href: "/challenges", label: "Challenges" }}
        eyebrow="AI Challenge Builder"
        title="Write a new challenge"
        description="Describe the problem the way you would to a colleague. The builder turns it into a structured, outcome-based challenge that you then edit. Nothing is published until your approver approves it."
      />

      <Flash searchParams={params} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form action={createChallenge} className="flex flex-col gap-6">
          <input type="hidden" name="department_id" value={session.department_id ?? ""} />

          <Panel
            title="What is going wrong?"
            description="Say who is affected and how often. Do not name a technology or a supplier: the challenge asks for an outcome, not a product."
          >
            <div className="flex flex-col gap-6">
              <TextAreaField
                label="The problem, in your own words"
                name="problem_statement"
                rows={10}
                required
                minLength={40}
                placeholder={EXAMPLE}
                hint="Two or three paragraphs is enough. Include any numbers you already have. The builder never invents a number you did not give it."
                error={fieldErrorFor(params, "problem_statement")}
              />
              <div className="grid gap-6 md:grid-cols-2">
                <TextAreaField
                  label="How is it handled today?"
                  name="current_situation"
                  rows={5}
                  optional
                  className="[&_textarea]:min-h-32"
                  hint="The current process, the data already collected and who collects it. This becomes the baseline source."
                  error={fieldErrorFor(params, "current_situation")}
                />
                <TextAreaField
                  label="What must the solution respect?"
                  name="constraints"
                  rows={5}
                  optional
                  className="[&_textarea]:min-h-32"
                  hint="Hosting, data sharing, existing assets, field conditions, staffing: anything that cannot change."
                  error={fieldErrorFor(params, "constraints")}
                />
              </div>
            </div>
          </Panel>

          <div className="relative overflow-hidden rounded-3xl bg-card p-5 shadow-card md:p-6">
            <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand)_18%,transparent),transparent)]" />
            <div className="relative flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand text-brand-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--brand)_30%,transparent),inset_0_1px_0_rgba(255,255,255,0.22)]">
                <Sparkles className="size-[18px]" />
              </span>
              <div className="flex min-w-0 flex-col gap-3">
                <CheckField
                  name="use_ai"
                  defaultChecked
                  label="Draft the structure for me"
                  hint="Proposes a title, an outcome statement, measures with a measurement method for each, and a weighted rubric, from the Template Kit and similar past challenges. Baselines and targets stay blank unless you supplied them. If drafting is unavailable, the manual form still works."
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <LinkButton href="/challenges" variant="ghost">
              Cancel
            </LinkButton>
            <SubmitButton variant="brand" size="lg" pendingLabel="Creating the draft">
              Create the draft
            </SubmitButton>
          </div>
        </form>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Panel title="What happens next">
            <ol className="relative flex flex-col gap-5">
              <span aria-hidden className="absolute top-3 bottom-3 left-[11px] w-px bg-border" />
              {NEXT.map((step, index) => (
                <li key={step.title} className="relative flex gap-3">
                  <span className="relative z-10 grid size-6 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-semibold text-foreground tabular-nums shadow-lift">
                    {index + 1}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium text-foreground">{step.title}</p>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
          <div className="rounded-3xl bg-surface/70 p-5 text-[13px] leading-relaxed text-muted-foreground">
            <p className="mb-1.5 font-medium text-foreground">A good problem statement</p>
            Names the place and the people affected, says how often it happens, and gives the numbers you already trust. It never says how to fix it.
          </div>
        </aside>
      </div>
    </Page>
  );
}
