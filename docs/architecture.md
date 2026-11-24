# Architecture

How the pieces fit, and why each correctness mechanism sits where it does.

---

## Shape

A modular monolith: one API service and one worker service sharing one PostgreSQL
database, both stateless and horizontally scalable.

```
Browsers (all roles)
        |
   Load balancer  TLS, rate limits
        |
   Next.js web    server-rendered pages, server actions, 2 or more instances
        |
   FastAPI API    auth, authorisation, validation, state transitions, transactions
        |
   PgBouncer  ->  PostgreSQL 16 primary (+ pgvector)  ->  read replica
        |
      Redis        cache, rate limits, idempotency, locks, broker
        |
  Worker groups    critical | default | ai | compute | docs
        |
   Scheduler       single leader by lease, standby takes over on expiry
        |
  Object storage   agreements, evidence files, generated reports
```

**Why a monolith.** Workflow correctness depends on multi-table transactions: a state
change, its audit entry and its outbox event must commit together or not at all. One
database makes that atomic without distributed transactions. Module boundaries are
enforced in code (each service module owns its tables; cross-module reads go through
service functions), so extraction later is a refactor, not a rewrite.

**Why workers.** Drafting calls, ten-thousand-iteration simulations, bootstrap analyses
and PDF rendering are slow. They run on separate queues with separate concurrency caps, so
an overload in drafting cannot delay a payment escalation.

---

## The correctness mechanisms, and where each one lives

### 1. State machines: the server is the only authority

`backend/app/domain/states.py`

Every transition is a `Transition(action, source_states, target, actor_roles, artefact,
requires_reason)`. `check_transition` refuses anything not in the table and returns the
actions that *are* available from the current state, so the error tells the user what to do
instead of what they did wrong.

The interface never decides what is possible: `available_actions(machine, state, roles)`
asks the same table the server enforces.

### 2. Three concurrency mechanisms, each where it fits

`backend/app/core/db.py`

**Optimistic locking for user edits.** Every mutable row has a `version`, returned as an
ETag. An update sends `If-Match`; a stale version returns 409 with the current record, so
the interface can show both versions rather than silently overwriting.

**Pessimistic row locks for state transitions.** A transition runs `SELECT ... FOR UPDATE`
on the aggregate row inside a short transaction, checks the state, then writes. Two
approvers clicking at the same moment are serialised; the second sees the new state.

**Database constraints as the last line of defence.** One application per startup per
challenge. One score per evaluator per criterion. One release per milestone. One value per
unit per period per phase. These hold regardless of application bugs.

On SQLite, `BEGIN IMMEDIATE` takes the write lock at transaction start, which serialises
writers just as strictly for the MVP's purposes. On PostgreSQL the row locks are real. The
same code path runs on both.

Transactions are kept short and make no network calls while holding a lock.
`statement_timeout` is 5 seconds and `lock_timeout` 2 seconds, so a stuck lock fails fast
rather than piling up requests.

### 3. Transactional outbox: an event exists if and only if the change committed

`backend/app/services/outbox.py`

Request code never triggers a side effect. It writes an `outbox_event` row in the same
transaction as the business change. A relay on the critical queue claims unpublished rows
with `FOR UPDATE SKIP LOCKED`, enqueues jobs and marks them published. A relay crash delays
events; it cannot lose them, and it cannot emit an event for a change that rolled back.

Consumers are idempotent on the event id: the notification table has a unique constraint on
`(user_id, event_id)`, so a redelivered event cannot notify twice.

### 4. Exactly-once escalation

`backend/app/services/payments.py`, `backend/app/workers/scheduler.py`

Three mechanisms stack:

1. Leadership is a lease row in the database. Exactly one scheduler is active; a standby
   takes over when the lease lapses.
2. The scan claims milestones in a batch that skips locked rows, so two instances never
   take the same one.
3. The escalation itself checks `escalation_level == 0` inside the same transaction that
   raises it. An instance arriving after another has committed sees the raised level and
   does nothing.

Any one of these would usually be enough. All three are present because the property
matters and the cost of the belt and braces is a few lines.

### 5. Idempotency

`backend/app/core/idempotency.py`

Every action endpoint accepts an `Idempotency-Key`. A repeat within 24 hours returns the
original response. The same key with a *different* body returns 422 rather than silently
doing something else, because that is a client bug and hiding it makes it worse.

### 6. The hash-chained audit log

`backend/app/domain/hashchain.py`, `backend/app/services/audit.py`

Each entry stores `h_n = SHA256(h_{n-1} || canonical_json(entry_n))`. Canonical means
sorted keys and no insignificant whitespace, so the same entry always hashes the same way.

- Inserts are serialised by a PostgreSQL advisory lock taken inside the business
  transaction, so the chain has no forks under concurrent writes.
- The application database role has INSERT and SELECT on `audit_log` and nothing else
  (`infra/postgres/roles.sql`). No UPDATE. No DELETE.
- A nightly job and an admin action recompute the chain and report the first broken link.
- The head hash is written daily to separate write-once storage, so an attacker with
  database access cannot silently rewrite the whole chain.

### 7. Job reliability

`backend/app/services/jobs.py`, `backend/app/workers/runner.py`

Acknowledge late, so a crashed worker's task is redelivered. Every handler is idempotent:
it checks the job row and the target entity before acting. Retries use exponential backoff
with jitter for transient errors only; a validation failure fails immediately rather than
being retried five times. After the last attempt the job moves to a dead-letter state,
visible in the admin console with its error, replayable with one click. Each queue has a
hard time limit.

Deterministic compute: simulations and evidence analyses take an explicit seed, stored with
the run, so a redelivered task produces the same numbers.

---

## The statistical machinery

### Pilot Flight Simulator

`backend/app/domain/simulator.py`

The measurement model is explicit:

```
y[i,t] = mu + u[i] + w[i,t]
```

`u[i]` is stable unit-to-unit variation; `w[i,t]` is period-to-period noise. In a paired
design `u[i]` cancels, so the standard deviation of the per-unit difference is
`sqrt(2) * sigma_within / sqrt(m)` with `m` measurements per phase. That is why both a
longer pilot and more units raise power, and why the recommender searches over both.

Claimed effects are usually optimistic, so the true effect per iteration is drawn around
`realism_factor` times the claim (default 0.7) with uncertainty. Setting the factor to 1.0
and the uncertainty to 0 reduces the model to the textbook case, which is exactly how the
Monte Carlo power is validated against the closed-form power in the tests.

Cost is `units x weeks x rate` with a log-normal overrun factor (median 1.0, 90th
percentile 1.25), reported as an expectation with a 5th-to-95th-percentile range.

The recommender screens a grid analytically (microseconds per cell) then confirms the
surviving candidates with a full Monte Carlo run, so the reported power is always the
simulated one. It never proposes a pilot shorter than the operational minimum, because a
design can be statistically adequate and still too short to say anything useful about the
solution in service.

### Evidence Engine

`backend/app/domain/statistics.py`, `backend/app/services/evidence.py`

The method is fixed at design freeze and honoured exactly. The only permitted departure is
a pre-registered comparison design with no comparison data, and that is recorded as an
unapproved deviation on the report, costing protocol adherence points, rather than quietly
substituted.

| Design | Test | Interval |
| --- | --- | --- |
| Pre-post, same units | Paired t, or Wilcoxon when the normality check fails | Percentile bootstrap on the mean difference |
| Pilot against comparison units | Welch on change scores | Bootstrap on the difference in differences |
| Rate measure | Two-proportion | Bootstrap, with Wilson intervals reported per rate |

10,000 bootstrap resamples, seed stored on the report, library versions pinned. Re-running
on the same locked dataset reproduces the result exactly; a test asserts it.

### Evidence Confidence Score

`backend/app/domain/ecs.py`

```
ECS = E + C + D + P + V
```

| | Points | Rule |
| --- | --- | --- |
| E | 0 to 30 | 30 x (observed effect / pre-registered target), clipped to [0, 1] |
| C | 0 to 25 | 25 if the 95 percent interval excludes zero beneficially; 12 if only the 90 percent does; else 0 |
| D | 0 to 20 | 20 x completeness x (1 - share of rejected or disputed rows) |
| P | 0 to 15 | 15, less 2 per approved amendment and 5 per unapproved deviation, floor 0 |
| V | 0 to 10 | 10 clean sign-off, 5 with qualifications; a refusal issues **no score at all** |

Bands: 80 and above strong, 60 to 79 moderate, below 60 weak. Every component is displayed
with its own explanation, because a number a decision-maker cannot take apart is a number
they cannot argue with.

---

## Authorisation

`backend/app/core/policy.py`

One decision point: `can(principal, action, resource)`, deny by default. Every endpoint
calls `require(...)`. Access is never granted by hiding a button.

Roles are scoped: a role is held over a department, a challenge or a startup, not globally.
A Platform Admin reads across the platform and manages configuration but holds no business
approval.

The separation-of-duties rules are in the policy, not in convention:

- The officer who drafted a challenge cannot approve it.
- An evaluator on a challenge cannot validate the same challenge.
- A finance officer cannot approve a payment they will release.
- An independent validator cannot belong to the department running the pilot.

`tests/test_authorisation.py` asserts the full role-by-action grid, and fails if a new
action is added to the policy without a matrix entry.

---

## Privacy

- No Aadhaar numbers, anywhere.
- Pilot data about citizens is anonymised or aggregated by the department before it reaches
  the platform. The upload template has no fields for direct identifiers, and the ingest
  validator **refuses a file** carrying a column that looks like a phone number, an email
  address or an identification number.
- Text is redacted before it leaves the platform for a drafting model: names, phone
  numbers, email addresses and identifier-like strings.
- Access to personal data is logged. Logs carry no secrets, no one-time codes and no
  document contents; the user id is hashed.
- Hosting in India, and the agreement generator refuses a data-sharing schedule with a
  storage location outside it.

---

## Degradation

| Dependency fails | What happens |
| --- | --- |
| Drafting model slow or down | 30 second timeout, retries, then a circuit breaker for 60 seconds. The interface says drafting is unavailable and the manual form and Template Kit still work. Matching falls back to keyword and sector ranking. |
| Recognition, marketplace, e-Sign or SMS adapter down | Circuit breaker; the action is queued and retried; the user sees Pending with the reason. Workflows needing verification wait; others continue. |
| Redis unavailable | Caching off, rate limiting falls back to a per-instance limiter, job enqueue is retried from the outbox, so no event is lost. |
| One API or worker instance dies | Health checks remove it; in-flight jobs are redelivered because acknowledgement is late. |
| Read replica lags | Reads route to the primary. |
| Session expires mid-task | Next.js middleware rotates the refresh token silently, so a reader is not bounced to sign-in in the middle of an Evidence Report. |

---

## The web application

Pages are React Server Components. They fetch from the API on the server, forwarding the
caller's session cookie, and render HTML. Writes are Server Actions that call the API and
revalidate. Three small client islands handle the only things that genuinely need the
browser: a submit button that cannot be double clicked, autosave every 10 seconds and on
blur, and a job poller.

The result is about 95 KB of first-load JavaScript, comfortably inside the 500 KB page
budget, and every flow works on a 360 pixel screen and by keyboard.

The API is reached through a same-origin rewrite, so `SameSite=Strict` session cookies work
exactly as they would behind a single load balancer in a deployment.
