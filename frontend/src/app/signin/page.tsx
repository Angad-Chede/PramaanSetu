import type { Metadata } from "next";

import { requestCode, signInAs, verifyCode } from "@/app/actions";
import { SubmitButton } from "@/components/forms";
import { Callout, Field, PageHeader, Section } from "@/components/ui";
import { single } from "@/lib/forms";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/** Accounts seeded by app/seed.py, so a reviewer can move between roles in one click. */
const DEMO_ACCOUNTS = [
  { email: "anita.deshmukh@pmc.gov.in", role: "Department Officer", note: "Writes and runs challenges" },
  { email: "ramesh.kulkarni@pmc.gov.in", role: "Department Approver", note: "Approves publication, agreements, payments and scale" },
  { email: "sunita.pawar@pmc.gov.in", role: "Finance Officer", note: "Records payment releases" },
  { email: "sanjay.rane@iitb.ac.in", role: "Expert Evaluator", note: "Scores blinded applications" },
  { email: "anjali.rao@nabl.gov.in", role: "Independent Validator", note: "Verifies pilot data and signs off" },
  { email: "admin@pramaansetu.gov.in", role: "Platform Admin", note: "Users, templates, jobs and audit" },
  { email: "praveen.sharma@jmcg.gov.in", role: "Officer, another district", note: "Reuses evidence from a passport" },
  { email: "founder@netratech0016.invalid", role: "Startup Founder / Applicant", note: "Submits proposals, uploads pilot measurements, milestone invoices" },
];

export default function SignInPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const step = single(searchParams?.step) ?? "identifier";
  const identifier = single(searchParams?.identifier) ?? "";
  const problem = single(searchParams?.problem);
  const next = single(searchParams?.next) ?? "/home";
  const codeHint = single(searchParams?.code_hint);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Sign in to PramaanSetu"
        subtitle="Government users sign in with a one-time code sent to the address on their account. Startup users sign in with a password and a one-time code."
      />

      {problem ? (
        <div className="mb-5">
          <Callout tone="bad" title="Sign in could not be completed">
            {problem}
          </Callout>
        </div>
      ) : null}

      {step === "code" ? (
        <Section
          title="Enter the code"
          description={"A one-time code was sent to " + identifier + ". It is valid for five minutes."}
        >
          {codeHint ? (
            <div className="mb-4">
              <Callout tone="warn" title="Local environment">
                The code for this local environment is <span className="num font-semibold">{codeHint}</span>.
                In any deployed environment the code is only sent to the account holder.
              </Callout>
            </div>
          ) : null}
          <form action={verifyCode} className="max-w-form space-y-4">
            <input type="hidden" name="identifier" value={identifier} />
            <input type="hidden" name="next" value={next} />
            <Field
              label="One-time code"
              name="code"
              required
              help="Six digits. If it has expired, ask for a new one."
            >
              <input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{4,10}"
                required
                autoFocus
                className="num max-w-[12rem] tracking-widest"
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              <SubmitButton pendingLabel="Checking the code...">Sign in</SubmitButton>
              <a href="/signin" className="btn btn-secondary">
                Use a different address
              </a>
            </div>
          </form>
        </Section>
      ) : (
        <Section
          title="Your email address or mobile number"
          description="We send a one-time code to the address or number on your account."
        >
          <form action={requestCode} className="max-w-form space-y-4">
            <input type="hidden" name="next" value={next} />
            <Field
              label="Email address or mobile number"
              name="identifier"
              required
              help="Use the address your department or startup registered."
            >
              <input
                id="identifier"
                name="identifier"
                autoComplete="username"
                required
                autoFocus
                defaultValue={identifier}
              />
            </Field>
            <SubmitButton pendingLabel="Sending the code...">Send me a code</SubmitButton>
          </form>
        </Section>
      )}

      <Section
        title="Demonstration accounts"
        description="These accounts are created by the seed script. Selecting one signs you in directly, so a reviewer can walk the whole workflow without seven mailboxes."
      >
        <ul className="divide-y divide-line">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{account.role}</p>
                <p className="text-sm text-ink-muted">
                  {account.email} &mdash; {account.note}
                </p>
              </div>
              <form action={signInAs}>
                <input type="hidden" name="identifier" value={account.email} />
                <input type="hidden" name="next" value={next} />
                <SubmitButton variant="secondary" pendingLabel="Signing in...">
                  Sign in as this user
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-muted">
          Startup accounts are listed in the administration console under Users. Every seeded
          account uses the password PramaanSetu@2026 where a password is needed.
        </p>
      </Section>
    </div>
  );
}
