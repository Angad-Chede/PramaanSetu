# Runbooks

Short procedures for the things that go wrong. Each one is rehearsed on staging before a
demonstration or a release.

---

## Verify the audit chain

**When:** nightly by the scheduler; on demand after any incident; before any audit or
vigilance review.

```bash
curl -X POST http://localhost:8000/api/v1/admin/audit/verify \
     -H "X-CSRF-Token: $CSRF" --cookie-jar jar --cookie jar
```

Or in the interface: **Administration, Audit, Verify the chain.**

An intact chain reports the number of entries checked and the head hash. A broken chain
reports the **first broken sequence number** and whether the row was altered or the chain
was reordered.

**If it reports a break:**

1. Do not restart anything. Take a database snapshot immediately.
2. Compare the head hash against the daily copy in write-once storage. The last matching
   day bounds when the tampering happened.
3. Export the audit log around the broken sequence:
   `GET /api/v1/admin/audit?before_seq=<n>&limit=200`
4. Check the database grants. The application role must have INSERT and SELECT on
   `audit_log` and nothing else:
   ```sql
   SELECT privilege_type FROM information_schema.role_table_grants
   WHERE table_name = 'audit_log' AND grantee = 'pramaansetu_app';
   ```
   Anything other than SELECT and INSERT is the finding.
5. Treat it as a security incident and follow the department's incident process.

---

## Restore from backup

**Target:** at most 5 minutes of data loss, at most 30 minutes to restore.

```bash
# 1. Stop writers. The API and workers, not the database.
docker compose stop api worker-critical worker-compute scheduler

# 2. Restore to a fresh instance, to a point in time.
pg_restore --clean --if-exists --dbname="$RESTORE_URL" /backups/pramaansetu-nightly.dump
# For point-in-time recovery, replay the write-ahead log to the chosen timestamp.

# 3. Verify before you let anything write to it.
psql "$RESTORE_URL" -c "SELECT count(*) FROM challenge;"
psql "$RESTORE_URL" -c "SELECT count(*) FROM audit_log;"
psql "$RESTORE_URL" -c "SELECT max(seq) FROM audit_log;"

# 4. Verify the chain on the restored data. This is the real check: row counts only tell
#    you the restore ran, the chain tells you the restore is coherent.
DATABASE_URL="$RESTORE_ASYNC_URL" python - <<'PY'
import asyncio
from app.core.db import session_scope
from app.services import audit

async def main():
    async with session_scope() as session:
        result = await audit.verify(session)
        print(result.detail)
        raise SystemExit(0 if result.verified else 1)

asyncio.run(main())
PY

# 5. Re-apply the grants, which do not travel with a dump.
psql "$RESTORE_URL" -f infra/postgres/roles.sql

# 6. Point the services at the restored database and start them.
docker compose up -d api worker-critical worker-compute scheduler
python scripts/smoke_test.py
```

Time the whole drill. If it exceeds 30 minutes, the bottleneck is usually the restore
itself: consider more frequent base backups.

---

## Replay dead-letter jobs

**When:** the *dead-letter jobs* alert fires, or the admin console shows any.

1. Open **Administration, Background jobs.** Each dead letter shows its type, its queue,
   its attempts and its error.
2. Read the error before replaying. A job reaches dead-letter only after exhausting its
   retries, so the cause is usually persistent: a missing record, a misconfigured adapter,
   a failing external service.
3. Fix the cause.
4. **Replay.** Every handler is idempotent: it checks the job row and the target entity
   before acting, so a replay cannot apply anything twice.

From the command line:

```bash
curl -X POST http://localhost:8000/api/v1/admin/jobs/<job_id>/retry \
     -H "X-CSRF-Token: $CSRF" --cookie jar
```

**If a whole queue is stuck** (the *critical queue stuck* alert), check the worker is
running and has database connectivity before replaying anything. A stuck critical queue
means notifications and escalations are not flowing.

---

## Force scheduler failover

**When:** the *scheduler leader missing* alert fires, or a leader is wedged.

Leadership is a lease row. The standby takes over when it lapses, within 45 seconds.

```bash
# Who holds it, and when did it last run?
curl -s http://localhost:8000/api/v1/status | python -m json.tool | grep -A 6 scheduler
```

To force a handover, expire the lease:

```sql
UPDATE leader_lock SET expires_at = now() WHERE name = 'scheduler';
```

The standby claims it on its next tick. Confirm with the same status call, then confirm
service levels are being scanned:

```bash
curl -s http://localhost:8000/api/v1/status | python -c \
  "import json,sys; print(json.load(sys.stdin)['scheduler'])"
```

**Never run two schedulers without the lease.** The exactly-once escalation guarantee rests
on all three mechanisms together.

---

## Rotate secrets

**Before every demonstration, and on the normal rotation schedule.**

| Secret | Effect of rotating |
| --- | --- |
| `SECRET_KEY` | Every session ends and every one-time code is invalidated, because both are keyed to it. Users sign in again. Rotate during a quiet window. |
| Database password | Update the connection string and restart the API and workers together. |
| Adapter keys | No user-visible effect; the circuit breaker closes again on the next successful call. |

```bash
# 1. Generate.
python -c "import secrets; print(secrets.token_urlsafe(48))"

# 2. Store it in the secrets manager. Never in code, never in a log, never in the image.

# 3. Roll the services.
docker compose up -d --force-recreate api worker-critical worker-compute scheduler

# 4. Confirm.
python scripts/smoke_test.py
```

---

## Switch an adapter to mock, or to live

**When:** an external service is down and you need the workflow to keep moving, or you are
turning on a live integration.

Every adapter is selected by an environment variable. No code change, no release.

```bash
ADAPTER_DPIIT_MODE=mock      # or live
ADAPTER_GEM_MODE=mock
ADAPTER_ESIGN_MODE=mock
ADAPTER_SMS_MODE=mock
ADAPTER_EMAIL_MODE=mock      # or smtp
LLM_PROVIDER=mock            # or openai_compatible
EMBEDDING_PROVIDER=local_hashing   # or openai_compatible
```

Restart the API and the workers, then confirm in **Administration**, which shows each
adapter's mode and the state of its circuit breaker.

**Switching to mock mid-flight is safe.** Work already queued against a live adapter is
retried from the outbox; nothing is lost.

---

## Investigate a service level breach

**When:** a startup asks why their payment is late, or a department asks why they were
escalated.

1. Open the pilot's **Milestones** page. Each milestone shows its state, who holds it, the
   service level deadline and the full state history with the timings.
2. The history distinguishes the two cases that matter: time the *department* held it, and
   time the *startup* took to resubmit after a rejection. The clock stops only for the
   latter.
3. **Administration, Audit**, filtered to that milestone, shows every transition with its
   actor and its reason, including the escalation itself.
4. The department report at `/departments/{id}/payment-report` gives the average days in
   each state and the adherence percentage over the last 90 days.

---

## Re-run an evidence analysis

**When:** a validator asks for the analysis to be reproduced, or data changed after a
report was produced.

The dataset hash on the report locks the exact data analysed.

```bash
# Has the data changed since the report?
curl -s http://localhost:8000/api/v1/evidence/<report_id> --cookie jar \
  | python -c "import json,sys; print(json.load(sys.stdin)['dataset_check'])"
```

- **Unchanged:** re-running produces identical numbers. The seed and engine version on the
  report make it reproducible; a test asserts this.
- **Changed:** the report is no longer valid. Run the Evidence Engine again. If the report
  was already signed off, the platform refuses to overwrite it: record an amendment and
  issue a new report version, so the validated result is never silently replaced.

---

## Move the demonstration clock

**Local, staging and demonstration environments only.** Recorded in the audit log.

**Administration, Demonstration controls.** Fast-forwarding moves every service level timer
forward, so a breach can be shown without waiting days. Run one scheduler cycle afterwards
to see the escalation.

Running the cycle twice does not escalate twice. That is the point.

To reset, restart the API: the offset is in process memory, not in the database.

---

## Read the alerts

| Alert | Condition | Severity | First action |
| --- | --- | --- | --- |
| High error rate | 5xx above 1 percent for 5 minutes | Page | Check the API logs for the failing route |
| Latency | p95 above 800 ms for 10 minutes | Page | Check database connection pool usage and slow queries |
| Critical queue stuck | Oldest critical job older than 2 minutes | Page | Check the critical worker is running |
| Scheduler leader missing | No service level scan in 15 minutes | Page | Force failover, above |
| Dead-letter jobs | Any new dead letter | Ticket | Replay dead-letter jobs, above |
| Audit chain broken | Verification failure | Page | Verify the audit chain, above. Treat as an incident. |
| Replica lag | Above 30 seconds for 5 minutes | Ticket | Reads route to the primary automatically; investigate the replica |
| Backups | Nightly backup missing | Ticket | Check the backup job before the next business day |

`GET /api/v1/status` returns the current alert list, the queue depths, the outbox backlog,
the scheduler lease and every adapter's circuit breaker state. It is the single call to
make when something feels wrong.
