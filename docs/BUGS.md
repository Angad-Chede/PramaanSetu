# Known bugs and open work

An honest register. Everything here was found by running the thing, not by guessing:
each entry names how it was observed and where it lives.

Severity is about consequence, not effort.

| | Meaning |
| --- | --- |
| **Blocker** | CI is red, or the platform cannot start |
| **High** | Wrong behaviour a user would hit, or a crash |
| **Medium** | Correct but misleading, noisy, or a trap for the next person |
| **Low** | Cosmetic, or debt with no user-visible effect |

---

## Open

### High

**1. Next.js 14.2.21 carries a critical advisory that only a major upgrade closes**

- **Observed:** `npm audit --audit-level=high` reports one critical advisory.
- **What it is:** information exposure in the Next.js **development server** through
  missing origin verification.
- **Why it is still here:** the fix is Next 16, whose App Router API differs from the one
  these 44 pages are written against. That is a rewrite, not an upgrade.
- **Actual exposure:** the advisory is confined to `next dev`. The container and every
  documented way of running this project use `next start`, which is unaffected.
- **Mitigation now:** do not expose `next dev` beyond localhost.
- **Fix:** plan the Next 16 migration as its own piece of work; do not bundle it with
  feature changes.

The transitive `postcss` advisory that Next 14 also carried **is** closed, by the
`overrides` entry in `frontend/package.json` that lifts that copy to the patched 8.5 line.

---

### Medium

**2. `debug` defaults to true, and no `.env` is shipped**

- **Observed:** `backend/app/core/config.py:20` has `debug: bool = True`, and there is no
  `backend/.env`, so the default wins on every fresh clone.
- **Consequence:** the root logger runs at DEBUG in what looks like a normal run. The
  worst of that noise is now silenced (see Fixed #3), but the underlying default is still
  a decision made by accident rather than on purpose.
- **Fix:** default `debug` to `environment == "local"`, or ship `backend/.env` from
  `.env.example` during setup. Keep `.env` out of version control either way.

**3. `ruff format` disagrees with 77 of 104 files**

- **Observed:** `ruff format --check app tests` -> *77 files would be reformatted*.
- **Consequence:** none today, because only `ruff check` is a CI gate. But the first
  person to run `ruff format` will produce a 77-file diff that buries whatever they were
  actually changing.
- **Fix:** run `ruff format app tests` once, commit it alone with no other change, then
  add `ruff format --check` to CI so it never drifts again. Doing this *before* any other
  work is much cheaper than after.

**4. pytest-asyncio's fixture loop scope is unset**

- **Observed:** `PytestDeprecationWarning: The configuration option
  "asyncio_default_fixture_loop_scope" is unset.`
- **Consequence:** a future pytest-asyncio release changes the default, which can alter
  how fixtures share an event loop. That failure mode is confusing and intermittent.
- **Fix:** add `asyncio_default_fixture_loop_scope = "function"` to
  `[tool.pytest.ini_options]` in `backend/pyproject.toml` and confirm the suite still
  passes.

**5. A statistical test fixture generates degenerate data**

- **Observed:** `scipy.stats.shapiro: Input data has range zero` and *Precision loss
  occurred in moment calculation due to catastrophic cancellation*, from
  `test_paired_analysis_is_deterministic_for_a_fixed_seed` and one evidence-engine test.
- **Consequence:** the assertions still hold, but the test is exercising a constant-value
  edge case by accident rather than on purpose. A real regression in the normality check
  could hide behind a warning everyone has learned to ignore.
- **Fix:** give those fixtures a small amount of variance, and add a *separate* explicit
  test for the genuinely degenerate case, asserting the behaviour rather than tolerating
  a warning.

---

### Low

**6. The favicon is SVG only**

- **Observed:** `frontend/src/app/icon.svg` is served and the link tag is emitted.
- **Consequence:** browsers older than Chrome 80 / Safari 16 show nothing. In practice,
  nothing anyone will demo on.
- **Fix:** add `frontend/src/app/icon.png` (32x32) and `apple-icon.png` (180x180) if wide
  device coverage matters. Next picks both up automatically.

**7. `milestone.recheck` is a registered job handler that nothing enqueues**

- **Observed:** `grep -rn "milestone.recheck" app/ tests/` finds only the handler
  definition itself at `app/workers/tasks.py:440`. No service, endpoint, scheduler entry
  or test ever enqueues it.
- **What it does:** reads a milestone and returns its state and escalation level. It
  changes nothing, so even if it were enqueued it would do no work.
- **Consequence:** dead code that reads like a feature. The next person to touch the
  milestone clock will find it, assume it is load-bearing, and either preserve it for no
  reason or spend time working out that it is not.
- **Fix:** delete it, or give it a purpose and a caller. Deleting is the honest default;
  it is recoverable from history if a use appears.

**8. Local environment has a mismatched `requests` dependency chain**

- **Observed:** `RequestsDependencyWarning: urllib3 (2.7.0) or chardet (7.6.0) doesn't
  match a supported version!` on every pytest run.
- **Consequence:** none for this project; `requests` is not used by the application. It is
  a property of the machine, not the repository.
- **Fix:** nothing to do in this repo. Worth knowing so nobody chases it.

---

## Not bugs, but open work

**9. The AI Challenge Builder is a deterministic mock**

`llm_provider` defaults to `"mock"`. `MockLlmProvider` is a rule-based drafter over a
domain library, not a model. A real `OpenAiCompatibleProvider` exists and is wired for
schema validation, retry, redaction and the no-invented-numbers check — it simply is not
switched on.

This is a deliberate trade: the stack runs offline with no API key and every test is
deterministic. **Say so plainly rather than letting anyone assume otherwise.** To switch
it on, set `LLM_PROVIDER=openai_compatible` plus the base URL and key; the calling code
does not change.

**10. Embeddings are a classical hashing projection, not a trained model**

`LocalHashingProvider` builds 1024-dimension vectors from character n-grams. It works
well enough at this registry size, needs no download and is deterministic. Swapping in a
multilingual sentence-transformer is a provider change: the interface, the stored
dimension and the cosine computation all stay put.

Worth doing only if match quality on mixed Hindi and English text is being judged.

**11. No browser-level end-to-end test**

`scripts/smoke_test.py` covers the nine core tasks across all seven roles over HTTP, with
no browser. The PRD also lists a Playwright accessibility and end-to-end suite, which does
not exist. Contrast was audited manually across both themes and every page tested passed
WCAG 2.1 AA, but that audit is not automated and so will drift.

**12. Alembic migrations are not exercised against the SQLite path**

`0001_initial_schema.py` is written for the PostgreSQL topology. The default SQLite run
creates tables directly from the models. The two can diverge without anything failing.

Fix: add a CI step that runs `alembic upgrade head` against a scratch PostgreSQL and
compares the result to `Base.metadata`.

---

## Fixed

Kept as a record of what was actually wrong, because several of these are the kind of
thing that comes back.

### Blocker

**1. `mypy` was a CI gate and it was red — 29 errors in 13 files**

`.github/workflows/ci.yml:74` runs `mypy app --ignore-missing-imports`. It had never
passed. Every error is now fixed; the gate is green. The fixes were not cosmetic — see
the next entry.

### High

**2. `scale.py` crashed when a pilot's challenge was missing**

`services/scale.py:51` read `challenge.sector` **one line before** the
`challenge.sector if challenge else None` guard that proves the author knew it could be
`None`. Any request for a procurement recommendation on an orphaned pilot raised
`AttributeError` and returned a 500. Now it raises a proper 404 explaining that there is
no challenge to derive a category from.

**3. Four endpoints passed a possibly-missing record into code that required one**

`applications.py` (submit), `evaluation.py` (submit scores), `milestones.py` (read) and
`notify_rules.py` each fetched a row that can be `None` and passed it straight on. Each
would have produced an opaque `AttributeError` instead of a clean 404. All now guard and
return a problem document that names what was not found.

**4. The Evidence Engine silently overrode the frozen analysis method**

A challenge whose primary measure was a rate had its pre-registered paired test quietly
replaced with a two-proportion test — defeating the entire point of pre-registration. The
frozen method is now honoured exactly. The single permitted departure, a
difference-in-differences design with no comparison data submitted, is **recorded as an
unapproved deviation** costing 5 protocol points and printed on the report.

**5. Unmatched routes and wrong methods returned the framework's default error**

`GET /api/v1/challegnes` returned `{"detail":"Not Found"}` — not the RFC 9457 problem
document every other error uses and every client renderer expects. Now handled, with a
`fix` field, for 404, 405 and every other HTTP error.

**6. Sessions expired mid-form and bounced people to sign-in**

The access token lasts 15 minutes and server components cannot set cookies, so there was
nowhere to refresh it. `frontend/src/middleware.ts` now refreshes silently.

### Medium

**7. `aiosqlite` narrated every database operation at DEBUG**

Because `debug` defaults to true, the root logger ran at DEBUG and `aiosqlite` logged
every cursor, execute, fetch and close. A normal start produced thousands of lines. The
practical harm was real: a **port-in-use bind failure scrolled past unread**, and the
server looked like it had started when it had not. `aiosqlite`, `sqlalchemy.pool`,
`httpx`, `httpcore` and `multipart` are now held at WARNING alongside the three that
already were.

Note that uvicorn's `--log-level` flag does **not** help here, because it configures only
uvicorn's own loggers and the application reconfigures the root logger afterwards.

**8. Periodic jobs logged a completion every time they did nothing**

`platform.relay_outbox` runs every two seconds. It logged `Job completed` on every pass,
about thirty lines a minute of "nothing happened". Housekeeping jobs that find no work now
log at debug instead.

**9. `run.ps1` could not start the web application on Windows**

`Start-Process -FilePath "npm"` failed with *"%1 is not a valid Win32 application"*,
because on Windows `npm` is a shell script and `Start-Process` needs a real executable.
It now launches through `cmd.exe`, which resolves `npm.cmd` the way an interactive prompt
does.

**10. Leftover servers held ports 8000 and 3000 with no way to find them**

The run scripts start both services detached, so they survive closing the terminal —
which is exactly why the next run failed to bind. There is now a `.run/` directory of
recorded process ids, a `-Stop` / `--stop` that ends precisely those, a `-Status` /
`--status` that names whatever is holding each port and whether the script started it, and
a pre-flight that refuses to start half a stack rather than leaving one service up.

The recorded id is re-read from the actual listener once both are up, because `npm run
start` and `cmd.exe` both spawn node as a child — so the process that was launched is not
the one holding the port.

**11. The application shipped no favicon at all**

`frontend/public/` was empty, there was no `icon.*`, and `/favicon.ico` returned 404, so
browsers showed a generic placeholder. `frontend/src/app/icon.svg` now carries the bridge
mark with fixed colours — a favicon is fetched outside the page and cannot read the
theme's CSS variables.

**12. The simulator recommended operationally meaningless pilots**

It would propose a two-week pilot when that was statistically adequate. Two weeks of a
water-loss intervention says nothing about how it behaves in service. There is now a
four-week floor on any recommendation.

**13. Transparency reported "0 days from submission to payment"**

The seed created every milestone at the current timestamp, so elapsed time was zero and
the headline figure was nonsense. Milestones are now backdated across the pilot using
durations inside the agreed service levels; the figure reads 9.0 days.

### Low

**14. CSV rejection messages were off by one**

Rejected rows reported the wrong line number, sending people to the wrong row. The line
number is now threaded from the parser through to the message.

**15. Completeness was computed over all measures instead of the primary one**

Three places counted every KPI when scoring data completeness, diluting the figure. All
three now scope to the pre-registered primary measure.

**16. Ranking ignored panel disagreement on ties**

Two applications on the same weighted score were ordered arbitrarily. Ties now break on
the lower mean evaluator spread: a score built on agreement outranks the same score built
on a split panel.

**17. GeM procurement thresholds were wrong by a factor of ten**

Corrected to GFR Rule 149 (₹5 lakh, direct purchase) and Rule 162 (₹25 lakh, limited
tender).

**18. Frontend lint was configured but could never run**

`.eslintrc.json` existed while `eslint` was not a dependency, so `npm run lint` failed —
masked in CI by `continue-on-error: true`. ESLint is installed, passes clean, and the
`continue-on-error` is removed so it is a real gate now.

---

## Suggested order of work

1. **#3, `ruff format`** — do it first and alone. Every day it waits makes the eventual
   diff harder to review.
2. **#4 and #2** — two small configuration fixes that remove standing warnings.
3. **#5** — fix the degenerate fixtures while the statistical code is fresh in someone's
   mind.
4. **#9** — switch the LLM to a live provider only if it will be demonstrated. Budget
   twenty minutes, not a day; the code path already exists.
5. **#11 and #12** — real test coverage gaps. Worth doing before the next feature, not
   after.
6. **#1, Next 16** — schedule deliberately. It is a migration, not an upgrade.
