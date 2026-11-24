# API conventions

The full specification is generated from the code and served at `/openapi.json`, with
interactive documentation at `/docs`. This page covers the conventions that apply
everywhere, so the specification does not have to repeat them on every endpoint.

Base path: `/api/v1`

---

## State changes are explicit actions

A state field is never updated directly. Every transition is its own endpoint:

```
POST /challenges/{id}/submit
POST /challenges/{id}/approve
POST /milestones/{id}/approve-payment
POST /evidence/{id}/sign-off
```

The server checks the transition against the state machine before anything is written. A
transition not available from the current state returns 409 with the actions that **are**
available:

```json
{
  "type": "https://pramaansetu.gov.in/problems/transition-not-allowed",
  "title": "This step is not available from the current state",
  "status": 409,
  "detail": "This challenge is in state 'Draft', so the step 'approve' is not available. Available now: submit.",
  "current_state": "Draft",
  "available_actions": ["submit"]
}
```

---

## Concurrency control

Every mutable resource returns a `version` and an `ETag`.

```http
GET /api/v1/challenges/{id}
ETag: "7"
```

An update sends it back:

```http
PUT /api/v1/challenges/{id}
If-Match: "7"
```

A stale version returns 409 **with the current record**, so the interface can show the
user both versions rather than silently overwriting someone else's work:

```json
{
  "status": 409,
  "detail": "Someone else changed this record while you were working on it. Your version was 7 and the current version is 9.",
  "current_version": 9,
  "your_version": 7
}
```

---

## Idempotency

Every action endpoint accepts `Idempotency-Key`. A repeat within 24 hours returns the
original response rather than acting twice:

```http
POST /api/v1/milestones/{id}/approve-payment
Idempotency-Key: 5b1c9f2e-...
```

The same key with a **different body** returns 422. That combination is a client bug, and
quietly doing something different would hide it.

---

## Errors are RFC 9457 problem documents

`Content-Type: application/problem+json`. Every field error carries the field, the problem
and **the fix**:

```json
{
  "type": "https://pramaansetu.gov.in/problems/validation-failed",
  "title": "Some fields need correction",
  "status": 422,
  "detail": "This challenge cannot be submitted until every measure and criterion is complete.",
  "instance": "/api/v1/challenges/01a0.../submit",
  "errors": [
    {
      "field": "kpis.Non-revenue water",
      "detail": "Target must be lower than the baseline for a measure where lower is better.",
      "fix": "Complete this measure before submitting."
    }
  ]
}
```

| Status | Meaning |
| --- | --- |
| 400 | The request is malformed |
| 401 | Not signed in, or the session expired |
| 403 | Signed in, but the roles do not permit this action on this record |
| 404 | No such record, no access to it, or no such address |
| 405 | The address exists but does not accept this method; `fix` names the methods it does |
| 409 | A conflict: a stale version, an unavailable transition, or a duplicate |
| 422 | Validation failed; `errors[]` names each field and its fix |
| 428 | The update needs `If-Match` |
| 429 | Rate limited; `Retry-After` says how long |
| 503 | A dependency is unavailable; the action is queued where it can be |

There is no error shape outside this one. A mistyped address and a rejected method are
problem documents too, with the fix at the top level rather than against a field, so a
client never has to special-case the framework's own defaults:

```json
{
  "type": "https://pramaansetu.gov.in/problems/not-found",
  "title": "Record not found",
  "status": 404,
  "detail": "There is nothing at /api/v1/challegnes.",
  "instance": "/api/v1/challegnes",
  "fix": "Check the address. The API reference is at /docs and the machine-readable document is at /openapi.json."
}
```

---

## Authentication

Short-lived access token (15 minutes) in an `HttpOnly`, `Secure`, `SameSite=Strict`
cookie. Refresh tokens rotate on every use, and reuse is detected: a reused refresh token
revokes the whole session family.

State-changing requests carry a CSRF token in the `X-CSRF-Token` header, matching the
readable `ps_csrf` cookie. A bearer token in `Authorization` is exempt, since it is not
subject to cookie-based CSRF.

```
POST /auth/otp/request     send a one-time code
POST /auth/otp/verify      verify it and start a session
POST /auth/login           password first factor for startup users
POST /auth/refresh         rotate the refresh token
POST /auth/logout          revoke every refresh token
GET  /auth/session         who is signed in, and their scoped roles
```

`/auth/otp/request` returns the same response whether or not the account exists, so it
cannot be used to discover which addresses are registered.

---

## Asynchronous jobs

Slow work returns 202 with a `Location` header:

```http
POST /api/v1/pilots/{id}/simulations
202 Accepted
Location: /api/v1/jobs/01a0...
```

```json
{ "run_id": "01a0...", "job_id": "01a0...", "status": "Queued", "poll": "/api/v1/simulations/01a0..." }
```

Poll `GET /jobs/{id}` every two seconds, or subscribe to `GET /jobs/{id}/events` for
server-sent events. Users keep working while a job runs.

---

## Pagination, filtering and sorting

Cursor-based, never offset, on tables that grow:

```
GET /api/v1/challenges?cursor=eyJjcmVhdGVkX2F0...&limit=50
```

`limit` is capped at 100. Filter and sort parameters are a whitelist per endpoint.

---

## Types

| Concern | Convention |
| --- | --- |
| Time | ISO 8601 in UTC. The interface displays IST. |
| Money | Integer paise plus a currency code and a preformatted display string: `{"paise": 450000000, "currency": "INR", "display": "45,00,000.00"}`. Never a float. |
| Identifiers | UUID v7 as a string: time-ordered, so index locality holds on append-heavy tables. |
| References | Human-quotable short codes on documents: `CH-7KQ3F2`, `PL-99HDKF`, `EV-GTB525`, `IP-5W444S`. Never used as keys. |

---

## Rate limits

Returned as `RateLimit-Limit` and `RateLimit-Remaining` headers; a 429 carries
`Retry-After`.

| Scope | Limit |
| --- | --- |
| One-time codes | 10 per identifier per hour |
| Writes | 100 per user per minute |
| Reads | 1,000 per user per minute |
| JSON body | 1 MB |
| File upload | 25 MB, through a pre-signed URL only |

---

## Files

Uploads never pass through the API servers:

```
POST /files/upload-url        ->  a ticket with an upload URL
PUT  <upload URL>             ->  the bytes go straight to storage
POST /files/{id}/complete     ->  hash verified, virus scan queued
GET  /files/{id}              ->  served with Content-Disposition: attachment
```

A file is not readable until the scan clears it. Executable content is refused whatever
the declared type.

---

## Health and status

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Liveness. Answers if the process is up. |
| `GET /readyz` | Readiness, including dependencies. |
| `GET /status` | Queue depths, outbox backlog, scheduler lease, adapter modes and circuit breakers, feature flags and the active alert list. The one call to make when something feels wrong. |

---

## Endpoint map

| Area | Endpoints |
| --- | --- |
| Inbox | `GET /me/tasks`, `GET /me/notifications`, `POST /me/notifications/read` |
| Challenges | `POST /challenges`, `GET|PUT /challenges/{id}`, `POST /challenges/{id}/ai-draft`, `GET /challenges/{id}/checklist`, action endpoints, `/corrigenda`, `/clarifications`, `/matches`, `/panel`, `/ranking`, `/shortlist`, `/audit`, `/summary.pdf`, `/templates` |
| Startups | `POST /startups`, `GET|PUT /startups/{id}`, `/verify-dpiit`, `/applications`, `/passports` |
| Applications | `GET /challenges/{id}/application-form`, `POST /challenges/{id}/applications`, `GET|PUT /applications/{id}`, `/submit`, `/withdraw` |
| Evaluation | `GET /evaluation/assignments`, `GET /evaluation/{challenge_id}`, `POST .../coi`, `PUT .../scores`, `/reopen`, `/progress` |
| Pilots | `GET /pilots`, `GET /pilots/{id}`, `/dashboard`, `/simulations`, `/design/freeze`, `/design/amend`, `/agreements`, `/cyber-checklist`, `/metrics`, `/metrics/csv`, `/metrics/api`, `/api-key`, lifecycle actions |
| Milestones | `GET /pilots/{id}/milestones`, `POST /milestones/{id}/{submit,accept,reject,approve-payment,record-release}`, `GET /finance/queue`, `GET /departments/{id}/payment-report` |
| Evidence | `POST /pilots/{id}/evidence/run`, `GET /pilots/{id}/evidence`, `GET /evidence/{id}`, `/workspace`, `/sign-off`, `/report.pdf` |
| Scale | `GET /pilots/{id}/pathway`, `POST /pilots/{id}/scale-simulations`, `GET /pilots/{id}/vendor-dependency`, `POST|GET /pilots/{id}/decision`, `/handoff.json`, `/handoff.pdf` |
| Passports | `GET /passports`, `GET /passports/{id}`, `/context-fit`, `POST /passports/{id}/adoption-requests`, `GET /passports/shared/{token}` |
| Public | `GET /public/challenges`, `/public/challenges/{id}`, `/public/demand/summary`, `/public/passports`, `/public/transparency` |
| Admin | departments, users, roles, templates, `GET /admin/audit`, `POST /admin/audit/verify`, `/audit/export.csv`, `/admin/dashboard`, `/admin/jobs`, `/admin/clock`, `/admin/scheduler/run` |
