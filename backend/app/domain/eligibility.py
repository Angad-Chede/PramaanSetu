"""Eligibility rules engine (PRD 5.4).

Two properties matter and are enforced here rather than in a route:

1. Where the government relaxation of prior-turnover and prior-experience criteria applies
   to a DPIIT-recognised startup, the engine applies it automatically and records the rule
   that was used. Quality and technical criteria are never relaxed (FR-ES-02).
2. Every rule produces a sentence a startup can read and act on (FR-ES-03).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from app.domain.states import DpiitStatus, EligibilityOutcome

RELAXATION_CITATION = (
    "General Financial Rules, 2017 Rule 173(i) read with the Department of Expenditure "
    "relaxation of prior turnover and prior experience criteria for startups recognised "
    "by the Department for Promotion of Industry and Internal Trade."
)


@dataclass
class RuleResult:
    code: str
    name: str
    passed: bool
    blocking: bool
    reason: str
    fix: str = ""
    relaxed: bool = False
    citation: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ScreeningInput:
    """Everything the engine needs, already read from the database by the caller."""

    dpiit_status: str
    sectors: list[str]
    state_code: str | None
    district: str | None
    annual_turnover_paise: int
    years_of_experience: int
    pilot_cost_paise: int
    conflict_declaration: bool
    ip_declaration: str
    data_declaration: str
    kpi_commitment_count: int
    challenge_sector: str | None
    challenge_state_code: str | None
    challenge_district: str | None
    location_required: bool
    budget_ceiling_paise: int
    required_kpi_count: int
    rules: dict[str, Any] = field(default_factory=dict)


@dataclass
class ScreeningOutcome:
    outcome: str
    rule_results: list[dict[str, Any]]
    relaxations_applied: list[dict[str, str]]
    summary: str


def _dpiit_rule(data: ScreeningInput) -> RuleResult:
    if data.dpiit_status == DpiitStatus.VERIFIED:
        return RuleResult(
            code="dpiit",
            name="Startup recognition",
            passed=True,
            blocking=True,
            reason="The startup is recognised by the Department for Promotion of Industry and Internal Trade.",
        )
    if data.dpiit_status == DpiitStatus.PENDING:
        return RuleResult(
            code="dpiit",
            name="Startup recognition",
            passed=False,
            blocking=False,
            reason="Recognition check is still pending with the Startup India registry.",
            fix="No action needed now. The check runs again automatically; if it does not "
            "complete, confirm the recognition number on the startup profile.",
        )
    return RuleResult(
        code="dpiit",
        name="Startup recognition",
        passed=False,
        blocking=True,
        reason="No recognition record was found for the number given on the startup profile.",
        fix="Check the recognition number on the startup profile and run verification again.",
    )


def _sector_rule(data: ScreeningInput) -> RuleResult:
    if not data.challenge_sector:
        return RuleResult(
            code="sector",
            name="Sector",
            passed=True,
            blocking=False,
            reason="This challenge is open to all sectors.",
        )
    tags = {str(s).strip().lower() for s in data.sectors or []}
    if data.challenge_sector.strip().lower() in tags:
        return RuleResult(
            code="sector",
            name="Sector",
            passed=True,
            blocking=True,
            reason="The startup lists " + data.challenge_sector + " among its sectors.",
        )
    return RuleResult(
        code="sector",
        name="Sector",
        passed=False,
        blocking=True,
        reason="The challenge is in " + data.challenge_sector
        + " and the startup profile does not list that sector.",
        fix="Add the sector to the startup profile if the solution genuinely applies to it, "
        "then ask the department to screen the application again.",
    )


def _location_rule(data: ScreeningInput) -> RuleResult:
    if not data.location_required:
        return RuleResult(
            code="location",
            name="Location",
            passed=True,
            blocking=False,
            reason="This challenge does not restrict the applicant location.",
        )
    if data.challenge_state_code and data.state_code == data.challenge_state_code:
        return RuleResult(
            code="location",
            name="Location",
            passed=True,
            blocking=True,
            reason="The startup is registered in the state named in the challenge.",
        )
    return RuleResult(
        code="location",
        name="Location",
        passed=False,
        blocking=True,
        reason="This challenge is limited to startups registered in state "
        + str(data.challenge_state_code) + ".",
        fix="No action is possible on this challenge. Look for challenges without a location "
        "restriction on the challenge board.",
    )


def _turnover_rule(data: ScreeningInput) -> RuleResult:
    required = int(data.rules.get("min_turnover_paise", 0) or 0)
    if required <= 0:
        return RuleResult(
            code="turnover",
            name="Prior turnover",
            passed=True,
            blocking=False,
            reason="This challenge sets no prior turnover requirement.",
        )
    if data.dpiit_status == DpiitStatus.VERIFIED:
        return RuleResult(
            code="turnover",
            name="Prior turnover",
            passed=True,
            blocking=True,
            reason="The prior turnover requirement is relaxed for this recognised startup.",
            relaxed=True,
            citation=RELAXATION_CITATION,
        )
    if data.annual_turnover_paise >= required:
        return RuleResult(
            code="turnover",
            name="Prior turnover",
            passed=True,
            blocking=True,
            reason="Declared annual turnover meets the requirement.",
        )
    return RuleResult(
        code="turnover",
        name="Prior turnover",
        passed=False,
        blocking=True,
        reason="Declared annual turnover is below the requirement and the startup is not "
        "recognised, so the relaxation does not apply.",
        fix="Complete recognition with the Department for Promotion of Industry and Internal "
        "Trade, then verify it on the startup profile.",
    )


def _experience_rule(data: ScreeningInput) -> RuleResult:
    required = int(data.rules.get("min_experience_years", 0) or 0)
    if required <= 0:
        return RuleResult(
            code="experience",
            name="Prior experience",
            passed=True,
            blocking=False,
            reason="This challenge sets no prior experience requirement.",
        )
    if data.dpiit_status == DpiitStatus.VERIFIED:
        return RuleResult(
            code="experience",
            name="Prior experience",
            passed=True,
            blocking=True,
            reason="The prior experience requirement is relaxed for this recognised startup.",
            relaxed=True,
            citation=RELAXATION_CITATION,
        )
    if data.years_of_experience >= required:
        return RuleResult(
            code="experience",
            name="Prior experience",
            passed=True,
            blocking=True,
            reason="Declared years of experience meet the requirement.",
        )
    return RuleResult(
        code="experience",
        name="Prior experience",
        passed=False,
        blocking=True,
        reason="Declared experience is below the requirement and the relaxation does not apply.",
        fix="Complete recognition with the Department for Promotion of Industry and Internal "
        "Trade, then verify it on the startup profile.",
    )


def _budget_rule(data: ScreeningInput) -> RuleResult:
    if data.budget_ceiling_paise <= 0:
        return RuleResult(
            code="budget",
            name="Pilot cost",
            passed=True,
            blocking=False,
            reason="This challenge does not publish a budget ceiling.",
        )
    if data.pilot_cost_paise <= data.budget_ceiling_paise:
        return RuleResult(
            code="budget",
            name="Pilot cost",
            passed=True,
            blocking=True,
            reason="The quoted pilot cost is within the published ceiling.",
        )
    return RuleResult(
        code="budget",
        name="Pilot cost",
        passed=False,
        blocking=True,
        reason="The quoted pilot cost is above the published ceiling for this challenge.",
        fix="Reduce the pilot scope or the quoted cost so it is at or below the ceiling, "
        "then submit again before the deadline.",
    )


def _declarations_rule(data: ScreeningInput) -> RuleResult:
    missing: list[str] = []
    if not data.conflict_declaration:
        missing.append("conflict of interest declaration")
    if not data.ip_declaration:
        missing.append("intellectual property option")
    if not (data.data_declaration or "").strip():
        missing.append("data handling declaration")
    if missing:
        return RuleResult(
            code="declarations",
            name="Mandatory declarations",
            passed=False,
            blocking=True,
            reason="These declarations are missing: " + ", ".join(missing) + ".",
            fix="Complete the missing declarations on the application form.",
        )
    return RuleResult(
        code="declarations",
        name="Mandatory declarations",
        passed=True,
        blocking=True,
        reason="All mandatory declarations are on record.",
    )


def _commitment_rule(data: ScreeningInput) -> RuleResult:
    if data.kpi_commitment_count >= data.required_kpi_count and data.required_kpi_count > 0:
        return RuleResult(
            code="commitments",
            name="Outcome commitments",
            passed=True,
            blocking=True,
            reason="A committed value was given for every measure in the challenge.",
        )
    if data.required_kpi_count == 0:
        return RuleResult(
            code="commitments",
            name="Outcome commitments",
            passed=True,
            blocking=False,
            reason="This challenge defines no measures.",
        )
    return RuleResult(
        code="commitments",
        name="Outcome commitments",
        passed=False,
        blocking=True,
        reason="Committed values are missing for "
        + str(data.required_kpi_count - data.kpi_commitment_count)
        + " of the "
        + str(data.required_kpi_count)
        + " measures in this challenge.",
        fix="Enter a committed value for every measure before the deadline.",
    )


RULES = (
    _dpiit_rule,
    _sector_rule,
    _location_rule,
    _turnover_rule,
    _experience_rule,
    _budget_rule,
    _declarations_rule,
    _commitment_rule,
)


def screen(data: ScreeningInput) -> ScreeningOutcome:
    """Run every rule and decide the outcome. Pure function, fully testable."""
    results = [rule(data) for rule in RULES]

    blocking_failures = [r for r in results if r.blocking and not r.passed]
    soft_failures = [r for r in results if not r.blocking and not r.passed]

    if blocking_failures:
        outcome = EligibilityOutcome.INELIGIBLE
        summary = "Not eligible: " + "; ".join(r.reason for r in blocking_failures)
    elif soft_failures:
        outcome = EligibilityOutcome.NEEDS_REVIEW
        summary = "Needs review: " + "; ".join(r.reason for r in soft_failures)
    else:
        outcome = EligibilityOutcome.ELIGIBLE
        summary = "Eligible. Every published criterion is met."

    relaxations = [
        {"rule": r.code, "name": r.name, "citation": r.citation}
        for r in results
        if r.relaxed
    ]
    if relaxations:
        summary += (
            " Startup relaxation applied to: "
            + ", ".join(r["name"].lower() for r in relaxations)
            + "."
        )

    return ScreeningOutcome(
        outcome=str(outcome),
        rule_results=[r.to_dict() for r in results],
        relaxations_applied=relaxations,
        summary=summary,
    )
