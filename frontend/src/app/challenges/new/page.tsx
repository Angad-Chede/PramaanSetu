import type { Metadata } from "next";
import Link from "next/link";

import { createChallenge } from "@/app/challenges/actions";
import { SubmitButton } from "@/components/forms";
import { Callout, Field, PageHeader, ProblemList, Section } from "@/components/ui";
import { readProblem } from "@/lib/forms";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Write a new challenge" };
export const dynamic = "force-dynamic";

const EXAMPLE = `In the 14 wards of the eastern zone, treated water is lost between the service reservoir and household connections. Leaks are found only when residents complain, usually several days after they start, and the ward plumber locates them by digging along the suspected line.

Bulk meters are read manually once a month, so the zonal water balance is available weeks after the period it describes and cannot be used to direct crews. Supply in the affected wards is 4 to 5 hours a day against a planned 6.`;

export default async function NewChallengePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/challenges/new");
  const problem = readProblem(searchParams);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Write a new challenge"
        subtitle="Start by describing the problem the way you would to a colleague. The platform turns it into a structured, outcome-based challenge that you then edit. Nothing is published until your approver approves it."
      />

      {problem ? (
        <div className="mb-5">
          <Callout tone="bad" title="The challenge could not be created">
            {problem.message}
          </Callout>
          <div className="mt-3">
            <ProblemList problems={problem.fields} />
          </div>
        </div>
      ) : null}

      <Section
        title="What is going wrong?"
        description="Say who is affected and how often. Do not name a technology or a supplier: the challenge asks for an outcome, not a product."
      >
        <form action={createChallenge} className="max-w-form space-y-5">
          <input type="hidden" name="department_id" value={session.department_id ?? ""} />

          <Field
            label="Describe the problem in your own words"
            name="problem_statement"
            required
            help="Two or three paragraphs is enough. Include any numbers you already have; the platform will never invent a number you did not give it."
          >
            <textarea
              id="problem_statement"
              name="problem_statement"
              rows={10}
              required
              minLength={40}
              defaultValue=""
              placeholder={EXAMPLE}
              aria-describedby="problem_statement-help"
            />
          </Field>

          <Field
            label="How is it handled today?"
            name="current_situation"
            help="The current process, the data already collected and who collects it. This becomes the baseline source."
          >
            <textarea id="current_situation" name="current_situation" rows={4} />
          </Field>

          <Field
            label="What must the solution respect?"
            name="constraints"
            help="Hard constraints: hosting, data sharing, existing assets, field conditions, staffing, anything that cannot change."
          >
            <textarea id="constraints" name="constraints" rows={4} />
          </Field>

          <div className="rounded border border-line bg-paper-soft px-4 py-3">
            <div className="flex items-start gap-3">
              <input
                id="use_ai"
                name="use_ai"
                type="checkbox"
                defaultChecked
                className="mt-1 h-4 w-4 shrink-0"
              />
              <div>
                <label htmlFor="use_ai" className="font-medium text-ink">
                  Draft the structure for me
                </label>
                <p className="mt-0.5 text-sm text-ink-soft">
                  The platform proposes a title, an outcome statement, measures with a measurement
                  method for each, and a weighted evaluation rubric, using the Template Kit and
                  similar past challenges. Everything stays fully editable, and baseline and target
                  values are left blank unless you supplied them. If the drafting service is
                  unavailable, the manual form and the Template Kit still work.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <SubmitButton pendingLabel="Creating the draft...">Create the draft</SubmitButton>
            <Link href="/challenges" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </Section>

      <Section title="What happens next">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-soft">
          <li>You edit the draft: measures, targets, budget ceiling, deadlines and the rubric.</li>
          <li>A quality check flags vague outcomes, a missing budget ceiling and possible duplicates.</li>
          <li>You submit it. Your approver reads a one-page summary and approves or returns it.</li>
          <li>On approval it is published, matched startups are notified, and applications open.</li>
        </ol>
      </Section>
    </div>
  );
}
