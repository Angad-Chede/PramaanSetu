# Demonstration script

Seven minutes, seven roles, one challenge from a paragraph of plain English to a validated
scale decision and a reusable passport.

## Before you start

```bash
cd backend && python -m app.seed --reset
cd backend && python -m uvicorn app.main:app --port 8000
cd frontend && npm run build && npm run start
python scripts/smoke_test.py          # 38 checks, confirms everything is live
```

Open <http://localhost:3000>. Keep the sign-in page in a second tab: switching persona is
one click from there.

The seed prints the Evidence Confidence Score and verifies the audit chain. Note the score
it prints; you will show it at minute five.

---

## 1. Define (1 minute)

**Sign in as the Department Officer**, Anita Deshmukh.

The home page is a task inbox: everything waiting on this person, sorted so that anything
overdue comes first. No dashboard to interpret, no navigation to learn.

**Challenges, then Write a new challenge.** Paste a two-paragraph description of the
problem. The example on the page is the real one: water lost between the reservoir and
household connections in the eastern zone, leaks found only when residents complain, bulk
meters read once a month.

Leave *Draft the structure for me* ticked and create the draft.

> **What just happened.** The platform proposed a title, an outcome statement, three
> measures with a measurement method for each, and a six-criterion weighted rubric, from
> the Template Kit and similar past challenges.

**Point at the empty baseline fields.** They are empty deliberately. The drafter may not
produce a number the officer did not supply; every number in its output is checked against
the numbers in the input, and anything invented is blanked and flagged. Open *How this
draft was produced* to show the model, the prompt version and the token count recorded
against the draft.

Fill the baseline (32) and target (24) on the primary measure, set the budget ceiling and
the deadline, then look at **Before you submit**: the quality checklist flags a vague
outcome with no number, a missing budget ceiling, and a similar challenge from the same
department in the last twelve months.

**Submit for approval.**

---

## 2. Approve (30 seconds)

**Sign in as the Department Approver**, Ramesh Kulkarni.

The task inbox already carries it. Open *Review for approval*: one page, one decision. The
outcome, the measures with their methods, the commercial terms, the rubric, and any quality
flags the officer submitted with.

> Separation of duties is in the platform, not in convention. Had Ramesh drafted this
> challenge, the approve button would be refused with an explanation.

**Approve and publish.** Applications open, and matched startups are notified.

---

## 3. Discover and apply (1 minute)

Back as the officer, open the challenge and look at **Matched startups**. Each match shows
its reasons in plain words: *Sector match: Water*, *Capability mentions leak detection,
acoustic, metering*. The ranking is a transparent weighted sum of four components, shown on
the same page.

> Matching decides who is *invited*. It never decides who may apply.

Open the public **Challenge board** in another tab to show what a startup sees, then the
**Demand** view: open challenges by sector and by department, so a startup can plan its
product instead of discovering opportunities by chance.

Sign in as one of the seeded startup accounts (listed in Administration, Users) and open
the application form. It is generated from the challenge, so the startup commits to a value
on each published measure.

---

## 4. Screen and evaluate (1 minute)

As the officer: **Close applications**, then **Run screening**.

Open any application and point at the eligibility table. Every published rule has a
sentence the applicant can act on. Then point at the green callout:

> **Startup relaxation applied.** Prior turnover and prior experience relaxed for this
> recognised startup, with the rule cited. Quality and technical criteria are unchanged.

That happened automatically, from the recognition check, and it is recorded against the
decision.

**Sign in as an Expert Evaluator**, Professor Sanjay Rane. The scoring workspace shows
*Applicant A*, *Applicant B*: round one is blind. Every score needs a one-line
justification. Declare no conflict, score one application, and show the anchors that say
what a 1 and a 5 look like.

Back as the officer: **Lock the scores**, then open **Ranking**. Show the variance flag on
the criterion where the panel disagreed by more than 1.5 points, and the note that the
written justifications must be read before the shortlist is confirmed.

As the approver: **Confirm the shortlist.** A pilot record is created.

---

## 5. Simulate (1 minute, the centrepiece)

As the officer, open the pilot and then **Pilot Flight Simulator**.

Set a deliberately small design first: 4 weeks, 8 units. Run it.

> Read the first number out loud. *If the solution really delivers what it claims, this
> design would detect it in 43 of every 100 pilots.* That is not a cheaper pilot. That is a
> pilot whose result you will not be able to interpret: you would not know whether the
> solution failed or the pilot was too small to see it.

Now show the recommendation and the side-by-side table: weeks, units, power, smallest
detectable change, expected cost with its 5th-to-95th-percentile range, and whether each
design fits the budget ceiling.

Point at the footnote: the closed-form power for the proposed design, and the gap from the
simulated figure, which the tests hold to within 2 percentage points.

**Freeze the design.** The confirmation says exactly what freezing means: the primary
measure, pass mark, duration, unit count and analysis method are locked, and changing any
of them afterwards needs an approved amendment that costs points on the Evidence Confidence
Score.

> This is the single most important step in the platform. The success bar is set before
> anyone has seen a result.

---

## 6. Pilot and pay (1 minute 15 seconds)

Open the agreement. It is assembled from the Template Kit, with the pre-registered plan as
Schedule 1, the milestone schedule as Schedule 2, and the data-sharing terms and
cybersecurity checklist as further schedules. Every version is kept and diffable, and the
SHA-256 of the rendered document is in the audit log.

Try to set the data storage location to Singapore. It is refused, with the field named and
the fix stated.

As the approver, **approve the agreement**. As the startup, try to **accept** it: refused,
because the cybersecurity checklist is not complete. Complete the checklist, then accept.
The pilot is active and the plan is locked.

**Upload measurements.** Use a CSV with one bad row. The platform stores the valid rows and
returns the bad one with its **line number in your file** and the reason. Then try a CSV
with a `phone` column: refused outright, because the platform stores measurements per unit,
never per person.

**Milestones.** As the startup, submit evidence. As the officer, **reject** it: the
rejection cannot be recorded without citing the evidence requirement that was not met. As
the startup, resubmit. As the officer, accept. As the approver, approve the payment. As the
finance officer, open the **Payment queue**, sorted by service level deadline, and record
the release.

**Now the escalation.** In Administration, fast-forward the clock by 8 days and run one
scheduler cycle. A milestone that has sat with the finance office past its service level is
escalated. Show it flagged red on the department dashboard and in the startup's own view:
the startup can see who holds its payment and how long they have left.

Run the scheduler cycle a second time. Nothing escalates twice.

---

## 7. Validate, decide, reuse (1 minute)

As the officer, **complete the pilot** and **run the Evidence Engine**.

Walk the Evidence Report top to bottom:

- The score, with **every component shown with its own explanation**. Effect attainment
  because the pilot delivered a stated share of what was promised. Statistical confidence
  because the whole 95 percent interval sits on the beneficial side of no change. Data
  quality from completeness and disputes. Protocol adherence because the pilot ran as
  pre-registered. Independent validation, still zero, because nobody has signed it off.
- The result with its confidence interval, and the sentence explaining how to read it.
- The limitations, stated plainly.
- The dataset hash, the seed and the engine version.

**Sign in as the Independent Validator**, Dr Anjali Rao. The workspace carries every raw
row, the pre-registered plan, the analysis as computed and a five-step checklist. Sign off
cannot be recorded until every step is confirmed.

Sign off. The score becomes final and an Innovation Passport is issued.

As the approver, open **Pathway and decision**. The recommended procurement route is shown
with its rule inputs and its reference in the General Financial Rules, and the caveat that
the final choice rests with the competent authority. The Vendor Dependency Score is shown
with each factor and its mitigation.

Try to record a Scale decision *before* sign-off (use a different pilot): refused, because
a Scale decision cannot be recorded without a signed-off Evidence Report. That rule is in
the platform, not in the interface.

**Record Scale.** The procurement handoff pack is produced as a PDF and as JSON for the
marketplace adapter, with an outcome-based specification that names no product and no
vendor.

**Finally, reuse.** Sign in as Praveen Sharma, an officer in Jaipur. Open the passport from
**Validated evidence**. Run the context fit check against 400 units in Rajasthan: it flags
that the deployment is more than twice the size and that the state differs. Raise an
adoption request. A challenge draft is pre-filled from the original with the evidence
attached, and the baseline is deliberately left blank, because the original baseline belongs
to a different context.

---

## Close (30 seconds)

**Administration, Audit.** Verify the chain: every entry recomputed, the chain intact.

Then say what that means: every state change, approval, override, score lock and sign-off
in this demonstration is in that chain, each entry linked to the one before it by a hash.
Altering one row breaks it and names the row. The application database role cannot update
or delete a single entry.

If you have a terminal to hand:

```bash
cd backend && pytest -q tests/test_concurrency.py
```

Eleven tests, including fifty concurrent approvals on one milestone producing exactly one
approval, one audit entry and one notification set, and two schedulers escalating exactly
once.

---

## If something goes wrong

| Symptom | Fix |
| --- | --- |
| A page shows *This page could not be loaded* | The API is not running. Start it, then reload. |
| Sign-in does nothing | The seed has not been run. `python -m app.seed --reset` |
| The simulator returns nothing | The challenge needs a primary measure with a baseline and target, and the proposal a committed value. |
| A task inbox is empty | Right, but a different role holds the next step. Switch persona. |
| The clock control is missing | It is enabled in local, staging and demonstration environments only. |

Reset everything in about a minute:

```bash
cd backend && python -m app.seed --reset
```
