# Traceability

Every element named in problem statement SIH26136, mapped to the code that implements it
and the test that proves it. This exists so a reviewer can check coverage line by line
rather than taking a claim on trust.

---

## Problem statement elements

| Element | Implementation | Proof |
| --- | --- | --- |
| Formulate outcome-based problem statements | `services/llm.py` (drafter, schema, no-invented-numbers check), `services/challenges.py` (blocking problems, quality checklist), `services/templates.py` (problem statement template) | `tests/test_lifecycle_api.py` asserts a drafted challenge has 2 or more measures, rubric weights summing to 100, and **no baseline value the officer did not supply** |
| Challenge identification | Quality checklist flags vague outcomes, a missing budget ceiling and a duplicate from the same department in 12 months: `services/challenges.py::quality_checklist` | `tests/test_lifecycle_api.py::test_validation_errors_name_the_field_and_the_fix` |
| Discover suitable startups | `domain/matching.py` (transparent weighted sum), `services/startups.py::compute_matches`, `services/embeddings.py` | `tests/test_domain_rules.py::test_ranking_prefers_sector_and_capability_matches`; lifecycle test asserts every match carries reasons |
| Limited visibility of departmental demand | `api/v1/public.py::demand_summary`, `/demand` page | `tests/test_lifecycle_api.py` asserts the sector appears in the demand summary after publication |
| Eligibility screening | `domain/eligibility.py` (8 rules, each with a reason and a fix), `services/applications.py::screen_challenge` | `tests/test_domain_rules.py`, 8 eligibility tests |
| **Prior-turnover and experience barriers** | `domain/eligibility.py::_turnover_rule`, `_experience_rule`: relaxed automatically for a recognised startup, with the rule cited; quality and technical criteria never relaxed | `test_recognised_startup_gets_turnover_and_experience_relaxation`, `test_quality_criteria_are_never_relaxed`, and the lifecycle test asserts the relaxation reaches the officer's screening view |
| Expert evaluation of novel technologies | `services/evaluation.py` (panel, conflict declarations, blind round one, score lock, reopen), `domain/scoring.py` (weighting, variance flags) | `tests/test_evaluation_panel.py` (21 tests over panel composition, conflicts, scoring, locking, ranking, shortlist), `tests/test_domain_rules.py` scoring tests; lifecycle test asserts evaluators see `Applicant A` and no startup name |
| Sandbox or controlled pilot design | `domain/simulator.py`, `services/simulation.py`, `services/pilots.py::freeze_design` | `tests/test_simulator_statistics.py`, 22 tests including the analytical agreement gate |
| Milestone-based contracting | `services/pilots.py::draft_agreement`, `default_milestones` (at least one pays before completion), `models/payment.py` | Lifecycle test drafts, approves and accepts an agreement and walks all four milestone states |
| Manage intellectual property and data | `services/templates.py` (three IP options with plain-language text, data-sharing schedule), `services/pilots.py` (India-only storage enforced) | Lifecycle test asserts a non-India storage location is **refused** with the field named |
| Cybersecurity | `services/templates.py` (12-control checklist), `services/pilots.py::complete_cyber_checklist` | Lifecycle test asserts activation is **blocked** until every required control is confirmed |
| Risk management | Risk register template with starter rows, owners, mitigations and triggers; Vendor Dependency Score | `tests/test_domain_rules.py::test_vendor_dependency_above_sixty_requires_an_exit_plan` |
| Measure pilot results | `services/pilots.py::ingest_rows` (form, CSV, API; validation with line numbers), `dashboard` | `tests/test_concurrency.py::test_invalid_csv_rows_are_reported_with_line_numbers`; lifecycle test uploads a CSV with one bad row |
| Timely payment | `services/payments.py` (per-state service levels, reminders at 75 percent, escalation at breach), `api/v1/milestones.py` | `tests/test_concurrency.py`: exactly-once escalation with two schedulers, reminder sent once |
| Long sales cycles | Task inbox (`services/inbox.py`), stage service levels, department payment report | `tests/test_inbox.py` (21 tests: each role sees only its own work, another department never appears, an overdue item sorts first, a task disappears when done), `tests/test_lifecycle_api.py::test_the_task_inbox_is_scoped_to_the_signed_in_user` |
| Independent validation | `services/evidence.py::validator_workspace`, `sign_off` (5-step checklist, three outcomes) | `tests/test_evidence_engine.py`; lifecycle test asserts sign-off is refused with an incomplete checklist |
| Evidence-based procurement decisions | `domain/ecs.py`, `services/evidence.py::run_analysis`, `services/scale.py::record_decision` | `tests/test_domain_rules.py` (13 score tests), `tests/test_evidence_engine.py`; lifecycle test asserts a Scale decision **before sign-off is refused** |
| Transition to compliant procurement | `domain/pathway.py::recommend_pathway` with General Financial Rules references and rule inputs shown | `tests/test_domain_rules.py`, 3 pathway tests |
| Scale-up decisions | `domain/pathway.py::project_scale` using the whole confidence interval, not the point estimate | `test_scale_projection_uses_the_whole_interval` |
| Scaling across departments or districts | `services/scale.py::issue_passport`, `raise_adoption_request`, `_prefill_challenge`; `domain/pathway.py::context_fit` | Lifecycle test raises an adoption request and asserts the pre-filled challenge has **no baseline values** |
| Standard templates | `services/templates.py`: 8 versioned templates; challenges and agreements record the versions they used | `tests/test_lifecycle_api.py::test_templates_are_installed_and_versioned` |
| Integrate with startup databases and e-marketplaces | `services/adapters/`: recognition, marketplace, e-Sign, SMS, email, each with a mock and a live implementation behind one interface | `tests/test_domain_rules.py` eligibility tests exercise the recognition outcomes; `GET /status` shows each adapter's mode |
| Transparent, competitive and legally compliant pathway | Clarification Q and A published to all at once, blind round one, hash-chained audit, public transparency page | `tests/test_audit_chain.py`, `tests/test_authorisation.py` |
| Reduced departmental risk | Simulator before commitment, pre-registration, Evidence Confidence Score, Vendor Dependency Score | All of the above |

---

## Functional requirements

Requirement identifiers are those from the design document. Every P0 requirement is
implemented; the P1 items marked *flagged* are behind feature flags.

### Challenge Builder (FR-CB)

| | Requirement | Where |
| --- | --- | --- |
| 01 | Six-step guided form with help and examples | `frontend/src/app/challenges/[id]/edit/page.tsx` |
| 02 | Draft with AI: title, outcome, 2 to 5 measures, eligibility notes, rubric, fully editable | `services/llm.py`, `services/challenges.py::apply_draft` |
| 03 | Every measure needs unit, method, baseline or plan, and target; submission blocked otherwise | `models/challenge.py::Kpi.completeness_problems`, `services/challenges.py::blocking_problems` |
| 04 | Versioned Template Kit; the challenge records the versions used | `services/templates.py` |
| 05 | Autosave every 10 seconds and on blur; drafts survive a crash | `frontend/src/components/forms.tsx::AutosaveForm` |
| 06 | Quality checklist: vague outcomes, missing ceiling, duplicates | `services/challenges.py::quality_checklist` |
| 07 | Submit sends a one-page summary; approve, return or reject | `services/pdf.py::render_challenge_summary`, `/challenges/[id]/review` |
| 08 | Published challenges immutable except by logged corrigendum, which notifies applicants | `services/challenges.py::issue_corrigendum` |

### Startup registry (FR-SR)

| | Requirement | Where |
| --- | --- | --- |
| 01 | Registration captures legal name, identifiers, sectors, product, team, contact | `services/startups.py::register` |
| 02 | Recognition verification through the adapter; result stored with a timestamp | `services/adapters/dpiit.py`, `services/startups.py::verify_dpiit` |
| 03 | Capability statement and up to 5 case references, reused across applications | `models/startup.py`, enforced in `update_profile` |
| 04 | Completeness indicator naming exactly what blocks applying | `models/startup.py::missing_fields`, `/startup` page |
| 05 | Passports viewable and shareable by read-only link | `api/v1/scale.py::shared_passport` |

### Discovery and matching (FR-DM)

| | Requirement | Where |
| --- | --- | --- |
| 01 | Filterable public board with full-text search | `api/v1/public.py::board`, `/challenges-board` |
| 02 | Aggregated demand by sector and department | `api/v1/public.py::demand_summary` |
| 03 | Ranked matches with the top reasons in plain words | `domain/matching.py` |
| 04 | Matched startups invited; matching never restricts who may apply | `workers/tasks.py::_invite_matches`, stated on the page |
| 05 | Clarifications until a cutoff; answers published to all at once, anonymised | `services/challenges.py::answer_clarification` |
| 06 | Application form generated from the challenge | `services/applications.py::application_form_schema` |
| 07 | Editable until the deadline; last version locked to the second, server time | `services/applications.py::submit`, `lock_for_challenge` |

### Eligibility (FR-ES) and evaluation (FR-EV)

| | Requirement | Where |
| --- | --- | --- |
| ES-01 to 03 | Rules engine; outcome per application with a reason per rule | `domain/eligibility.py` |
| ES-02 | Relaxation applied automatically, rule recorded; quality criteria unchanged | `domain/eligibility.py` |
| ES-04 | Override needs a written justification; audit-logged, visible to the approver | `services/applications.py::override_eligibility` |
| ES-05 | Ineligible applicants notified with reasons and a 3-day clarification window | `services/applications.py`, `workers/notify_rules.py` |
| EV-01 | Panel of at least 3; conflict declaration mandatory before scoring | `services/evaluation.py::assign_panel`, `submit_scores`; `tests/test_evaluation_panel.py::test_a_panel_below_the_minimum_size_is_refused`, `::test_scoring_without_a_conflict_declaration_is_refused` |
| EV-02 | Round one blind | `services/evaluation.py::blind_view`; `tests/test_evaluation_panel.py::test_the_blind_view_carries_the_proposal_and_not_the_applicant` |
| EV-03 | 1 to 5 anchored scale, mandatory justification per criterion | `services/evaluation.py::submit_scores`; `tests/test_evaluation_panel.py::test_a_score_outside_the_anchored_scale_is_refused`, `::test_a_score_without_a_justification_is_refused` |
| EV-04 | Weighted score, mean, spread; flag above 1.5 points | `domain/scoring.py`; `tests/test_evaluation_panel.py::test_the_ranking_orders_by_weighted_score_and_flags_a_split_panel` |
| EV-05 | Lock on completion or deadline; approver can reopen with a logged reason | `services/evaluation.py::lock_scores`, `reopen_scores`; `tests/test_evaluation_panel.py::test_a_locked_score_cannot_be_edited_until_the_approver_reopens_it` |
| EV-07 | Shortlist by rank, confirmed by the approver; applicants see their own scores | `services/evaluation.py::confirm_shortlist`, `/my-applications/[id]`; `tests/test_evaluation_panel.py::test_confirming_the_shortlist_ranks_the_chosen_and_closes_the_rest` |

### Simulator (FR-PS), agreement (FR-PA), execution (FR-PE)

| | Requirement | Where |
| --- | --- | --- |
| PS-01 | All inputs, including baseline confidence and cost per unit-week | `domain/simulator.py::SimulationInputs` |
| PS-02 | 10,000 iterations; power, expected cost, 5th to 95th percentile, minimum detectable effect | `domain/simulator.py::run_simulation` |
| PS-03 | Recommends the smallest design reaching 80 percent power within budget, or says plainly none does | `run_simulation`, with an operational minimum duration |
| PS-04 | What-if comparison of up to 3 designs | `run_simulation(what_if=...)` |
| PS-05 | Accepted design frozen as the pre-registered plan; changes need an approved amendment | `services/pilots.py::freeze_design`, `record_amendment` |
| PS-06 | Asynchronous; results in seconds | `services/simulation.py::queue_run`, compute queue |
| PA-01 to 07 | Agreement from templates, 3 IP options, data terms, cyber checklist, 2 to 6 milestones, diffable versions, PDF with SHA-256 in the audit log | `services/pilots.py::draft_agreement`, `services/pdf.py` |
| PE-01 | Form, CSV with template, and pilot-scoped API key | `api/v1/pilots.py`, `services/pilots.py::ingest_rows` |
| PE-02 | Unit, range, period and duplicate checks; rejects reported with line and reason | `services/pilots.py::ingest_rows`, `parse_csv` |
| PE-03 | Dispute with a reason; excluded from interim views | `services/pilots.py::dispute_metric` |
| PE-04 | Dashboard against the pre-registered plan | `services/pilots.py::dashboard` |
| PE-05 | Pause, resume, terminate, each with a reason | `services/pilots.py::transition` |

### Payment Pulse (FR-PP)

| | Requirement | Where |
| --- | --- | --- |
| 01 | Per-state service levels, configurable per department within policy limits | `services/payments.py::sla_days_for`, `SLA_MAX_DAYS` |
| 02 | Scan every cycle; reminder at 75 percent; escalation at breach, exactly once | `services/payments.py::scan_slas` |
| 03 | Rejection cites the unmet requirement; the clock stops only while the startup resubmits | `services/payments.py::transition` |
| 04 | Finance queue sorted by deadline; release reference, amount and date recorded | `api/v1/milestones.py::finance_queue` |
| 05 | Startups see the state, the holder and the days remaining | `services/payments.py::view` |
| 06 | Department report: average days per state, adherence, breaches over 90 days | `services/payments.py::department_report` |

### Evidence (FR-EE), scale (FR-SC), passport (FR-IP)

| | Requirement | Where |
| --- | --- | --- |
| EE-01 | Pre-registered analysis; effect, 95 percent interval, p-value, secondary measures | `services/evidence.py::run_analysis` |
| EE-02 | Score from the documented formula, every component shown | `domain/ecs.py` |
| EE-03 | Report: plan versus actual, completeness, results, deviations, limitations | `services/pdf.py::render_evidence_report` |
| EE-04 | Validator workspace: raw submissions, baseline, checklist | `services/evidence.py::validator_workspace` |
| EE-05 | Sign off, sign off with qualifications, or refuse, each with remarks | `services/evidence.py::sign_off` |
| EE-06 | A re-run on the same locked dataset gives an identical result | `tests/test_evidence_engine.py::test_a_rerun_on_the_same_data_reproduces_the_result` |
| SC-01 | Pathway recommender with rule inputs shown and the authority's role stated | `domain/pathway.py::recommend_pathway` |
| SC-02 | Scale simulator: low, expected and high from the interval | `domain/pathway.py::project_scale` |
| SC-03 | Vendor Dependency Score; above 60 requires an exit plan | `domain/pathway.py::vendor_dependency_score`, enforced in `services/scale.py` |
| SC-04 | Scale, Extend or Close with reasons; Scale needs a signed-off report | `services/scale.py::record_decision` |
| SC-05 | Handoff pack as PDF and JSON | `services/pdf.py::render_handoff_pack`, `services/scale.py::handoff_json` |
| IP-01 | Passport issued automatically on sign-off | `workers/tasks.py::_issue_passport` |
| IP-02 | Searchable by category, sector and outcome | `services/scale.py::search_passports` |
| IP-03 | Adoption request pre-fills a challenge with the evidence attached | `services/scale.py::_prefill_challenge` |
| IP-04 | Context fit check highlighting the differences | `domain/pathway.py::context_fit` |

### Notifications (FR-NT) and administration (FR-AD)

| | Requirement | Where |
| --- | --- | --- |
| NT-01 | In-app and email for every event needing action, with a direct link | `workers/notify_rules.py` |
| NT-02 | Generated from committed events only, through the outbox | `services/outbox.py`, `workers/tasks.py::_relay_outbox` |
| NT-03 | Daily digest; action-required items never folded in | `workers/tasks.py::_digest` |
| NT-04 | Plain text, no emojis; what happened, what is needed, by whom, by when | `services/notifications.py::compose`, `scripts/check_no_emoji.py` |
| AD-01 | Departments, users, roles, panels, template versions | `api/v1/admin.py` |
| AD-02 | Hash-chained audit with a verify function | `services/audit.py::verify` |
| AD-03 | Department dashboard: stages, pilots, breaches, scores | `api/v1/admin.py::dashboard` |
| AD-04 | CSV export of lists, PDF export of records | `api/v1/admin.py::export_audit`, the PDF endpoints |
| AD-05 | Public transparency page with no personal data | `api/v1/public.py::transparency` |

---

## Non-functional requirements

| | Target | How it is met | Verified by |
| --- | --- | --- | --- |
| NFR-01 | 5,000 concurrent sessions | Stateless API and web tiers; sessions in short-lived tokens, not server memory | `loadtest/baseline.js` |
| NFR-02 | 500 requests per second sustained | Async FastAPI; PgBouncer transaction pooling; 60-second cache on public reads | `loadtest/baseline.js` |
| NFR-03 | Read p95 under 300 ms, p99 under 800 ms | Composite indexes on every list query; cached public board and demand | k6 thresholds fail the run |
| NFR-04 | Write p95 under 500 ms | Short transactions, no network calls under lock, statement timeout of 5 seconds | k6 thresholds |
| NFR-05 | 2,000 submissions in the last 10 minutes, none lost or duplicated | Idempotency key plus a unique constraint; deadline compared against database time inside the transaction | `loadtest/deadline-spike.js`, `tests/test_concurrency.py` |
| NFR-06 | 95 percent of jobs start within 5 seconds | Per-queue workers with a claim loop | `GET /status` reports the oldest job age per queue |
| NFR-07 | Under 0.1 percent 5xx | RFC 9457 problem responses for every expected failure, so failures are 4xx not 5xx. A mistyped address and a rejected method answer in the same shape (`core/errors.py::http_error_handler`) | k6 threshold, `tests/test_error_shape.py` |
| NFR-08 | 99.5 percent monthly, no single point of failure in the API or worker tiers | Stateless tiers, scheduler leader plus standby | Compose file runs 2 schedulers |
| NFR-09 | At most 5 minutes data loss | Continuous write-ahead log archiving | `docs/runbooks.md` restore drill |
| NFR-10 | At most 30 minutes to recover | Restore drill, timed | `docs/runbooks.md` |
| NFR-11 | Every escalation fires exactly once within 10 minutes | Leader lease, batch claim with skip locked, escalation level check in transaction | `tests/test_concurrency.py::test_scheduler_running_twice_escalates_exactly_once` |

---

## Usability requirements

| | Target | How |
| --- | --- | --- |
| UX-01 | 90 percent first-attempt task success | One screen, one job; every error names the field, the problem and the fix, proved for unmatched routes and rejected methods too in `tests/test_error_shape.py` |
| UX-02 | 2 clicks or fewer from home to any pending action | The home page **is** the task inbox, with the action button inline |
| UX-03 | Under 30 minutes to publish a challenge | Drafting plus a six-step form with defaults and autosave |
| UX-04 | Under 20 minutes to apply | Form generated from the challenge, populated from the saved profile |
| UX-05 | Under 10 minutes to score one application | All context on one screen: proposal, commitments, cost, rubric with anchors |
| UX-06 | System Usability Scale of 75 or more | Measured in usability testing; the interface holds to one primary action per screen |
| UX-07 | WCAG 2.1 AA | Keyboard navigation, visible focus ring, labelled inputs, 4.5:1 contrast in both the light and the dark theme, status in words and never colour alone, skip link, `prefers-reduced-motion` honoured |
| UX-08 | Usable on 3G, page under 500 KB | About 95 KB of first-load JavaScript; server-rendered pages |
| UX-09 | Works at 360 pixels | Single-column forms, tables scroll horizontally, verified in the browser |
| UX-10 | English and Hindi | Locale on the user record and honoured on every request; the font stack includes Devanagari |

---

## Deliberate non-goals

These are not gaps. They are decisions, with the reason.

| Not built | Why |
| --- | --- |
| Live integration with Startup India, GeM, DigiLocker or e-Sign | Each is an adapter with a mock and a live implementation behind one interface. Switching is an environment variable. Onboarding to those APIs is an institutional step, not an engineering one. |
| Actual movement of money | Payment Pulse tracks, approves and escalates. Disbursement belongs to the treasury system; putting it here would add risk without adding evidence. |
| Blockchain storage | A hash-chained audit log with database-level append-only grants and an off-site daily head hash gives the same tamper evidence, is simpler to operate and is auditable with `psql`. |
| Native mobile apps | The web app is responsive and works on a 360 pixel screen, which is what a founder in the field and an officer on a phone actually need. |
| Legal advice | Templates are drafted from public guidance and labelled for the department legal cell. The platform states this on every template and on every recommendation. |
| Languages beyond English and Hindi | The interface strings are externalised, so adding a language is a translation task, not a code change. |
