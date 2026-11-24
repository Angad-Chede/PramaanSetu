"""Document rendering (FR-PA-07, FR-EE-03, FR-SC-05, FR-AD-04).

Rendered agreements and Evidence Reports are stored in the document vault with their
SHA-256 hash recorded in the audit log. Rendering is deterministic: the same input
produces the same bytes, so the hash is meaningful.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.core.clock import format_ist, utcnow
from app.core.money import format_inr

INK = colors.HexColor("#1b1f23")
MUTED = colors.HexColor("#5b6670")
RULE = colors.HexColor("#c8cdd2")
BAND = colors.HexColor("#eef1f3")


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "DocTitle", parent=base["Title"], fontName="Helvetica-Bold", fontSize=17,
            leading=21, textColor=INK, alignment=TA_LEFT, spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "DocSubtitle", parent=base["Normal"], fontName="Helvetica", fontSize=9.5,
            leading=13, textColor=MUTED, spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "H2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=11.5,
            leading=15, textColor=INK, spaceBefore=12, spaceAfter=5,
        ),
        "h3": ParagraphStyle(
            "H3", parent=base["Heading3"], fontName="Helvetica-Bold", fontSize=10,
            leading=13, textColor=INK, spaceBefore=8, spaceAfter=3,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["Normal"], fontName="Helvetica", fontSize=9.5,
            leading=13.5, textColor=INK, spaceAfter=5,
        ),
        "small": ParagraphStyle(
            "Small", parent=base["Normal"], fontName="Helvetica", fontSize=8,
            leading=11, textColor=MUTED, spaceAfter=3,
        ),
        "cell": ParagraphStyle(
            "Cell", parent=base["Normal"], fontName="Helvetica", fontSize=8.5, leading=11.5,
            textColor=INK,
        ),
        "cellhead": ParagraphStyle(
            "CellHead", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
            leading=11.5, textColor=INK,
        ),
    }


def _table(rows: list[list[Any]], widths: list[float], styles: dict[str, ParagraphStyle]) -> Table:
    data = [
        [Paragraph(str(cell), styles["cellhead"] if index == 0 else styles["cell"]) for cell in row]
        for index, row in enumerate(rows)
    ]
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), BAND),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, RULE),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, RULE),
                ("BOX", (0, 0), (-1, -1), 0.5, RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


@dataclass
class RenderedDocument:
    data: bytes
    filename: str
    mime: str = "application/pdf"


def _build(story: list[Any], *, title: str, subject: str) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=title,
        author="PramaanSetu",
        subject=subject,
        creator="PramaanSetu",
    )

    def _footer(canvas, document):  # type: ignore[no-untyped-def]
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 11 * mm, "PramaanSetu " + title)
        canvas.drawRightString(A4[0] - 20 * mm, 11 * mm, "Page " + str(document.page))
        canvas.setStrokeColor(RULE)
        canvas.line(20 * mm, 14 * mm, A4[0] - 20 * mm, 14 * mm)
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


def render_agreement(payload: dict[str, Any]) -> RenderedDocument:
    """Pilot agreement PDF assembled from the Template Kit (FR-PA-01, FR-PA-07)."""
    s = _styles()
    width = A4[0] - 40 * mm
    story: list[Any] = []

    story.append(Paragraph("Controlled Pilot Agreement", s["title"]))
    story.append(
        Paragraph(
            payload["challenge_title"] + " | Version " + str(payload["version_number"])
            + " | Generated " + format_ist(utcnow()),
            s["subtitle"],
        )
    )

    story.append(Paragraph("Parties", s["h2"]))
    story.append(
        _table(
            [
                ["Party", "Details"],
                ["Department", payload["department_name"] + "<br/>" + payload.get("department_address", "")],
                [
                    "Startup",
                    payload["startup_name"]
                    + "<br/>Corporate identity number: "
                    + str(payload.get("startup_cin") or "not recorded")
                    + "<br/>Startup recognition number: "
                    + str(payload.get("startup_dpiit") or "not recorded"),
                ],
                ["Challenge reference", payload["challenge_reference"]],
                ["Pilot reference", payload["pilot_reference"]],
            ],
            [38 * mm, width - 38 * mm],
            s,
        )
    )

    story.append(Paragraph("Schedule 1: Pre-registered plan", s["h2"]))
    design = payload.get("design") or {}
    if design:
        story.append(
            _table(
                [
                    ["Item", "Value"],
                    ["Primary measure", str(design.get("primary_kpi_name", ""))],
                    ["Pass mark", str(design.get("pass_mark", "")) + " " + str(design.get("unit", ""))],
                    ["Duration", str(design.get("duration_weeks", "")) + " weeks"],
                    ["Number of units", str(design.get("units", ""))],
                    ["Measurement frequency", str(design.get("measurements_per_week", "")) + " per week"],
                    ["Analysis method", str(design.get("analysis_method_label", design.get("analysis_method", "")))],
                    ["Design frozen on", str(design.get("frozen_at", "not yet frozen"))],
                ],
                [45 * mm, width - 45 * mm],
                s,
            )
        )
        story.append(
            Paragraph(
                "This plan is pre-registered. It cannot be changed after the pilot starts except "
                "by an amendment approved by the competent authority and recorded on the platform.",
                s["small"],
            )
        )
    else:
        story.append(Paragraph("The pre-registered plan has not been frozen yet.", s["body"]))

    story.append(Paragraph("Schedule 2: Milestones and payment", s["h2"]))
    milestone_rows: list[list[Any]] = [
        ["No.", "Deliverable", "Evidence required", "Due date", "Amount (INR)"]
    ]
    for milestone in payload.get("milestones", []):
        milestone_rows.append(
            [
                str(milestone["seq"]),
                milestone["title"] + "<br/>" + milestone.get("deliverable", ""),
                milestone.get("evidence_required", ""),
                milestone.get("due_date", ""),
                format_inr(int(milestone.get("amount_paise", 0))),
            ]
        )
    total = sum(int(m.get("amount_paise", 0)) for m in payload.get("milestones", []))
    milestone_rows.append(["", "Total", "", "", format_inr(total)])
    story.append(
        _table(milestone_rows, [10 * mm, 58 * mm, 45 * mm, 22 * mm, width - 135 * mm], s)
    )
    story.append(
        Paragraph(
            "Service levels: the department accepts or rejects a milestone within "
            + str(payload.get("sla_accept_days", 7))
            + " days of submission; the competent authority approves payment within "
            + str(payload.get("sla_approve_days", 5))
            + " days of acceptance; the finance office records release within "
            + str(payload.get("sla_release_days", 7))
            + " days of approval. Breaches are escalated automatically.",
            s["small"],
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("Terms and conditions", s["h2"]))
    for clause in payload.get("clauses", []):
        story.append(
            KeepTogether(
                [
                    Paragraph(clause["number"] + ". " + clause["heading"], s["h3"]),
                    Paragraph(clause["text"], s["body"]),
                ]
            )
        )

    ip = payload.get("ip_option_detail") or {}
    if ip:
        story.append(Paragraph("Schedule 3: Intellectual property", s["h2"]))
        story.append(Paragraph(ip.get("label", ""), s["h3"]))
        story.append(Paragraph(ip.get("plain_language", ""), s["body"]))
        story.append(Paragraph(ip.get("text", ""), s["body"]))

    data_terms = payload.get("data_terms") or {}
    if data_terms:
        story.append(Paragraph("Schedule 4: Data-sharing terms", s["h2"]))
        rows = [["Item", "Agreed position"]]
        for key, value in data_terms.items():
            rows.append([key.replace("_", " ").capitalize(), str(value)])
        story.append(_table(rows, [50 * mm, width - 50 * mm], s))

    checklist = payload.get("cyber_checklist") or {}
    if checklist:
        story.append(Paragraph("Schedule 5: Cybersecurity checklist", s["h2"]))
        rows = [["Control", "Confirmed"]]
        for key, value in checklist.items():
            rows.append([key.replace("_", " ").capitalize(), "Yes" if value else "No"])
        story.append(_table(rows, [width - 30 * mm, 30 * mm], s))

    story.append(Paragraph("Execution", s["h2"]))
    story.append(
        _table(
            [
                ["Role", "Name", "Date"],
                [
                    "For the department",
                    str(payload.get("approved_by_name", "pending approval")),
                    str(payload.get("approved_at", "")),
                ],
                [
                    "For the startup",
                    str(payload.get("accepted_by_name", "pending acceptance")),
                    str(payload.get("accepted_at", "")),
                ],
            ],
            [40 * mm, (width - 40 * mm) * 0.6, (width - 40 * mm) * 0.4],
            s,
        )
    )
    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph(
            "Template versions used: "
            + ", ".join(
                str(k) + " " + str(v) for k, v in (payload.get("template_versions") or {}).items()
            )
            + ". Drafted from public guidance and reviewed by the department legal cell before "
            "execution. This document is not legal advice.",
            s["small"],
        )
    )

    data = _build(story, title="Pilot Agreement", subject=payload["challenge_title"])
    return RenderedDocument(data=data, filename="pilot-agreement-" + payload["pilot_reference"] + ".pdf")


def render_evidence_report(payload: dict[str, Any]) -> RenderedDocument:
    """Evidence Report PDF: plan versus actual, results, deviations and limitations."""
    s = _styles()
    width = A4[0] - 40 * mm
    story: list[Any] = []

    story.append(Paragraph("Evidence Report", s["title"]))
    story.append(
        Paragraph(
            payload["challenge_title"]
            + " | "
            + payload["startup_name"]
            + " | Report "
            + payload["reference"]
            + " | Generated "
            + format_ist(utcnow()),
            s["subtitle"],
        )
    )

    score = payload.get("score") or {}
    story.append(Paragraph("Evidence Confidence Score", s["h2"]))
    story.append(
        Paragraph(
            str(score.get("score", 0)) + " out of 100. Band: " + str(score.get("band", "")) + ".",
            s["h3"],
        )
    )
    story.append(Paragraph(str(score.get("band_guidance", "")), s["body"]))
    component_rows: list[list[Any]] = [["Component", "Points", "Maximum", "Why"]]
    for component in score.get("components", []):
        component_rows.append(
            [
                component["name"],
                str(component["points"]),
                str(component["max_points"]),
                component["explanation"],
            ]
        )
    story.append(_table(component_rows, [34 * mm, 16 * mm, 20 * mm, width - 70 * mm], s))

    story.append(Paragraph("Plan versus actual", s["h2"]))
    plan = payload.get("plan_vs_actual", [])
    story.append(
        _table(
            [["Item", "Pre-registered plan", "What happened"]]
            + [[row["item"], row["planned"], row["actual"]] for row in plan],
            [42 * mm, (width - 42 * mm) / 2, (width - 42 * mm) / 2],
            s,
        )
    )

    story.append(Paragraph("Result on the primary measure", s["h2"]))
    analysis = payload.get("analysis") or {}
    story.append(
        _table(
            [
                ["Item", "Value"],
                ["Measure", str(payload.get("primary_kpi_name", ""))],
                ["Analysis method", str(analysis.get("method_label", ""))],
                ["Baseline mean", str(analysis.get("baseline_mean", ""))],
                ["Pilot mean", str(analysis.get("pilot_mean", ""))],
                ["Measured change", str(analysis.get("effect", ""))],
                [
                    "95 percent confidence interval",
                    str(analysis.get("ci_low", "")) + " to " + str(analysis.get("ci_high", "")),
                ],
                ["p-value", str(analysis.get("p_value", ""))],
                ["Units analysed", str(analysis.get("n_pilot", ""))],
                ["Analysis seed", str(analysis.get("seed", ""))],
            ],
            [55 * mm, width - 55 * mm],
            s,
        )
    )
    story.append(
        Paragraph(
            "How to read the interval: the measured change is the best single estimate. The "
            "confidence interval is the range the true change is most likely to lie in. If the "
            "interval includes no change, this pilot cannot rule out that the difference is "
            "chance variation.",
            s["small"],
        )
    )

    secondary = payload.get("secondary", [])
    if secondary:
        story.append(Paragraph("Supporting measures", s["h2"]))
        story.append(
            _table(
                [["Measure", "Baseline", "Pilot", "Change", "95 percent interval"]]
                + [
                    [
                        row["name"],
                        str(row["baseline_mean"]),
                        str(row["pilot_mean"]),
                        str(row["effect"]),
                        str(row["ci_low"]) + " to " + str(row["ci_high"]),
                    ]
                    for row in secondary
                ],
                [50 * mm, 22 * mm, 22 * mm, 22 * mm, width - 116 * mm],
                s,
            )
        )

    completeness = payload.get("completeness") or {}
    story.append(Paragraph("Data completeness", s["h2"]))
    story.append(
        _table(
            [
                ["Item", "Value"],
                ["Measurements planned", str(completeness.get("planned", ""))],
                ["Measurements received", str(completeness.get("received", ""))],
                ["Completeness", str(completeness.get("percent", "")) + " percent"],
                ["Rows rejected or disputed", str(completeness.get("rejected", ""))],
                ["Dataset hash", str(payload.get("dataset_hash", ""))],
            ],
            [55 * mm, width - 55 * mm],
            s,
        )
    )
    story.append(
        Paragraph(
            "The dataset hash locks the exact data analysed. Any later change to the data "
            "invalidates this report and requires a fresh analysis.",
            s["small"],
        )
    )

    deviations = payload.get("deviations", [])
    story.append(Paragraph("Deviations from the pre-registered plan", s["h2"]))
    if deviations:
        story.append(
            _table(
                [["Deviation", "Approved", "Recorded on"]]
                + [
                    [d.get("description", ""), "Yes" if d.get("approved") else "No", d.get("at", "")]
                    for d in deviations
                ],
                [width - 50 * mm, 20 * mm, 30 * mm],
                s,
            )
        )
    else:
        story.append(Paragraph("None recorded. The pilot ran as pre-registered.", s["body"]))

    story.append(Paragraph("Limitations", s["h2"]))
    for limitation in payload.get("limitations", []):
        story.append(Paragraph("- " + limitation, s["body"]))

    validation = payload.get("validation") or {}
    story.append(Paragraph("Independent validation", s["h2"]))
    story.append(
        _table(
            [
                ["Item", "Value"],
                ["Status", str(validation.get("status", "Not yet validated"))],
                ["Validator", str(validation.get("validator_name", ""))],
                ["Signed on", str(validation.get("signed_at", ""))],
                ["Remarks", str(validation.get("remarks", ""))],
            ],
            [40 * mm, width - 40 * mm],
            s,
        )
    )
    checklist = validation.get("checklist") or {}
    if checklist:
        story.append(
            _table(
                [["Verification step", "Outcome"]]
                + [[k.replace("_", " ").capitalize(), "Verified" if v else "Not verified"] for k, v in checklist.items()],
                [width - 35 * mm, 35 * mm],
                s,
            )
        )

    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph(
            "Engine version " + str(payload.get("engine_version", "")) + ", seed "
            + str(payload.get("seed", ""))
            + ". Re-running this analysis on the same locked dataset reproduces this result "
            "exactly. The score informs the competent authority; it does not decide.",
            s["small"],
        )
    )

    data = _build(story, title="Evidence Report", subject=payload["challenge_title"])
    return RenderedDocument(data=data, filename="evidence-report-" + payload["reference"] + ".pdf")


def render_handoff_pack(payload: dict[str, Any]) -> RenderedDocument:
    """Procurement handoff pack (FR-SC-05)."""
    s = _styles()
    width = A4[0] - 40 * mm
    story: list[Any] = []

    story.append(Paragraph("Procurement Handoff Pack", s["title"]))
    story.append(
        Paragraph(
            payload["challenge_title"] + " | " + payload["department_name"] + " | Generated "
            + format_ist(utcnow()),
            s["subtitle"],
        )
    )

    story.append(Paragraph("Decision", s["h2"]))
    story.append(
        _table(
            [
                ["Item", "Value"],
                ["Decision", str(payload.get("decision", ""))],
                ["Decided by", str(payload.get("decided_by_name", ""))],
                ["Decided on", str(payload.get("decided_at", ""))],
                ["Reason", str(payload.get("reason", ""))],
                ["Evidence Confidence Score", str(payload.get("confidence_score", "")) + " (" + str(payload.get("band", "")) + ")"],
                ["Estimated scale-up value", format_inr(int(payload.get("estimated_value_paise", 0)))],
            ],
            [50 * mm, width - 50 * mm],
            s,
        )
    )

    pathway = payload.get("pathway") or {}
    recommended = pathway.get("recommended") or {}
    story.append(Paragraph("Recommended procurement route", s["h2"]))
    story.append(Paragraph(str(recommended.get("name", "")), s["h3"]))
    story.append(Paragraph(str(recommended.get("rationale", "")), s["body"]))
    for condition in recommended.get("conditions", []):
        story.append(Paragraph("- " + condition, s["body"]))
    story.append(Paragraph("Reference: " + str(recommended.get("reference", "")), s["small"]))
    story.append(Paragraph(str(pathway.get("caveat", "")), s["small"]))

    projection = payload.get("scale_projection") or {}
    if projection:
        story.append(Paragraph("Scale projection", s["h2"]))
        story.append(
            _table(
                [
                    ["Case", "Projected benefit", "Basis"],
                    ["Conservative", str(projection.get("benefit_low", "")) + " " + str(projection.get("benefit_unit", "")), "Lower bound of the validated confidence interval"],
                    ["Expected", str(projection.get("benefit_expected", "")) + " " + str(projection.get("benefit_unit", "")), "Point estimate of the validated effect"],
                    ["Optimistic", str(projection.get("benefit_high", "")) + " " + str(projection.get("benefit_unit", "")), "Upper bound of the validated confidence interval"],
                    ["Rollout cost", format_inr(int(projection.get("total_cost_paise", 0))), str(projection.get("units", 0)) + " units"],
                ],
                [30 * mm, 45 * mm, width - 75 * mm],
                s,
            )
        )

    dependency = payload.get("vendor_dependency") or {}
    if dependency:
        story.append(Paragraph("Vendor Dependency Score", s["h2"]))
        story.append(
            Paragraph(
                str(dependency.get("score", 0)) + " out of 100 (" + str(dependency.get("level", "")) + "). "
                + str(dependency.get("message", "")),
                s["body"],
            )
        )
        story.append(
            _table(
                [["Factor", "Weight", "Present", "Mitigation"]]
                + [
                    [f["label"], str(f["weight"]), "Yes" if f["present"] else "No", f.get("mitigation", "")]
                    for f in dependency.get("factors", [])
                ],
                [55 * mm, 16 * mm, 18 * mm, width - 89 * mm],
                s,
            )
        )

    story.append(Paragraph("Specification for procurement", s["h2"]))
    for line in payload.get("specification", []):
        story.append(Paragraph("- " + line, s["body"]))

    story.append(Paragraph("Attached records", s["h2"]))
    story.append(
        _table(
            [["Record", "Reference"]]
            + [[row["name"], row["reference"]] for row in payload.get("attachments", [])],
            [60 * mm, width - 60 * mm],
            s,
        )
    )

    data = _build(story, title="Procurement Handoff Pack", subject=payload["challenge_title"])
    return RenderedDocument(
        data=data, filename="handoff-pack-" + payload["challenge_reference"] + ".pdf"
    )


def render_challenge_summary(payload: dict[str, Any]) -> RenderedDocument:
    """The one-page summary the approver reads before approving (FR-CB-07)."""
    s = _styles()
    width = A4[0] - 40 * mm
    story: list[Any] = []

    story.append(Paragraph(payload["title"], s["title"]))
    story.append(
        Paragraph(
            payload["department_name"] + " | " + payload["reference"] + " | State: " + payload["state"],
            s["subtitle"],
        )
    )

    story.append(Paragraph("Outcome sought", s["h2"]))
    story.append(Paragraph(payload["outcome_statement"], s["body"]))

    story.append(Paragraph("Measures", s["h2"]))
    story.append(
        _table(
            [["Measure", "Unit", "Direction", "Baseline", "Target", "How it is measured"]]
            + [
                [
                    k["name"],
                    k["unit"],
                    "Lower is better" if k["direction"] == "lower" else "Higher is better",
                    str(k.get("baseline_value") if k.get("baseline_value") is not None else "to be measured"),
                    str(k.get("target_value") if k.get("target_value") is not None else "to be set"),
                    k.get("baseline_method", ""),
                ]
                for k in payload.get("kpis", [])
            ],
            [32 * mm, 20 * mm, 22 * mm, 18 * mm, 16 * mm, width - 108 * mm],
            s,
        )
    )

    story.append(Paragraph("Commercial and timeline", s["h2"]))
    story.append(
        _table(
            [
                ["Item", "Value"],
                ["Budget ceiling", format_inr(int(payload.get("budget_ceiling_paise", 0)))],
                ["Application deadline", str(payload.get("application_deadline", ""))],
                ["Pilot duration", str(payload.get("pilot_duration_weeks", "")) + " weeks"],
                ["Intellectual property option", str(payload.get("ip_option_label", ""))],
            ],
            [50 * mm, width - 50 * mm],
            s,
        )
    )

    story.append(Paragraph("Evaluation rubric", s["h2"]))
    story.append(
        _table(
            [["Criterion", "Weight", "What is being judged"]]
            + [[c["name"], str(c["weight"]), c.get("description", "")] for c in payload.get("criteria", [])],
            [42 * mm, 18 * mm, width - 60 * mm],
            s,
        )
    )

    flags = payload.get("quality_flags", [])
    if flags:
        story.append(Paragraph("Quality checks raised", s["h2"]))
        for flag in flags:
            story.append(Paragraph("- " + str(flag.get("message", flag)), s["body"]))

    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph(
            "Template versions used: "
            + ", ".join(str(k) + " " + str(v) for k, v in (payload.get("template_versions") or {}).items())
            + ".",
            s["small"],
        )
    )

    data = _build(story, title="Challenge Summary", subject=payload["title"])
    return RenderedDocument(data=data, filename="challenge-" + payload["reference"] + ".pdf")
