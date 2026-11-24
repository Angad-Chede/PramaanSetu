# System architecture

The complete map of PramaanSetu: every layer, module, table, endpoint group, background
job and state machine, and how a request travels through them.

This file is the **inventory**: what exists and where it lives.
[`architecture.md`](architecture.md) is the **rationale**: why each correctness mechanism
is where it is. [`HOW_IT_WORKS.md`](HOW_IT_WORKS.md) is the same system in plain English,
with no code references.

Built for Smart India Hackathon 2026, problem statement SIH26136, by team CODE REAPERS.

---

## 1. Shape

Two processes and one database. Nothing else is required to run the whole platform.

```
                        ┌──────────────────────────────┐
  Browser  ────────────>│  Web application (port 3000) │
                        │  Next.js 14, App Router      │
                        │  every page rendered on the  │
                        │  server by calling the API   │
                        └──────────────┬───────────────┘
                                       │  HTTP, cookies forwarded
                                       v
                        ┌──────────────────────────────┐
                        │  API (port 8000)             │
                        │  FastAPI + SQLAlchemy async  │
                        │  ┌────────────────────────┐  │
                        │  │ api/v1    validate     │  │
                        │  │ core      authorise    │  │
                        │  │ services  do the work  │  │
                        │  │ domain    pure rules   │  │
                        │  │ models    tables       │  │
                        │  └────────────────────────┘  │
                        │  ┌────────────────────────┐  │
                        │  │ workers  runner        │  │
                        │  │          scheduler     │  │
                        │  └────────────────────────┘  │
                        └──────────────┬───────────────┘
                                       v
                        ┌──────────────────────────────┐
                        │  SQLite (default)            │
                        │  PostgreSQL 16 (full deploy) │
                        └──────────────────────────────┘
```

The web app is **useless without the API**. Every page is server-rendered by calling the
same endpoints the tests call, so there is one implementation of every rule, not two.

### Deployment topologies

| Topology | What runs | When to use it |
| --- | --- | --- |
| **Single machine** (default) | API + web app + SQLite file, job runner and scheduler in-process | Development, demo, review |
| **Full** (`docker compose`) | PostgreSQL 16, Redis 7, MinIO, Mailpit, API, two worker groups split by queue, two scheduler replicas contending for one leader lease, web app | The deployment shape from the design |

Switching between them is configuration only: `DATABASE_URL`, `REDIS_URL`, `STORAGE_*`.
No code path differs.

---

## 2. Backend layers

Strict downward dependency. `domain` knows nothing about the database; `models` know
nothing about HTTP.

### `app/domain/` — pure rules, no I/O

Every file here is a pure function library. This is what makes the rules testable without
a database and reviewable without reading infrastructure.

| Module | Responsibility |
| --- | --- |
| `states.py` | All four state machines, roles, allowed transitions, `check_transition` |
| `eligibility.py` | The screening rules engine, one recorded reason per rule |
| `matching.py` | `0.60·cosine + 0.20·keyword + 0.15·sector + 0.05·location`, with reasons |
| `scoring.py` | Evaluator aggregation, weighted score, variance flags, ranking |
| `simulator.py` | Monte Carlo pilot simulation and the design recommender |
| `statistics.py` | Paired t, Wilcoxon, Welch difference-in-differences, two-proportion, Wilson interval, bootstrap CI, power |
| `ecs.py` | Evidence Confidence Score: the five components and the bands |
| `pathway.py` | Procurement route recommendation against GFR thresholds |
| `hashchain.py` | Audit chain hashing and verification |

### `app/models/` — SQLAlchemy 2.0 tables

39 tables across 12 modules. `base.py` carries the shared mixins: UUID v7 primary keys,
UTC timestamps, JSON columns, and the `version` column that optimistic locking uses.

| Module | Tables |
| --- | --- |
| `identity.py` | `department`, `app_user`, `role_assignment`, `refresh_token`, `otp_code`, `login_attempt` |
| `startup.py` | `startup`, `startup_embedding` |
| `challenge.py` | `challenge`, `kpi`, `rubric_criterion`, `clarification`, `corrigendum`, `challenge_embedding`, `match_result` |
| `application.py` | `application`, `eligibility_result` |
| `evaluation.py` | `panel_member`, `coi_declaration`, `evaluation_score` |
| `simulation.py` | `simulation_run`, `pilot_design` |
| `pilot.py` | `pilot`, `agreement_version`, `metric_submission` |
| `payment.py` | `milestone`, `payment_release` |
| `evidence.py` | `evidence_report` |
| `scale.py` | `scale_decision`, `innovation_passport`, `adoption_request` |
| `platform.py` | `audit_log`, `outbox_event`, `job`, `notification`, `idempotency_key`, `leader_lock`, `file_object`, `template` |

### `app/services/` — one module per PRD module, each owning its tables

| Module | Responsibility |
| --- | --- |
| `challenges.py` | Draft, quality checklist, blocking problems, publish, corrigenda |
| `applications.py` | Start, submit, lock at deadline, screen, override eligibility |
| `evaluation.py` | Panel assignment, conflict declarations, blind scoring, lock/reopen, ranking, shortlist |
| `simulation.py` | Run the simulator, explain the result in plain words |
| `pilots.py` | Create, agreement versions, freeze design, metric ingestion (form/CSV/API), disputes |
| `payments.py` | Milestones, SLA clocks, reminders, escalation, release recording |
| `evidence.py` | Run the pre-registered analysis, dataset hash, validator workspace, sign-off |
| `scale.py` | Scale decision, procurement pathway, Innovation Passport, adoption requests |
| `startups.py` | Registry profile, DPIIT verification, passports held |
| `inbox.py` | The per-role task list: what is waiting for you, overdue first |
| `notifications.py` | In-app notifications and digests |
| `templates.py` | The versioned Template Kit (8 templates) |
| `llm.py` | LLM gateway: schema validation, retry, no-invented-numbers, circuit breaker |
| `embeddings.py` | Embedding provider and the stored vectors |
| `audit.py` | Append-only hash-chained log and verification |
| `outbox.py` | Transactional outbox writes |
| `jobs.py` | Job enqueue, claim, status |
| `files.py` | Upload, scan, metadata, retrieval |
| `pdf.py` | Evidence Report and agreement PDF generation |
| `adapters/` | `dpiit`, `gem`, `esign`, `sms`, `email` — each `mock` or `live` behind one interface |

### `app/api/v1/` — HTTP only

15 routers, 117 paths. Each endpoint does four things and nothing else: validate the
body, authorise the principal, call a service, serialise the result.

`auth`, `me`, `challenges`, `applications`, `evaluation`, `pilots`, `milestones`,
`evidence`, `scale`, `startups`, `files`, `jobs`, `admin`, `public`, `health`.

### `app/core/` — cross-cutting machinery

| Module | Responsibility |
| --- | --- |
| `config.py` | Every setting, environment-driven. Nothing environment-specific in code |
| `db.py` | Engine, session scope, `lock_row`, SQLite `BEGIN IMMEDIATE` |
| `policy.py` | The single deny-by-default `can(principal, action, resource)` decision point |
| `deps.py` | FastAPI dependencies: session, principal, CSRF |
| `errors.py` | RFC 9457 problem documents; every error carries a fix |
| `security.py` | Argon2 hashing, tokens, redaction, IP hashing |
| `idempotency.py` | Idempotency-Key storage and replay |
| `ratelimit.py` | Per-identity read and write limits |
| `ids.py` | UUID v7 and short human references |
| `money.py` | Integer paise, Indian digit grouping |
| `clock.py` | UTC now, plus a demonstration offset |
| `logging.py` | Structured JSON to stdout, with secrets scrubbed |
| `hash.py`, `pagination.py` | Content hashing, cursor pagination |

### `app/workers/`

| Module | Responsibility |
| --- | --- |
| `runner.py` | Job runner: claims work with `FOR UPDATE SKIP LOCKED`, retries with backoff, dead-letters |
| `scheduler.py` | Single-leader periodic work, guarded by a database lease |
| `tasks.py` | The 15 job handlers |
| `notify_rules.py` | Which event produces which notification, for whom |

---

## 3. The four state machines

Every state change is an explicit action endpoint. There is no endpoint that writes a
state field directly. An action from the wrong state returns **409 with the list of
actions that *are* available** from where you actually are.

**Challenge** — 14 states

```
Draft ──submit──> InReview ──approve──> Published ──deadline──> ApplicationsClosed
  ^                   │                     │                          │
  └───── return ──────┘                   cancel                    screen
                                            │                          v
                                            v                      Screening
                                        Cancelled                      │
                                                                       v
   Scaled <─ decide ─ DecisionPending <─ validate ─ Validation <── Evaluation
      │                                                  ^             │
    Closed                                          PilotActive <── Shortlisted
                                                         ^             │
                                                    PilotDesign <──────┘
```

**Application** — `Draft -> Submitted -> Locked -> Screened -> UnderEvaluation ->
Shortlisted | NotShortlisted`, plus `Withdrawn`

**Pilot** — `AgreementDraft -> AwaitingStartup -> Active <-> Paused -> Completed | Terminated`

**Milestone** — `Pending -> Submitted -> Accepted -> PaymentApproved -> Paid`, with
`Rejected` returning to the startup

Terminal states have no outgoing transitions, and this is tested exhaustively: every
transition in every machine is exercised from every source state it declares.

---

## 4. Request lifecycle

What happens on every single call, in order:

1. **Middleware** — request id, body size limit, rate limit, timing, security headers
   (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, CSP, HSTS when secure)
2. **Session** — access token cookie read; if it expired, the web app's middleware
   silently refreshes it against `/auth/refresh` so nobody is bounced mid-form
3. **CSRF** — double-submit token required on every write
4. **Authorisation** — one call to `can(principal, action, resource)`. Deny by default:
   no role means no access. Scope is checked against the record's department or startup,
   not merely the role name
5. **Idempotency** — if an `Idempotency-Key` was sent and seen within 24 hours, the
   original response is replayed without repeating the work
6. **Optimistic lock** — a write carrying `If-Match` with a stale version gets **409 plus
   the current record**, not a silent overwrite
7. **The service runs inside one transaction**, which also writes
   - the **audit entry**, hash-chained to the previous one
   - the **outbox event**
8. **Commit** — all of it together, or none of it

Because the audit entry and the outbox event commit with the data, there can never be a
notification for a transaction that rolled back, nor an audit line for something that did
not happen.

### Error shape

Every error is an RFC 9457 problem document with `type`, `title`, `status`, `detail`,
`instance` and a **fix** — including the ones nobody writes a handler for, such as a
mistyped address (404) or a wrong method (405).

---

## 5. Background work

### Job runner

Five queues, so a slow PDF never delays an approval: `critical`, `default`, `ai`,
`compute`, `docs`.

Claiming uses `SELECT ... FOR UPDATE SKIP LOCKED`, so two runners never take the same
job. Failures retry with backoff up to `max_attempts`, then dead-letter for replay.

**The 15 handlers**

| Job type | What it does |
| --- | --- |
| `challenge.ai_draft` | Draft a structured challenge from the officer's words |
| `challenge.embed_and_match` | Embed the challenge and rank startups against it |
| `challenge.invite_matches` | Notify the ranked startups |
| `startup.refresh_embedding` | Re-embed a changed startup profile |
| `startup.verify_dpiit` | Check DPIIT recognition through the adapter |
| `simulation.run` | Run the Monte Carlo pilot simulation |
| `evidence.issue_passport` | Issue an Innovation Passport on sign-off |
| `notify.event` | Turn one outbox event into notifications |
| `notify.digest` | Periodic digest |
| `platform.relay_outbox` | Move outbox rows into the job queue |
| `platform.scan_slas` | Reminders at 75 percent, escalation at breach |
| `platform.close_deadlines` | Close applications at the deadline, to the second |
| `platform.verify_audit_chain` | Re-verify the whole hash chain |
| `platform.purge_idempotency` | Expire keys past 24 hours |
| `milestone.recheck` | Reports one milestone's state and escalation level. **Registered but never enqueued** - see [BUGS.md](BUGS.md) |

### Scheduler

Periodic work, run by exactly one leader. The lease lives in `leader_lock`; a second
replica sees a live lease and stands by. Escalation checks the milestone's
`escalation_level` **inside** the transaction, so even two schedulers racing produce
exactly one escalation.

---

## 6. Correctness mechanisms

| Mechanism | Where | Guards against |
| --- | --- | --- |
| Optimistic locking (`version` + ETag + `If-Match`) | `core/db.py`, every write endpoint | Two people editing the same record, last writer silently winning |
| Pessimistic row lock (`FOR UPDATE`, SQLite `BEGIN IMMEDIATE`) | `core/db.py::lock_row` | Two approvals of the same record at once |
| Unique constraints | `models/` | Everything above failing; the last line of defence |
| Transactional outbox | `services/outbox.py` | A notification for work that rolled back |
| Idempotency keys | `core/idempotency.py` | A double-clicked submit doing the work twice |
| Hash-chained audit log | `domain/hashchain.py`, `services/audit.py` | History being edited or deleted without detection |
| Single-leader lease | `workers/scheduler.py` | Duplicate escalations from two schedulers |
| `SKIP LOCKED` batch claim | `workers/runner.py` | Two workers running the same job |
| Server-clock deadlines | `services/applications.py` | A wrong client clock winning or losing a bid |
| Separation of duties | `core/policy.py` | The person who drafted approving their own work |

All of these are verified under real concurrency in `tests/test_concurrency.py`: 50
simultaneous approvals produce exactly 1 success, 1 audit entry and 1 outbox event.

---

## 7. Authorisation

One function. One decision point. Deny by default.

```python
can(principal, action, resource) -> bool
```

A principal carries **scoped roles**: a role plus the scope it applies in (`global`,
`department`, `startup`, `challenge`). A Department Officer in Pune has no rights over a
Jaipur challenge; an evaluator's rights exist only on the challenges they are empanelled
on.

Separation of duties lives here too, not in policy documents:

- the officer who drafted a challenge cannot approve it
- the same person cannot be evaluator and validator on one challenge
- a validator cannot belong to the department running the pilot
- the approver who cleared a payment cannot also record its release

A 571-assertion matrix in `tests/test_authorisation.py` checks every role against every
action against in-scope, out-of-scope and no-scope resources.

---

## 8. Data flow: one challenge, end to end

```
officer types a problem
   └─> POST /challenges                        challenge (Draft)
   └─> POST /challenges/{id}/ai-draft   ──job──> llm.py ──> kpis + rubric_criterion
officer completes measures and deadlines
   └─> POST /challenges/{id}/submit            challenge (InReview)
approver (a different person)
   └─> POST /challenges/{id}/approve           challenge (Published)
                                        ──job──> challenge_embedding
                                                 match_result (ranked)
                                        ──job──> notification (invitations)
startups apply
   └─> POST /applications                      application (Draft -> Submitted)
deadline passes                          ──sched──> application (Locked)
                                                    challenge (ApplicationsClosed)
officer screens
   └─> POST /challenges/{id}/screen            eligibility_result (one reason per rule)
officer assigns the panel
   └─> POST /challenges/{id}/panel             panel_member + challenge-scoped roles
evaluators declare and score
   └─> POST /applications/{id}/coi             coi_declaration
   └─> POST /applications/{id}/scores          evaluation_score  (blind, justified)
   └─> POST /challenges/{id}/lock-scores       scores locked
approver confirms
   └─> POST /challenges/{id}/shortlist         application (Shortlisted)
                                                pilot (AgreementDraft)
officer designs the pilot
   └─> POST /pilots/{id}/simulate       ──job──> simulation_run (10,000 iterations)
   └─> POST /pilots/{id}/design/freeze          pilot_design  <- METHOD FROZEN HERE
agreement
   └─> agreement_version -> approved -> accepted  pilot (Active)
pilot runs
   └─> POST /pilots/{id}/metrics                metric_submission (form | CSV | API)
   └─> milestone: Submitted -> Accepted -> PaymentApproved -> Paid
                                          ──sched──> reminders and escalation
analysis
   └─> POST /pilots/{id}/evidence/run           evidence_report + dataset hash
                                                 runs the FROZEN method, not a new one
validator verifies
   └─> POST /evidence/{id}/sign-off             ECS issued, band assigned
                                         ──job──> innovation_passport
approver decides
   └─> POST /pilots/{id}/decision               scale_decision + procurement pathway
                                                 challenge (Scaled | Closed)
another department reuses it
   └─> POST /passports/{id}/adopt               adoption_request
```

Every arrow above also writes one `audit_log` row and, where it matters, one
`outbox_event`.

---

## 9. The three ranking pipelines

They are separate and easily confused.

| | **Matching** | **Evaluation** | **Evidence Confidence** |
| --- | --- | --- | --- |
| Question | Who should we invite? | Who should win? | Is the proof any good? |
| Where | `domain/matching.py` | `domain/scoring.py` | `domain/ecs.py` |
| Formula | `0.60·cos + 0.20·kw + 0.15·sector + 0.05·loc` | weighted mean of 1–5 anchored criteria, rescaled to 0–100 | `E(30) + C(25) + D(20) + P(15) + V(10)` |
| Tie-break | score order | **lower panel disagreement** | none; the band decides guidance |
| Decides | who is told, never who may apply | the proposed order; the approver confirms | advice to the approver, never the decision |

### Evidence Confidence Score in full

| Component | Max | How it is earned |
| --- | --- | --- |
| **E** Effect attainment | 30 | `30 × clip(observed / target, 0, 1)`, direction-aware. Wrong direction scores zero |
| **C** Statistical confidence | 25 | Whole 95 percent interval on the beneficial side -> 25; only the 90 percent -> 12; straddles zero -> 0 |
| **D** Data quality | 20 | `20 × completeness × clean_share` |
| **P** Protocol adherence | 15 | 15, minus 2 per approved amendment, minus 5 per unapproved deviation |
| **V** Independent validation | 10 | Clean sign-off 10; with qualifications 5; pending 0 |

Bands: **Strong ≥80, Moderate 60–79, Weak <60.** A refused validation issues **no score
at all**, and no scale decision can be recorded on it.

---

## 10. The statistical machinery

### Pilot Flight Simulator

Model: `y[i,t] = mu + u[i] + w[i,t]` — a unit effect plus period noise. 10,000 iterations
with a stored seed, sweeping duration and unit count, returning the cheapest design that
reaches adequate power, with an operational floor of 4 weeks.

Validated against closed-form power: simulated and analytical agree within 2 percentage
points across five designs, including the PRD's named case (baseline 32, claim 24, sd 8).

### Evidence Engine

The analysis is **chosen at design freeze, before any data exists**. That is the whole
point: it removes the freedom to pick a favourable test after seeing the numbers.

| Frozen method | Comparison performed |
| --- | --- |
| `paired_t` / `wilcoxon` | Each unit against its own baseline; Wilcoxon if the normality check fails |
| `welch_did` | `(treatment_after − treatment_before) − (comparison_after − comparison_before)` |
| `two_proportion` | Rate against rate, Wilson interval |

Confidence intervals are percentile bootstrap, 10,000 resamples, **seed stored on the
report**, so a re-run reproduces the number exactly.

The one permitted departure is a DiD design with no comparison data submitted. It falls
back to paired, **records an unapproved deviation** (costing 5 protocol points), and says
so on the report. It does not quietly substitute a different test.

The report stores a **dataset hash**. Change one measurement afterwards and the report is
marked invalid rather than silently wrong.

---

## 11. Integrations

Every external system sits behind one interface with a `mock` and a `live` mode. The
calling code does not change when the mode flips.

| Adapter | Mock behaviour | Live target |
| --- | --- | --- |
| `dpiit` | Deterministic recognition by number pattern | DPIIT recognition API |
| `gem` | Category availability from a local table | GeM catalogue |
| `esign` | Records a signature reference and hash | Aadhaar e-Sign |
| `sms` | Writes to the notification table | SMS gateway |
| `email` | Writes to the notification table | SMTP |
| `llm` | Deterministic rule-based drafter over a domain library | Any OpenAI-compatible endpoint |
| `embeddings` | Local hashing projection, 1024 dimensions | Any sentence embedding model |

All are wrapped in a circuit breaker. An open breaker degrades the feature with a clear
message rather than failing the request.

---

## 12. Frontend

Next.js 14 App Router, React Server Components, TypeScript strict, Tailwind.

- ~44 pages, one per job, grouped by flow
- Server Actions for writes, so there is no client-side API duplication
- `middleware.ts` refreshes an expired access token silently
- `not-found.tsx` and `error.tsx` give plain, actionable boundaries
- The home page **is** the task inbox: overdue first, then by deadline
- Light and dark themes from one set of semantic colour tokens; both audited to WCAG 2.1 AA
- 87.1 kB shared first-load JavaScript

---

## 13. Testing

| Suite | What it proves |
| --- | --- |
| `test_domain_rules.py` | Scoring, eligibility, ECS, money, pathway |
| `test_state_machines.py` | 100 percent transition coverage, plus Hypothesis property tests |
| `test_authorisation.py` | 571 assertions across every role, action and scope |
| `test_concurrency.py` | Real races: 50 approvals -> 1 success; two schedulers -> 1 escalation |
| `test_simulator_statistics.py` | Simulated power matches analytical power within 2 points |
| `test_evidence_engine.py` | The frozen method runs; departures are recorded |
| `test_evaluation_panel.py` | Panel composition, conflicts, locking, ranking, shortlist |
| `test_inbox.py` | Each role sees only its own work; overdue sorts first |
| `test_error_shape.py` | Every error is a problem document with a fix |
| `test_lifecycle_api.py` | One challenge from problem to passport, through the HTTP API |
| `test_audit_chain.py` | Tampering is detected |

**730 tests.** Domain and service coverage 75 percent, floor 70.

### CI gates

No emoji · `ruff check` · `mypy` · 730 tests · coverage ≥70 percent · seed determinism ·
OpenAPI 3.1 generates · frontend typecheck, lint and build · 38-check smoke test.

---

## 14. What is real and what is mocked

| Real | Mocked, behind a real interface |
| --- | --- |
| All statistics, simulation, ECS | LLM drafter (deterministic, rule-based) |
| Embeddings and cosine matching (classical hashing, not neural) | DPIIT verification |
| Hash-chained audit, concurrency control, SLA clocks | GeM catalogue, e-Sign, SMS, email |
| PDF generation, payment state machine | |

**No trained ML model runs anywhere.** The provider seams exist and are honest; both sit
on their offline default so the stack runs on a laptop with no network and no API key,
and so every test is deterministic.
