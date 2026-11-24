# How PramaanSetu works

The whole system in plain English. No code, no jargon that is not explained where it
first appears.

If you want the technical inventory instead, read
[`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md). If you want to know *why* a particular
safeguard exists, read [`architecture.md`](architecture.md).

---

## The problem it solves

A government department has a problem it can describe in ordinary words: *"we are losing
treated water somewhere between the reservoir and people's taps, and we only find out
when someone complains."*

Somewhere there is a startup that can fix that. Normally the gap between those two facts
is crossed by a tender document, a vendor's sales deck, and hope. The department buys on
a promise, and nobody ever goes back to check whether the promise was kept.

PramaanSetu replaces the hope with **measured proof**. It walks the department from the
plain-language problem all the way to a procurement decision, and at every gate it demands
a recorded artefact before the next step can begin. Nothing moves forward on a vendor's
word.

---

## Who uses it

Seven kinds of people, each with their own view of the platform.

| Role | What they do |
| --- | --- |
| **Department Officer** | Writes the challenge, screens applications, designs the pilot, accepts the work |
| **Department Approver** | Approves the challenge for publication, confirms the shortlist, approves payments, records the final decision |
| **Startup User** | Applies, runs the pilot, submits measurements and evidence |
| **Expert Evaluator** | Scores applications against the published rubric |
| **Independent Validator** | Checks the evidence and signs it off, or refuses |
| **Finance Officer** | Records the actual release of money |
| **Platform Admin** | Manages departments, users, roles and templates |

One rule runs through all of it: **the person who drafts something cannot approve it.**
That is enforced by the software, not by a policy document somebody might ignore.

---

## The journey, stage by stage

### Stage 1 — Define the problem

The officer types the problem in their own words, the way they would explain it to a
colleague. The platform turns that into a structured challenge: a title, a clear
statement of the outcome wanted, at least two things that will be measured, and a scoring
rubric whose weights add up to 100.

**The important rule here:** the platform is forbidden from inventing numbers. If the
officer never mentioned "32 percent", no baseline of 32 percent will appear anywhere. The
field comes back blank and flagged "to be measured". Every number in the generated draft
is checked against the numbers the officer actually supplied, and anything invented is
stripped out.

The officer then fills in the real baselines, the budget ceiling, and three dates: when
applications close, when questions stop being accepted, and when evaluation must finish.

The draft goes to the approver. **A different person** must approve it before it can be
published.

### Stage 2 — Find the right startups

The moment a challenge is published, the platform reads it and compares it against every
startup in the registry, producing a ranked list of who to invite.

It does this by turning both the challenge and each startup profile into a long list of
numbers that captures what the text is *about* — so two descriptions that mean similar
things end up with similar numbers, even if they use different words. Then it measures how
close those two lists are.

That accounts for 60 percent of the match. The rest is literal keyword overlap (20
percent), whether the startup works in the right sector (15 percent), and whether it is
registered in the right state (5 percent).

Every match shows its reasoning in plain words — *"Sector match: Water"*, *"Capability
mentions leak, acoustic, metering"*, *"Overall description is 73 percent similar"*. When
nothing really matches, it says so honestly rather than pretending.

**Matching decides who gets told about a challenge. It never decides who is allowed to
apply.** Anybody can apply.

### Stage 3 — Applications close

Startups write and submit applications. They can keep editing until the deadline.

The deadline is enforced against the **database's own clock**, down to the second. Nobody
wins or loses because their laptop's clock was wrong or their connection was slow.

### Stage 4 — Screening

A rules engine checks every application against the criteria that were published with the
challenge — recognition status, sector, location, turnover, years of experience, whether
the proposed cost fits the budget, whether every declaration was signed.

It records **a reason for each rule**, not just a pass or a fail. An applicant who is
turned down can see exactly which rule they failed and why.

The government relaxation is applied here automatically: for a startup recognised by the
Department for Promotion of Industry and Internal Trade, the requirements for prior
turnover and prior experience are waived, and the specific rule used is written onto the
record. Quality and technical criteria are never relaxed.

Anyone found ineligible gets a window in which to raise a clarification.

### Stage 5 — Expert evaluation

A panel of **at least three** experts is appointed. The software enforces the things that
keep an evaluation defensible afterwards:

- the same person cannot both evaluate and validate the same challenge
- a validator cannot belong to the department running the pilot
- every evaluator must declare whether they have a conflict of interest on each
  application **before** they are allowed to score it, and declaring one blocks them from
  scoring it at all

Round one is **blind**. Evaluators see the proposal, the approach, the cost and the
timeline, labelled "Applicant A", "Applicant B". No company name, no founder names, no
logo.

Each criterion is scored from 1 to 5 against written descriptions of what each score
means, and **every single score needs a one-line written justification**. Without it the
sheet will not submit.

When every evaluator has finished, the scores **lock**. Only the approver can reopen
them, and only by recording a reason, which is kept.

### Stage 6 — Simulate the pilot before running it

This is the part most procurement processes do not have.

Before a single rupee is spent, the **Pilot Flight Simulator** runs the proposed pilot ten
thousand times in software, and answers one question:

> If the startup's claim were completely true, would this pilot actually be able to
> prove it?

That question has a real answer, and it is often uncomfortable. A two-week pilot across
three wards might have only a 30 percent chance of detecting a genuine improvement —
meaning that seven times out of ten you would spend the money and learn nothing, and then
have no idea whether the solution worked or the pilot was simply too small to tell.

The simulator sweeps different durations and different numbers of sites, and recommends
the **cheapest design that would actually work**. It will never recommend a pilot shorter
than four weeks, because a two-week water-loss pilot can be statistically adequate and
still operationally meaningless.

Then the design is **frozen**: how long, how many sites, how often to measure, what counts
as passing, and — this is the crucial part — **which statistical test will be used at the
end.**

Freezing the test in advance is the single most important idea in the platform. It removes
the ability to look at the results first and then pick whichever test makes them look
best.

### Stage 7 — Run the pilot

A standard agreement is generated from versioned templates, approved by the department,
accepted by the startup, and the exact document is fingerprinted so there can be no
argument later about what was agreed.

Then the pilot runs, and two things happen continuously.

**Measurements** arrive by whichever route suits the startup: a web form, a spreadsheet
upload, or a direct connection from their own system. Bad rows in a spreadsheet are
rejected with **the line number** and a plain description of what is wrong, so they can be
fixed rather than guessed at.

**Milestones** carry money and a clock. The officer has seven days to accept or reject the
work. The approver has five days to clear payment. The finance office has seven days to
record the release. Each of these is tracked; a reminder is sent at 75 percent of the time
elapsed, and a breach escalates by itself without anyone having to chase it.

At any moment, both sides can see who is holding a milestone and how long they have left.

### Stage 8 — Prove it, decide, and reuse it

The **Evidence Engine** runs the analysis that was frozen back in Stage 6 — not a
different one, not a more flattering one.

It produces an **Evidence Confidence Score** out of 100, broken into five parts that each
explain themselves (see below). The exact dataset used is fingerprinted, so if anyone
changes a measurement afterwards the report is marked invalid rather than left quietly
wrong.

An **independent validator** — someone from outside the department, with nothing to gain —
works through a checklist against the raw data, and then either signs off, signs off with
written reservations, or **refuses**. A refusal means no score is issued at all, and no
decision can be recorded on that pilot.

The approver then records the decision: **Scale**, **Extend the pilot**, or **Close**. The
platform recommends a compliant procurement route with the rules it used shown openly —
direct purchase on the government marketplace below ₹5 lakh, limited tender below ₹25
lakh, and so on — but the named authority decides, always.

Finally, a validated result becomes an **Innovation Passport**: a shareable read-only page
that another department can open and reuse. The next city does not have to re-run the same
pilot from scratch to find out whether the thing works.

---

## How the three rankings work

Three different things get ranked, and they are easy to confuse.

### Ranking 1 — Which startups to invite

Already described in Stage 2. Meaning 60 percent, keywords 20, sector 15, location 5.
Decides who is *told*, never who may apply.

### Ranking 2 — Which application wins

Each criterion's scores are averaged across the evaluators, converted from the 1-to-5
scale onto a 0-to-100 scale, and weighted by how important that criterion was declared to
be.

The interesting part is the tie-break. **When two applications score the same, the one
where the panel agreed ranks above the one where the panel was split.** A score of 50
built from three evaluators who all said "3" is worth more than a 50 built from evaluators
who said 5, 2 and 2 — because the second one means the panel did not actually agree about
what they were looking at.

Any criterion where the evaluators differ by more than 1.5 points is **flagged** with a
note telling the approver to read the written justifications before confirming anything.
And if not every evaluator has submitted yet, the ranking says so plainly rather than
presenting a partial result as final.

### Ranking 3 — How good is the evidence

The Evidence Confidence Score, out of 100, from five parts:

| Part | Worth | What it measures |
| --- | --- | --- |
| **Effect** | 30 | How much of the promised improvement actually arrived. Move the measure the wrong way and this is zero |
| **Confidence** | 25 | Whether the result can be told apart from chance. Full marks only if the entire plausible range of the true effect sits on the good side of "no change" |
| **Data quality** | 20 | How many of the planned measurements actually arrived, and how many were accepted without dispute |
| **Protocol** | 15 | Starts full; loses 2 points per approved change to the plan and 5 per unapproved departure from it |
| **Validation** | 10 | Full marks for a clean independent sign-off, half for one with reservations, none while it is still pending |

**80 and above is Strong. 60 to 79 is Moderate. Below 60 is Weak.**

The band advises the approver. It does not decide for them. And every part shows its own
contribution with a sentence explaining it, because a score you cannot take apart is a
score you cannot argue with.

---

## What the comparison actually compares

When the Evidence Engine measures whether the pilot worked, it is doing several different
comparisons, each answering a different question.

**Each site against its own earlier self.** Ward 7 during the pilot is compared to ward 7
before the pilot, not to the average of the zone. Sites differ from each other for all
sorts of reasons that have nothing to do with the pilot.

**The pilot sites against comparison sites that did nothing.** This is the one that
matters most. A simple before-and-after cannot tell you whether the measure improved
*because of the pilot*, or because it was going to improve anyway — it rained more, a
tariff changed, it was a different season. If comparison sites were included in the frozen
design, the engine measures how much the pilot sites changed, subtracts how much the
comparison sites changed over the same period, and what is left is the part the pilot is
actually responsible for.

If the design called for comparison sites but none were submitted, the engine does **not**
quietly switch to the simpler comparison and say nothing. It runs the simpler one,
**records it as a departure from the plan**, costs the pilot 5 protocol points, and writes
a plain warning onto the report saying that any change which would have happened anyway is
now being credited to the pilot.

**The result against what was promised.** That is the Effect component.

**The result against chance.** That is the Confidence component. It is not a simple
pass/fail on a p-value; it asks whether the whole plausible range of the true effect sits
on the beneficial side of "no change at all".

**What happened against what was planned.** Measurements received versus measurements
promised, and departures from the frozen protocol.

---

## What keeps it honest

A handful of things that are easy to describe and hard to work around.

**Every change is recorded in a chain.** Each entry in the history includes a fingerprint
of the entry before it. Edit or delete an old entry and every fingerprint after it stops
matching, and the platform detects it. The platform checks its own chain on a schedule.

**Two people cannot quietly overwrite each other.** Every record carries a version number.
If you open a form, someone else edits it, and then you save, you are told what changed and
shown the current version — rather than silently wiping their work.

**Two people cannot both approve the same thing.** Tested with fifty simultaneous
approvals of one record: exactly one succeeds, exactly one history entry is written,
exactly one notification goes out. The other forty-nine get a clear explanation.

**A notification can never fire for something that did not happen.** The record, its
history entry, and the event that triggers the notification are all written together in
one transaction. If any part fails, all of it is rolled back together.

**Double-clicking submit does not do it twice.** Every action can carry a key; sending the
same key again within 24 hours returns the original answer instead of repeating the work.

**Every error tells you how to fix it.** Not "validation failed" — instead, which field,
what is wrong with it, and what to do about it. That applies even to mistyping a web
address.

---

## What is genuinely built, and what is stubbed

Being straight about this matters more than looking impressive.

**Fully built and real:** the statistics, the simulator, the confidence scoring, the
matching mathematics, the permission system, the tamper-evident history, every state
machine, the payment timers, document generation, and all 44 screens.

**Deliberately offline:** the drafting assistant is a rule-based writer rather than a
language model, and the meaning-matching uses a classical mathematical technique rather
than a trained neural model. Both sit behind proper interfaces with a real implementation
ready on the other side — flipping one configuration value switches either to a live
provider.

This is a choice, not a shortcut. It means the whole platform runs on a laptop with no
internet and no API key, and every test produces the same answer every time. For a system
whose entire argument is *"you can re-run this and get the same number"*, that consistency
is the point.

**Stubbed behind real interfaces:** recognition lookup, the government marketplace
catalogue, electronic signature, SMS and email. Each has a mock and a live mode, and the
code calling them does not change between the two.

---

## In one paragraph

PramaanSetu is a workflow with eight gates. Each gate needs a recorded artefact and a
named human before the next one opens. Wrapped around it is a statistics engine whose
method is fixed before anyone has seen a single measurement, so the answer it gives cannot
be shopped for after the fact. Everything that happens is written into a history that
cannot be edited without the platform noticing. The result is that a department can say
not merely *"we bought this"*, but *"here is what it changed, here is how confident we are,
and here is the person outside our department who checked."*
