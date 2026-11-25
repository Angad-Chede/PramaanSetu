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
import { PersonaButton } from "./persona-button";

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
            <h1 className="font-serif text-[40px] leading-[1.05] font-normal tracking-[-0.03em] text-balance">
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

      <aside className="relative overflow-hidden bg-cobalt px-5 py-10 text-white sm:px-10 lg:m-3 lg:rounded-[28px] lg:py-12">
        {/* the landing page's bridge, carried through to the door */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/bridge-dots.webp" alt="" aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] w-full object-cover object-bottom opacity-80 [mask-image:linear-gradient(to_bottom,transparent,#000_55%)]" />
        <div className="relative flex h-full flex-col gap-8">
          <div className="flex items-center gap-3">
            <BrandMark className="size-9" />
            <div>
              <p className="text-[13px] font-medium text-white/60">Demonstration</p>
              <h2 className="font-serif text-[26px] leading-tight tracking-[-0.02em]">Walk the workflow as anyone</h2>
            </div>
          </div>
          <p className="max-w-md text-[15px] leading-relaxed text-white/75">
            Each account below comes from the seed data. Pick one to sign in straight away and see the platform through that role.
          </p>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {PERSONAS.map((persona, index) => (
              <li key={persona.email} className="animate-enter" style={{ animationDelay: 120 + index * 40 + "ms" }}>
                <form action={signInAs}>
                  <input type="hidden" name="identifier" value={persona.email} />
                  <input type="hidden" name="next" value={next} />
                  <PersonaButton icon={<persona.icon className="size-[18px]" />} role={persona.role} note={persona.note} />
                </form>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex items-center gap-2 rounded-xl bg-cobalt-deep/50 px-3 py-2.5 text-[12px] text-white/75 backdrop-blur-md">
            <Landmark className="size-3.5" />
            Startup accounts are listed under Users in the admin console. Seeded passwords: PramaanSetu@2026
          </div>
        </div>
      </aside>
    </div>
  );
}
