import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Building2, Gauge, IndianRupee, Landmark, MapPinned, Rocket, ShieldCheck, Stamp } from "lucide-react";

import { requestCode, signInAs, verifyCode } from "@/app/actions";
import { BrandMark, Wordmark } from "@/components/app/brand";
import { SubmitButton, TextField } from "@/components/app/forms";
import { Callout } from "@/components/app/kit";
import { ThemeToggle } from "@/components/app/theme";
import { single } from "@/lib/forms";

import { CodeInput } from "./otp";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/** Accounts seeded by app/seed.py, so a reviewer can move between roles in one click. */
const PERSONAS = [
  { email: "anita.deshmukh@pmc.gov.in", name: "Anita Deshmukh", role: "Department Officer", note: "Writes challenges and runs pilots", icon: Building2 },
  { email: "ramesh.kulkarni@pmc.gov.in", name: "Ramesh Kulkarni", role: "Department Approver", note: "Approves publication, agreements and scale", icon: Stamp },
  { email: "sunita.pawar@pmc.gov.in", name: "Sunita Pawar", role: "Finance Officer", note: "Releases milestone payments", icon: IndianRupee },
  { email: "founder@netratech0016.invalid", name: "Netra Tech", role: "Startup founder", note: "Applies, uploads measurements, invoices", icon: Rocket },
  { email: "sanjay.rane@iitb.ac.in", name: "Sanjay Rane", role: "Expert Evaluator", note: "Scores blinded applications", icon: Gauge },
  { email: "anjali.rao@nabl.gov.in", name: "Anjali Rao", role: "Independent Validator", note: "Checks pilot data and signs off", icon: BadgeCheck },
  { email: "admin@pramaansetu.gov.in", name: "Platform Admin", role: "Platform Admin", note: "Users, templates, jobs and audit", icon: ShieldCheck },
  { email: "praveen.sharma@jmcg.gov.in", name: "Praveen Sharma", role: "Officer, another district", note: "Reuses evidence from a passport", icon: MapPinned },
];

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const step = single(params.step) ?? "identifier";
  const identifier = single(params.identifier) ?? "";
  const problem = single(params.problem);
  const next = single(params.next) ?? "/home";
  const codeHint = single(params.code_hint);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Wordmark />
          <ThemeToggle />
        </div>

        <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-12">
          <div className="flex flex-col gap-2 animate-enter">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-balance">
              {step === "code" ? "Check your inbox" : "Sign in to PramaanSetu"}
            </h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              {step === "code"
                ? `We sent a six-digit code to ${identifier}. It stays valid for five minutes.`
                : "Government and startup users sign in with a one-time code sent to the address on their account."}
            </p>
          </div>

          {problem && (
            <Callout tone="destructive" title="Sign in did not complete">
              {problem}
            </Callout>
          )}

          {step === "code" ? (
            <form action={verifyCode} className="flex flex-col gap-5 animate-enter [animation-delay:80ms]">
              <input type="hidden" name="identifier" value={identifier} />
              <input type="hidden" name="next" value={next} />
              {codeHint && (
                <Callout tone="info" title={`Local environment code: ${codeHint}`}>
                  Deployed environments only send the code to the account holder.
                </Callout>
              )}
              <CodeInput defaultValue={codeHint ?? undefined} />
              <SubmitButton size="lg" className="w-full" pendingLabel="Checking">
                Verify and sign in
              </SubmitButton>
              <Link href={"/signin?identifier=" + encodeURIComponent(identifier)} className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Use a different address
              </Link>
            </form>
          ) : (
            <form action={requestCode} className="flex flex-col gap-5 animate-enter [animation-delay:80ms]">
              <input type="hidden" name="next" value={next} />
              <TextField
                label="Email or mobile number"
                name="identifier"
                autoComplete="username"
                required
                autoFocus
                defaultValue={identifier}
                placeholder="name@department.gov.in"
                className="[&_input]:h-11"
              />
              <SubmitButton size="lg" className="w-full" pendingLabel="Sending the code">
                Send me a code
                <ArrowRight />
              </SubmitButton>
            </form>
          )}

          <p className="text-[13px] leading-relaxed text-muted-foreground">
            New startup? Your founder account is created when your registry profile is approved. Browse the{" "}
            <Link href="/challenges-board" className="text-foreground underline underline-offset-4">
              open challenges
            </Link>{" "}
            without signing in.
          </p>
        </main>
      </div>

      <aside className="relative overflow-hidden bg-[#0e0e10] px-5 py-10 text-white sm:px-10 lg:m-3 lg:rounded-[28px] lg:py-12">
        <div aria-hidden className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(252,76,1,0.35),transparent)]" />
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)] [--foreground:#fff]" />
        <div className="relative flex h-full flex-col gap-8">
          <div className="flex items-center gap-3">
            <BrandMark className="size-9" />
            <div>
              <p className="text-[13px] font-medium text-white/60">Demonstration</p>
              <h2 className="font-display text-xl font-semibold tracking-tight">Walk the workflow as anyone</h2>
            </div>
          </div>
          <p className="max-w-md text-[15px] leading-relaxed text-white/65">
            Each account below comes from the seed data. Pick one to sign in straight away and see the platform through that role.
          </p>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {PERSONAS.map((persona, index) => (
              <li key={persona.email} className="animate-enter" style={{ animationDelay: 120 + index * 40 + "ms" }}>
                <form action={signInAs}>
                  <input type="hidden" name="identifier" value={persona.email} />
                  <input type="hidden" name="next" value={next} />
                  <button
                    type="submit"
                    className="group flex w-full items-center gap-3 rounded-2xl bg-white/[0.05] p-3 text-left ring-1 ring-white/[0.08] transition-[background-color,translate,box-shadow] duration-200 ease-ios outline-none hover:-translate-y-0.5 hover:bg-white/[0.09] hover:ring-white/15 focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-white/80 transition-colors group-hover:bg-brand group-hover:text-white">
                      <persona.icon className="size-[18px]" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{persona.role}</span>
                      <span className="truncate text-[12px] text-white/50">{persona.note}</span>
                    </span>
                    <ArrowRight className="ml-auto size-4 shrink-0 text-white/30 transition-[translate,color] duration-200 ease-ios group-hover:translate-x-0.5 group-hover:text-white" />
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex items-center gap-2 text-[12px] text-white/45">
            <Landmark className="size-3.5" />
            Startup accounts are listed under Users in the admin console. Seeded passwords: PramaanSetu@2026
          </div>
        </div>
      </aside>
    </div>
  );
}
