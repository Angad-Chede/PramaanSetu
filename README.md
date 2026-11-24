# PramaanSetu

**Bridge of Proof.** PramaanSetu takes a government department from a plain-language
operational problem to an evidence-backed procurement decision on a startup solution, in
one auditable workflow.

Built for Smart India Hackathon 2026, problem statement **SIH26136** (Software), by team
**CODE REAPERS**.

---

## The problem this solves

Conventional procurement is designed for standardised goods and established vendors, not
for testing unproven solutions. The failure is on both sides. A department cannot write an
outcome-based problem statement, cannot discover or evaluate suitable startups, has no
standard pilot terms, and ends up with anecdotal pilot results that give no defensible
basis to procure. A startup is excluded by prior-turnover and experience criteria before
anyone reads its proposal, waits months on unclear payment milestones, and cannot see
where departmental demand is.

PramaanSetu closes both halves with one rule: **no stage advances on a vendor's word.**
Every gate needs a recorded artefact, and a named official approves every consequential
step.

## The five things that make it work

| Capability | What it does |
| --- | --- |
| **AI Challenge Builder** | Turns a two-paragraph description of an operational problem into a structured, outcome-based challenge with measures, measurement methods, a baseline plan and a weighted rubric, drawn from a versioned Template Kit. It may not invent a number the officer did not supply. |
| **Pilot Flight Simulator** | Runs the proposed pilot ten thousand times **before it starts** and answers one question: if the solution really delivers what it claims, will this design detect it, and at what cost? It recommends the smallest design that reaches 80 percent power within the budget ceiling, or says plainly that none does. |
| **Evidence Engine** | Runs the analysis that was **pre-registered at design freeze**, on a hash-locked dataset, and produces an Evidence Confidence Score from 0 to 100 with every component shown. An independent validator must sign it off, or refuse. |
| **Payment Pulse** | Puts a service level clock on every milestone state, reminds the holder at 75 percent, and escalates exactly once at breach. A startup can see who holds its payment and how long they have left. |
| **Innovation Passport** | Packages a validated pilot so another department can reuse the evidence instead of repeating the experiment, with a context fit check so nobody assumes a result transfers when it does not. |

---

## Run it

Two commands. One starts everything, one stops it.

**Windows**

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1 -Reset
```

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1 -Stop
```

**macOS and Linux**

```bash
./scripts/run.sh --reset
```

```bash
./scripts/run.sh --stop
```

The start command installs dependencies, seeds the database, builds the web app, frees
ports 8000 and 3000, starts both services, waits for them and runs the 38-check smoke
test. It needs Python 3.11 or later and Node 20 or later, and nothing else: the platform
runs on SQLite with no external service.

Then open <http://localhost:3000>. Sign in with any of the seeded accounts, all of which
use the password `PramaanSetu@2026`:

| Role | Email |
| --- | --- |
| Department Officer | `anita.deshmukh@pmc.gov.in` |
| Department Approver | `ramesh.kulkarni@pmc.gov.in` |
| Finance Officer | `sunita.pawar@pmc.gov.in` |
| Expert Evaluator | `sanjay.rane@iitb.ac.in` |
| Independent Validator | `anjali.rao@nabl.gov.in` |
| Platform Admin | `admin@pramaansetu.gov.in` |

Start with the Department Officer: that account owns the flagship challenge, which runs
the whole lifecycle through to a validated Evidence Report and a Scale decision.

Drop `-Reset` / `--reset` on later starts to keep the database you already have. If a
start fails, `-Status` / `--status` names whatever is holding a port.

<details>
<summary>Other ways to run it</summary>

**The full topology**, as deployed rather than simplified: PostgreSQL 16, Redis 7, MinIO,
Mailpit, the API, two worker groups split by queue, two scheduler replicas contending for
a single leader lease, and the web app.

```bash
docker compose up --build
docker compose run --rm api python -m app.seed --reset
```

**By hand**, if you want the two services in their own terminals. The web app renders every
page on the server by calling the API, so it is useless without the API running.

```bash
cd backend && pip install -r requirements-dev.txt && python -m app.seed --reset && python -m uvicorn app.main:app --port 8000
```

```bash
cd frontend && npm install && npm run build && npm run start
```

</details>

---

## What the seed builds

`python -m app.seed --reset` creates deterministic, realistic data:

- 7 departments across 3 states, with the central nodal agency
- 200 startups with capability text, verified against a seeded recognition registry
- 15 challenges, one in every lifecycle stage
- **One complete pilot**, water loss reduction in the Pune eastern zone, carried all the
  way through: baseline collection, simulation, design freeze, agreement, cybersecurity
  checklist, activation, 14 weeks of measurements, four milestones with one rejection and
  resubmission, evidence analysis, independent sign-off, scale decision, passport issue,
  and an adoption request from another district

It prints the resulting Evidence Confidence Score and verifies the audit chain. Running it
twice produces identical numbers.

---

## Repository layout

```
backend/
  app/
    core/        configuration, database, security, policy, errors, rate limits
    domain/      pure rules: state machines, eligibility, scoring, statistics,
                 simulator, Evidence Confidence Score, pathway, matching, hash chain
    models/      SQLAlchemy tables
    services/    one module per PRD module; each owns its tables
    api/v1/      HTTP layer: validate, authorise, call a service, serialise
    workers/     job runner, scheduler, task handlers, notification rules
    seed.py      deterministic demonstration data
  tests/         730 tests: unit, property, statistical, concurrency, authorisation,
                 evaluation, inbox, error shape, end-to-end through the API
  alembic/       migrations, expand-migrate-contract
frontend/
  src/app/       server-rendered pages and server actions, one directory per flow
  src/app/globals.css  the light and dark palettes, as one set of semantic tokens
  src/lib/       API client, formatting, session, form helpers
  src/components/ plain building blocks, including the theme control
infra/           PostgreSQL roles and grants
loadtest/        k6 scripts for the load, contention and deadline spike tests
scripts/         smoke test, emoji check, run scripts, demo walkthrough
docs/            architecture, runbooks, demo script, traceability matrix
```

---

## The properties worth checking

These are the claims the code actually makes good on. Each one has a test.

**A challenge cannot skip a stage.** Every transition is a row in a table with a source
state, a target, the role allowed to take it and the artefact it produces. A transition
not in that table cannot happen, whatever a client sends.
`backend/app/domain/states.py`, `tests/test_state_machines.py`

**A deadline is enforced against server time, to the second.** The comparison happens
inside the submitting transaction, and the closure job takes a row lock, so a submission
either commits before closure or is rejected after it, with a message saying how late it
was. `tests/test_concurrency.py::test_submission_at_the_deadline_is_decided_by_server_time`

**Fifty concurrent approvals produce exactly one approval.** One succeeds, 49 receive 409,
and the platform writes one audit entry and one notification set.
`tests/test_concurrency.py::test_fifty_concurrent_approvals_yield_exactly_one_success`

**Two schedulers escalate exactly once.** Single-leader lease, batch claim with skip
locked, and an escalation level check inside the same transaction.
`tests/test_concurrency.py::test_scheduler_running_twice_escalates_exactly_once`

**The simulated power matches the analytical power within 2 percentage points.** Across
five designs, including the case named in the design document: baseline 32 percent,
claimed reduction to 24, standard deviation 8.
`tests/test_simulator_statistics.py`

**The pre-registered analysis is the analysis that runs.** A rate measure with a frozen
paired test runs the paired test. The one permitted departure, a comparison design with no
comparison data, is recorded as an unapproved deviation and costs protocol adherence
points. `tests/test_evidence_engine.py`

**Altering one audit row breaks the chain and names the row.** The application database
role has INSERT and SELECT on the audit log and nothing else.
`tests/test_audit_chain.py`, `infra/postgres/roles.sql`

**Every role not listed in the permission matrix is refused on every action.** 571 assertions
over the full role-by-action grid, including the separation-of-duties rules: the officer who
drafts cannot approve, an evaluator cannot validate the same challenge, a finance officer
cannot approve a payment they will release. `tests/test_authorisation.py`

**The startup relaxation is applied automatically and recorded.** Prior turnover and prior
experience are relaxed for a recognised startup with the rule cited against the decision.
Quality and technical criteria are never relaxed. `tests/test_domain_rules.py`

**No emojis, anywhere.** Interface, notifications, generated documents, logs, seed data.
`scripts/check_no_emoji.py`, run in CI.

---

## What is real and what is mocked

Mocked behind a real interface, switchable by configuration, never by a code change:

| Adapter | Mock behaviour |
| --- | --- |
| Startup India recognition | Seeded registry; the relaxation path and the not-found path both occur |
| Government e-Marketplace | Deterministic catalogue answers; handoff export accepted |
| e-Sign | Acceptance recorded with the document SHA-256, which is what the audit trail needs |
| SMS and email | Captured in an inspectable outbox in the admin console |
| Drafting model | A deterministic rule-based drafter over a library of public-service outcome measures, so the whole Challenge Builder path works offline and in tests. An OpenAI-compatible provider is one environment variable away. |
| Embeddings | A local hashed projection with the same 1024 dimensions and the same cosine behaviour. A multilingual sentence model is one environment variable away. |

Everything else is real: the state machines, the eligibility engine, the blind evaluation,
the Monte Carlo simulator, the statistical analysis, the Evidence Confidence Score, the
service level scheduler, the hash-chained audit log, the PDF generation, the concurrency
control and the authorisation.

**Not built, by design:** money does not move. Payment Pulse tracks, approves and
escalates; disbursement stays with the treasury system.

---

## Testing

```bash
cd backend && pytest -q                    # 730 tests
cd backend && pytest -q tests/test_concurrency.py     # the race scenarios
cd backend && ruff check app tests
cd frontend && npm run typecheck && npm run lint && npm run build
python scripts/check_no_emoji.py
python scripts/smoke_test.py               # against a running stack
```

Every one of these is a gate in `.github/workflows/ci.yml`, and coverage of the domain
and service layers must stay above 70 percent.

Load and contention tests need [k6](https://k6.io):

```bash
k6 run -e BASE_URL=http://localhost:8000 loadtest/baseline.js
k6 run -e BASE_URL=http://localhost:8000 -e MILESTONE_ID=... loadtest/contention.js
```

---

## Documentation

Start with whichever question you have.

- [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md) - the whole system in plain English:
  what it does, who uses it, how the three rankings work, and what is real versus mocked.
  Read this one first if you are new to the project
- [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md) - the complete inventory:
  every layer, module, table, endpoint group, background job and state machine, and the
  path a request takes through them
- [`docs/BUGS.md`](docs/BUGS.md) - the honest register of what is broken, what is debt,
  what was fixed, and the order worth doing it in
- [`docs/architecture.md`](docs/architecture.md) - how the pieces fit, and why each
  correctness mechanism is where it is
- [`docs/demo.md`](docs/demo.md) - the seven-minute walkthrough, with the exact clicks
- [`docs/runbooks.md`](docs/runbooks.md) - restore from backup, replay dead letters,
  rotate secrets, force scheduler failover, switch an adapter, verify the audit chain
- [`docs/traceability.md`](docs/traceability.md) - every element of the problem statement
  mapped to the code and the test that proves it
- [`docs/api.md`](docs/api.md) - API conventions; the full specification is at
  `/openapi.json` and the interactive documentation at `/docs`

---

## The interface

One screen, one job. Status is always spelled out in words, never carried by colour
alone, and every error names the field, the problem and the fix.

**Light and dark.** The control sits in the top bar and offers light, dark, or follow
the device. The choice is remembered per browser; choosing *system* keeps following the
device afterwards rather than freezing whatever it happened to be at the time. A small
inline script resolves the theme in the document head, before the first paint, so a dark
user never gets a white flash on navigation.

There is no second stylesheet. Every colour in the interface is a semantic token defined
once in `src/app/globals.css`: `ink` is text, `paper` is a surface, `line` is a border,
`brand` is the department's colour and `good`/`warn`/`bad` are status. A theme is only a
different set of values for those names, so no page or component changes between the two,
and a third theme would be one more block of variables. Pages never name a raw colour.

Both themes were audited element by element in the browser against WCAG 2.1 AA: every
text-on-background pairing across the public pages, the seven role views, the forms and
a 544-element audit table clears 4.5:1, or 3:1 for large text. Printing always uses the
light palette, whichever theme is on screen, so a filed record is readable and does not
flood a page with toner.

---

## Known dependency advisories

`npm audit` reports one critical advisory that cannot be closed without a major upgrade:

| Package | Advisory | Why it is still here |
| --- | --- | --- |
| `next` 14.2.21 | Information exposure in the Next.js **dev server** because of missing origin verification | The fix is Next 16, a major version whose App Router API differs from the one this code is written against. The advisory is confined to `next dev`; the container and every deployment run `next start`, which is unaffected. Bind `next dev` to localhost only. |

The `postcss` advisory that Next 14 carries transitively is closed by the `overrides`
entry in `frontend/package.json`, which lifts that copy to the patched 8.5 line without
changing the major version. Run `npm audit --audit-level=high` after any dependency
change and add a row here rather than silencing the step.

---

## A note on what this platform claims

The Evidence Confidence Score, the pathway recommendation and the Vendor Dependency Score
inform the competent authority. They do not decide. Every template is drafted from public
guidance and is labelled for review by the department legal cell. Every statistical result
is shown with its confidence interval and its limitations, in plain words, because a
number presented without its uncertainty invites exactly the over-confidence this platform
exists to prevent.
