"""Template Kit (FR-CB-04, FR-PA-01 to FR-PA-05).

Eight versioned templates. A challenge and an agreement record the exact version of
every template they used, so a reviewer years later can reconstruct what the parties
actually agreed to.

Every template is drafted from public guidance and is labelled for review by the
department's legal cell. These templates support, and do not replace, that review.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import NotFound
from app.models.platform import Template

LEGAL_REVIEW_NOTE = (
    "Draft for review by the department legal cell. Drafted from publicly available "
    "guidance, including the General Financial Rules, 2017, the Manual for Procurement of "
    "Consultancy and Other Services, and the Digital Personal Data Protection Act, 2023. "
    "This template does not constitute legal advice."
)

TEMPLATE_KIT: list[dict[str, Any]] = [
    {
        "kind": "problem_statement",
        "version": "1.0.0",
        "title": "Outcome-based problem statement",
        "body": {
            "sections": [
                {
                    "key": "problem",
                    "heading": "What is going wrong",
                    "guidance": "Describe the operational problem in the words you would use to "
                    "a colleague. Say who is affected and how often. Do not name a technology.",
                    "example": "In the 14 wards of the eastern zone, treated water is lost "
                    "between the reservoir and household connections. Leaks are found only when "
                    "residents complain, usually days after they start.",
                },
                {
                    "key": "current_situation",
                    "heading": "How it is handled today",
                    "guidance": "State the current process, the data already collected and who "
                    "collects it. This becomes the baseline source.",
                    "example": "Bulk meters are read manually once a month. Complaints are logged "
                    "in the municipal grievance system and assigned to the ward plumber.",
                },
                {
                    "key": "outcome",
                    "heading": "What success looks like",
                    "guidance": "State the outcome as a change in a measure, not as a feature. "
                    "Avoid words with no number behind them, such as improve or optimise.",
                    "example": "Reduce non-revenue water in the eastern zone and cut the average "
                    "time from leak occurrence to repair.",
                },
                {
                    "key": "constraints",
                    "heading": "What the solution must respect",
                    "guidance": "List hard constraints: hosting, data sharing, existing assets, "
                    "field conditions, staffing and anything that cannot change.",
                    "example": "Data hosted in India. No personal data shared. No replacement of "
                    "existing bulk meters. Field staff have basic smartphones only.",
                },
                {
                    "key": "pilot_scope",
                    "heading": "What the pilot will cover",
                    "guidance": "Name the area, the units and the period. Keep the pilot small "
                    "enough to run and large enough to measure.",
                    "example": "Four district metering areas in the eastern zone, weekly "
                    "measurement, for the duration set by the Pilot Flight Simulator.",
                },
                {
                    "key": "commercial",
                    "heading": "Commercial terms",
                    "guidance": "State the budget ceiling, the milestone structure and the "
                    "intellectual property position.",
                    "example": "Budget ceiling as published. Payment against four milestones. "
                    "Startup retains intellectual property with a perpetual licence to the "
                    "department for its own use.",
                },
            ],
            "quality_checks": [
                "Every measure has a unit, a measurement method, a baseline and a target.",
                "The outcome statement contains a direction of change and a measure.",
                "A budget ceiling is published.",
                "No solution or vendor is named anywhere in the statement.",
            ],
        },
    },
    {
        "kind": "evaluation_rubric",
        "version": "1.0.0",
        "title": "Weighted evaluation rubric with anchors",
        "body": {
            "scale": "1 to 5, anchored. Each score needs a one-line written justification.",
            "rules": [
                "Round one is blind: applicant identity is hidden from evaluators.",
                "Weights must sum to 100 and are published with the challenge.",
                "Criteria measuring prior government experience are not permitted.",
                "Any criterion where evaluators differ by more than 1.5 points is flagged for "
                "discussion before the shortlist is confirmed.",
            ],
        },
    },
    {
        "kind": "pilot_agreement",
        "version": "1.0.0",
        "title": "Controlled pilot agreement",
        "body": {
            "clauses": [
                {
                    "number": "1",
                    "heading": "Purpose and scope",
                    "text": "The department engages the startup to deploy and operate the solution "
                    "described in the accepted proposal, for the sole purpose of a controlled "
                    "pilot in the area and for the period recorded in the pre-registered plan. "
                    "This agreement does not create any expectation of further procurement.",
                },
                {
                    "number": "2",
                    "heading": "Pre-registered plan",
                    "text": "The primary measure, pass mark, duration, number of units and "
                    "analysis method recorded in the pre-registered plan form part of this "
                    "agreement. They cannot be changed after the pilot starts except by an "
                    "amendment approved by the competent authority and recorded on the platform.",
                },
                {
                    "number": "3",
                    "heading": "Obligations of the startup",
                    "text": "The startup shall deploy, operate, maintain and support the solution "
                    "for the pilot period; submit measurements for every measure at the agreed "
                    "frequency; report any incident affecting data or service within 24 hours; "
                    "and cooperate fully with the independent validator, including providing "
                    "access to raw data on request.",
                },
                {
                    "number": "4",
                    "heading": "Obligations of the department",
                    "text": "The department shall nominate the pilot units and a single point of "
                    "contact; provide the access and data described in the data-sharing clause; "
                    "accept or reject each milestone within the service level recorded in this "
                    "agreement; and process payment for accepted milestones within the service "
                    "levels recorded in this agreement.",
                },
                {
                    "number": "5",
                    "heading": "Milestones and payment",
                    "text": "Payment is made against the milestones in the schedule to this "
                    "agreement. Each milestone lists its deliverable, the evidence required, the "
                    "due date and the amount. At least one milestone is payable before pilot "
                    "completion. Rejection of a milestone must cite the specific evidence "
                    "requirement that was not met.",
                },
                {
                    "number": "6",
                    "heading": "Intellectual property",
                    "text": "The intellectual property position selected for this pilot is "
                    "recorded in the schedule to this agreement and applies to all work produced "
                    "under it. Background intellectual property owned by either party before "
                    "this agreement remains with that party.",
                },
                {
                    "number": "7",
                    "heading": "Data protection",
                    "text": "The data-sharing schedule records what data the startup may access, "
                    "where it is stored, for how long it is retained and when it must be deleted. "
                    "The department shall anonymise or aggregate any data relating to identified "
                    "individuals before it is shared. Processing is limited to the purpose of "
                    "this pilot, consistent with the Digital Personal Data Protection Act, 2023.",
                },
                {
                    "number": "8",
                    "heading": "Cybersecurity",
                    "text": "The startup shall complete the cybersecurity checklist to this "
                    "agreement before the pilot is activated, and shall maintain those controls "
                    "for the pilot period. Any security incident affecting departmental data "
                    "shall be reported to the department and to the Indian Computer Emergency "
                    "Response Team within the timelines applicable to that body.",
                },
                {
                    "number": "9",
                    "heading": "Confidentiality",
                    "text": "Each party shall keep confidential any information marked as "
                    "confidential or which a reasonable person would treat as confidential, "
                    "except where disclosure is required by law or by an audit authority. "
                    "The existence of this pilot and its published results are not confidential.",
                },
                {
                    "number": "10",
                    "heading": "Exit and termination",
                    "text": "Either party may terminate on 30 days written notice. The department "
                    "may terminate immediately for a material breach of the data protection or "
                    "cybersecurity clauses. On termination for any reason, the startup shall "
                    "hand over an export of all departmental data in a documented open format "
                    "within 15 days, delete its copies within 30 days, and certify the deletion. "
                    "Milestones accepted before termination remain payable.",
                },
                {
                    "number": "11",
                    "heading": "Limitation and indemnity",
                    "text": "The liability of each party under this agreement is limited to the "
                    "total value of the pilot, except for breach of confidentiality, breach of "
                    "data protection obligations, or wilful misconduct.",
                },
                {
                    "number": "12",
                    "heading": "Dispute resolution",
                    "text": "The parties shall first attempt resolution by discussion between the "
                    "nominated points of contact within 15 days. Failing that, the matter shall "
                    "be referred to the head of the department and the founder of the startup. "
                    "Any remaining dispute shall be resolved under the Arbitration and "
                    "Conciliation Act, 1996, seated at the headquarters of the department.",
                },
            ],
        },
    },
    {
        "kind": "data_sharing",
        "version": "1.0.0",
        "title": "Data-sharing schedule",
        "body": {
            "fields": [
                {"key": "datasets", "label": "Datasets the startup may access", "required": True},
                {"key": "identifiers_removed", "label": "Direct identifiers removed before sharing", "required": True},
                {"key": "storage_location", "label": "Where the data is stored", "required": True,
                 "note": "Must be within India."},
                {"key": "processing_purpose", "label": "Purpose of processing", "required": True},
                {"key": "retention_months", "label": "Retention period in months", "required": True},
                {"key": "deletion_obligation", "label": "Deletion obligation on exit", "required": True},
                {"key": "sub_processors", "label": "Sub-processors, if any", "required": False},
                {"key": "access_log", "label": "Access logging arrangement", "required": True},
            ],
            "defaults": {
                "identifiers_removed": "Names, phone numbers, email addresses, address lines and "
                "any government identification numbers are removed or aggregated by the "
                "department before transfer.",
                "storage_location": "India",
                "retention_months": 12,
                "deletion_obligation": "All departmental data deleted within 30 days of pilot "
                "closure or termination, with written certification of deletion.",
                "access_log": "All access to departmental data is logged by the startup and the "
                "log is made available to the department and the independent validator on request.",
            },
        },
    },
    {
        "kind": "ip_clause",
        "version": "1.0.0",
        "title": "Intellectual property options",
        "body": {
            "options": [
                {
                    "code": "startup_retains",
                    "label": "Startup retains ownership, government gets a licence to use",
                    "plain_language": "The startup keeps its product. The department gets a "
                    "permanent, paid-up right to use it for its own functions, including in other "
                    "offices of the same department, at the rates agreed for scale-up. This is "
                    "the usual choice when the startup is deploying an existing product.",
                    "text": "All intellectual property in the solution remains with the startup. "
                    "The startup grants the department a non-exclusive, perpetual, irrevocable, "
                    "royalty-free licence to use the solution and its outputs for its own "
                    "governmental functions, with the right to sub-license to other government "
                    "bodies performing the same function.",
                },
                {
                    "code": "joint",
                    "label": "Joint ownership of what is built for this pilot",
                    "plain_language": "Anything newly created for this pilot is owned by both "
                    "parties. Each can use it without asking the other. This suits pilots where "
                    "the department contributes significant domain design.",
                    "text": "Intellectual property created specifically under this agreement is "
                    "owned jointly by the department and the startup. Each party may use, licence "
                    "and commercialise the jointly owned intellectual property without the "
                    "consent of, and without accounting to, the other.",
                },
                {
                    "code": "government_owned",
                    "label": "Government owns the bespoke work",
                    "plain_language": "Work built to order for the department belongs to the "
                    "department. The startup keeps its own pre-existing tools. Use this only "
                    "where the department is paying for bespoke development.",
                    "text": "All intellectual property created specifically under this agreement "
                    "vests in the department. The startup retains its background intellectual "
                    "property and grants the department a licence to it to the extent needed to "
                    "use the deliverables.",
                },
            ]
        },
    },
    {
        "kind": "cyber_checklist",
        "version": "1.0.0",
        "title": "Cybersecurity checklist",
        "body": {
            "items": [
                {"key": "hosting_in_india", "label": "All departmental data hosted within India", "required": True},
                {"key": "encryption_at_rest", "label": "Data encrypted at rest", "required": True},
                {"key": "encryption_in_transit", "label": "Data encrypted in transit using TLS 1.2 or higher", "required": True},
                {"key": "access_control", "label": "Role-based access control with named accounts", "required": True},
                {"key": "access_logging", "label": "Access to departmental data is logged and retained", "required": True},
                {"key": "mfa_admin", "label": "Multi-factor authentication on administrative access", "required": True},
                {"key": "backup_restore", "label": "Backups taken and restore tested", "required": True},
                {"key": "vulnerability_contact", "label": "Named vulnerability disclosure contact", "required": True},
                {"key": "patching", "label": "Documented patching schedule for the pilot period", "required": True},
                {"key": "incident_response", "label": "Incident response process including reporting to the department", "required": True},
                {"key": "pen_test", "label": "Application security testing in the last 12 months", "required": False},
                {"key": "data_export", "label": "Documented export of departmental data in an open format", "required": True},
            ]
        },
    },
    {
        "kind": "risk_register",
        "version": "1.0.0",
        "title": "Pilot risk register",
        "body": {
            "columns": ["risk", "likelihood", "impact", "owner", "mitigation", "trigger"],
            "starter_rows": [
                {
                    "risk": "Baseline data is incomplete when the pilot starts",
                    "likelihood": "Medium",
                    "impact": "High",
                    "owner": "Department Officer",
                    "mitigation": "Collect and lock the baseline before activation; the Evidence "
                    "Engine will not run without it.",
                    "trigger": "Fewer than 80 percent of planned baseline measurements received.",
                },
                {
                    "risk": "Pilot units are not representative of the wider area",
                    "likelihood": "Medium",
                    "impact": "High",
                    "owner": "Department Officer",
                    "mitigation": "Record the selection method in the pre-registered plan and "
                    "state it as a limitation in the Evidence Report.",
                    "trigger": "Selection made on convenience rather than a stated rule.",
                },
                {
                    "risk": "Startup cannot sustain the pilot financially",
                    "likelihood": "Medium",
                    "impact": "High",
                    "owner": "Department Approver",
                    "mitigation": "At least one milestone paid before completion; service levels "
                    "on acceptance, approval and release tracked and escalated automatically.",
                    "trigger": "Any milestone service level breached.",
                },
                {
                    "risk": "Departmental data is exposed",
                    "likelihood": "Low",
                    "impact": "High",
                    "owner": "Department Officer",
                    "mitigation": "Anonymise before transfer; cybersecurity checklist completed "
                    "before activation; access logged.",
                    "trigger": "Any reported incident.",
                },
                {
                    "risk": "Result cannot be interpreted because the design was too small",
                    "likelihood": "Medium",
                    "impact": "High",
                    "owner": "Department Officer",
                    "mitigation": "Pilot Flight Simulator run before activation; design frozen "
                    "only if it reaches the target power.",
                    "trigger": "Simulated power below the target at design freeze.",
                },
                {
                    "risk": "Department becomes dependent on a single vendor",
                    "likelihood": "Medium",
                    "impact": "Medium",
                    "owner": "Department Approver",
                    "mitigation": "Vendor Dependency Score computed before the scale decision; "
                    "exit plan required above 60.",
                    "trigger": "Vendor Dependency Score above 60.",
                },
            ],
        },
    },
    {
        "kind": "exit_plan",
        "version": "1.0.0",
        "title": "Exit plan",
        "body": {
            "fields": [
                {"key": "data_export_format", "label": "Format of the departmental data export", "required": True},
                {"key": "export_tested_on", "label": "Date the export was tested", "required": True},
                {"key": "transition_period_days", "label": "Transition period in days", "required": True},
                {"key": "knowledge_transfer", "label": "Knowledge transfer arrangement", "required": True},
                {"key": "alternative_vendors", "label": "Alternative vendors able to take over", "required": True},
                {"key": "deletion_certificate", "label": "Deletion certification arrangement", "required": True},
                {"key": "standards_used", "label": "Open standards used by the solution", "required": False},
            ],
            "defaults": {
                "data_export_format": "CSV with a documented schema, plus the raw measurement "
                "records in JSON.",
                "transition_period_days": 30,
                "knowledge_transfer": "Written operating documentation and two handover sessions "
                "with departmental staff.",
                "deletion_certificate": "Written certification of deletion signed by an officer "
                "of the startup within 30 days of exit.",
            },
        },
    },
]


async def install_template_kit(session: AsyncSession) -> int:
    """Install any template version that is not already present. Versions are immutable."""
    installed = 0
    for entry in TEMPLATE_KIT:
        existing = await session.execute(
            select(Template).where(
                Template.kind == entry["kind"],
                Template.version == entry["version"],
                Template.locale == "en",
            )
        )
        if existing.scalar_one_or_none() is not None:
            continue
        session.add(
            Template(
                kind=entry["kind"],
                version=entry["version"],
                locale="en",
                title=entry["title"],
                body=entry["body"],
                source_note=LEGAL_REVIEW_NOTE,
                published_at=utcnow(),
            )
        )
        installed += 1
    await session.flush()
    return installed


async def latest(session: AsyncSession, kind: str, locale: str = "en") -> Template:
    result = await session.execute(
        select(Template)
        .where(Template.kind == kind, Template.locale == locale, Template.superseded_at.is_(None))
        .order_by(Template.published_at.desc())
        .limit(1)
    )
    template = result.scalar_one_or_none()
    if template is None:
        raise NotFound("No template is installed for " + kind + ".")
    return template


async def latest_versions(session: AsyncSession, kinds: tuple[str, ...], locale: str = "en") -> dict[str, str]:
    """The version map a challenge or agreement records (FR-CB-04)."""
    out: dict[str, str] = {}
    for kind in kinds:
        template = await latest(session, kind, locale)
        out[kind] = template.version
    return out


async def all_templates(session: AsyncSession, locale: str = "en") -> list[Template]:
    result = await session.execute(
        select(Template).where(Template.locale == locale).order_by(Template.kind, Template.version)
    )
    return list(result.scalars().all())


CHALLENGE_TEMPLATE_KINDS = ("problem_statement", "evaluation_rubric", "risk_register")
AGREEMENT_TEMPLATE_KINDS = (
    "pilot_agreement",
    "data_sharing",
    "ip_clause",
    "cyber_checklist",
    "risk_register",
    "exit_plan",
)
