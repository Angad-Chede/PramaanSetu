"""Procurement pathway recommender, Scale Simulator and Vendor Dependency Score.

PRD 5.11 and 12.6. Every rule input is shown alongside the recommendation, and every
output repeats that the final choice rests with the competent authority. These rules
support, and do not replace, the judgement of the department's legal and finance advisers.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np

from app.core.money import format_inr

# Value thresholds in paise, from the General Financial Rules, 2017. These are
# configuration in a real deployment, so a revision of the rules does not need a release.
#
#   Rule 149  direct purchase on the marketplace, up to 5 lakh with three-seller comparison
#   Rule 161  advertised tender enquiry above 25 lakh
#   Rule 162  limited tender enquiry up to 25 lakh
#   Rule 166  single tender enquiry on proprietary or sole-source grounds, any value
GEM_DIRECT_CEILING_PAISE = 5_00_000 * 100
LIMITED_TENDER_CEILING_PAISE = 25_00_000 * 100


@dataclass
class PathwayInput:
    estimated_value_paise: int
    available_on_gem: bool
    qualified_vendor_count: int
    is_proprietary: bool
    evidence_band: str
    confidence_score: float
    department_level: str = "state"


@dataclass
class PathwayOption:
    code: str
    name: str
    rationale: str
    conditions: list[str]
    reference: str


@dataclass
class PathwayRecommendation:
    recommended: dict[str, Any]
    alternatives: list[dict[str, Any]]
    rule_inputs: dict[str, Any]
    caveat: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


CAVEAT = (
    "This recommendation is generated from the rule inputs shown above. The final choice "
    "of procurement route rests with the competent authority, advised by the department's "
    "legal and finance cells."
)


def recommend_pathway(data: PathwayInput) -> PathwayRecommendation:
    """Suggest a compliant route from value, availability and competition (FR-SC-01)."""
    options: list[PathwayOption] = []

    if data.available_on_gem and data.estimated_value_paise <= GEM_DIRECT_CEILING_PAISE:
        options.append(
            PathwayOption(
                code="gem_direct",
                name="Direct purchase on the Government e-Marketplace",
                rationale=(
                    "The product is listed on the marketplace and the estimated value of "
                    + format_inr(data.estimated_value_paise)
                    + " is within the direct purchase ceiling."
                ),
                conditions=[
                    "Confirm the listed specification matches the validated pilot configuration.",
                    "Record the Evidence Report reference on the purchase file.",
                ],
                reference="General Financial Rules, 2017 Rule 149",
            )
        )

    if data.available_on_gem and data.qualified_vendor_count >= 3:
        options.append(
            PathwayOption(
                code="gem_bid",
                name="Bid on the Government e-Marketplace",
                rationale=(
                    "At least three qualified vendors are available for this category, so a "
                    "competitive bid on the marketplace is open to the department."
                ),
                conditions=[
                    "Use the validated pilot specification as the technical requirement.",
                    "Publish the Evidence Report summary with the bid documents.",
                ],
                reference="General Financial Rules, 2017 Rule 149 read with Rule 161",
            )
        )

    if data.estimated_value_paise <= LIMITED_TENDER_CEILING_PAISE and data.qualified_vendor_count >= 2:
        options.append(
            PathwayOption(
                code="limited_tender",
                name="Limited tender enquiry",
                rationale=(
                    "The estimated value of "
                    + format_inr(data.estimated_value_paise)
                    + " is within the limited tender ceiling and more than one qualified "
                    "vendor exists."
                ),
                conditions=[
                    "Invite every vendor on the department panel for this category.",
                    "Record the reason for limiting the enquiry on file.",
                ],
                reference="General Financial Rules, 2017 Rule 162",
            )
        )

    if data.qualified_vendor_count <= 1 or data.is_proprietary:
        options.append(
            PathwayOption(
                code="single_source",
                name="Single tender enquiry on proprietary or sole-source grounds",
                rationale=(
                    "Only "
                    + str(max(data.qualified_vendor_count, 1))
                    + " qualified vendor is available"
                    + (" and the solution is proprietary." if data.is_proprietary else ".")
                ),
                conditions=[
                    "Record a proprietary article certificate signed by the competent authority.",
                    "Attach the Vendor Dependency Score and the exit plan to the file.",
                    "Obtain the approval required for single tender enquiry at this value.",
                ],
                reference="General Financial Rules, 2017 Rule 166",
            )
        )

    options.append(
        PathwayOption(
            code="open_challenge",
            name="Open challenge-based procurement",
            rationale=(
                "An open, outcome-based competition keeps the route contestable and lets "
                "other startups meet the same validated specification."
            ),
            conditions=[
                "Publish the validated outcome specification, not a product name.",
                "Keep the relaxation of prior turnover and experience criteria for recognised startups.",
            ],
            reference="General Financial Rules, 2017 Rule 161 read with Rule 173(i)",
        )
    )

    # Weak evidence never recommends a committing route.
    if data.evidence_band == "Weak":
        options = [o for o in options if o.code in ("open_challenge",)] or options
        recommended = options[0]
        recommended = PathwayOption(
            code="no_scale",
            name="Do not proceed to scale procurement on this evidence",
            rationale=(
                "The Evidence Confidence Score of "
                + str(round(data.confidence_score))
                + " falls in the weak band. Extending the pilot or repeating it with a stronger "
                "design costs far less than a rollout that cannot be defended."
            ),
            conditions=["Record the reasons and the gaps identified in the Evidence Report."],
            reference="General Financial Rules, 2017 Rule 21 on prudence in public expenditure",
        )
        return PathwayRecommendation(
            recommended=asdict(recommended),
            alternatives=[asdict(o) for o in options],
            rule_inputs=asdict(data),
            caveat=CAVEAT,
        )

    recommended = options[0]
    return PathwayRecommendation(
        recommended=asdict(recommended),
        alternatives=[asdict(o) for o in options[1:]],
        rule_inputs=asdict(data),
        caveat=CAVEAT,
    )


@dataclass
class ScaleProjection:
    units: int
    cost_per_unit_paise: int
    total_cost_paise: int
    benefit_low: float
    benefit_expected: float
    benefit_high: float
    benefit_unit: str
    monetised_low_paise: int | None
    monetised_expected_paise: int | None
    monetised_high_paise: int | None
    payback_months: float | None
    assumptions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def project_scale(
    *,
    units: int,
    cost_per_unit_paise: int,
    effect_low: float,
    effect_expected: float,
    effect_high: float,
    benefit_unit: str,
    value_per_effect_unit_paise: int = 0,
    baseline_per_unit: float = 0.0,
    annual_operating_cost_paise: int = 0,
) -> ScaleProjection:
    """Rollout cost and benefit at the low, expected and high ends of the interval.

    Using the confidence interval rather than the point estimate is deliberate: a single
    optimistic number is how rollouts overrun (FR-SC-02).
    """
    total_cost = int(units * cost_per_unit_paise + annual_operating_cost_paise)

    def monetise(effect: float) -> int | None:
        if value_per_effect_unit_paise <= 0:
            return None
        return int(abs(effect) * units * value_per_effect_unit_paise)

    low = monetise(effect_low)
    expected = monetise(effect_expected)
    high = monetise(effect_high)

    payback = None
    if expected and expected > 0:
        monthly = expected / 12.0
        if monthly > 0:
            payback = round(total_cost / monthly, 1)

    return ScaleProjection(
        units=units,
        cost_per_unit_paise=cost_per_unit_paise,
        total_cost_paise=total_cost,
        benefit_low=round(abs(effect_low) * units, 3),
        benefit_expected=round(abs(effect_expected) * units, 3),
        benefit_high=round(abs(effect_high) * units, 3),
        benefit_unit=benefit_unit,
        monetised_low_paise=low,
        monetised_expected_paise=expected,
        monetised_high_paise=high,
        payback_months=payback,
        assumptions=[
            "The low case uses the conservative end of the validated confidence interval, "
            "the high case the optimistic end.",
            "Benefit is assumed to hold at the same per-unit level after rollout; sites that "
            "differ materially from the pilot context should be treated separately.",
            "Baseline per unit taken as " + str(baseline_per_unit) + " " + benefit_unit + ".",
        ],
    )


VDS_WEIGHTS: dict[str, tuple[int, str, str]] = {
    "proprietary_formats": (
        30,
        "Data is held in a proprietary format",
        "Require an export in an open format as a contractual deliverable.",
    ),
    "no_documented_export": (
        25,
        "No documented export path for departmental data",
        "Require a documented, tested export procedure before payment of the final milestone.",
    ),
    "single_vendor": (
        25,
        "Only one vendor is available on the marketplace for this category",
        "Keep the specification outcome-based so other vendors can qualify later.",
    ),
    "missing_exit_plan": (
        20,
        "No exit plan on record",
        "Complete the exit plan template before the scale decision is approved.",
    ),
}


@dataclass
class VendorDependency:
    score: int
    level: str
    factors: list[dict[str, Any]]
    exit_plan_required: bool
    message: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def vendor_dependency_score(flags: dict[str, bool]) -> VendorDependency:
    """Higher means more dependency. Above 60 an exit plan is required (FR-SC-03)."""
    score = 0
    factors: list[dict[str, Any]] = []
    for code, (weight, label, mitigation) in VDS_WEIGHTS.items():
        present = bool(flags.get(code))
        if present:
            score += weight
        factors.append(
            {
                "code": code,
                "label": label,
                "weight": weight,
                "present": present,
                "mitigation": mitigation if present else "",
            }
        )
    score = int(min(100, score))
    level = "High" if score > 60 else ("Moderate" if score > 30 else "Low")
    message = (
        "Dependency is high. An exit plan must be on record before the scale decision is approved."
        if score > 60
        else "Dependency is within the range the department can manage with the standard exit clause."
    )
    return VendorDependency(
        score=score,
        level=level,
        factors=factors,
        exit_plan_required=score > 60,
        message=message,
    )


def context_fit(original: dict[str, Any], adopting: dict[str, Any]) -> list[dict[str, Any]]:
    """Highlight the differences an officer must judge before reusing a passport (FR-IP-04)."""
    checks = [
        ("scale_units", "Number of units", "Compare the size of the deployment."),
        ("population", "Population served", "A much larger population changes load and support needs."),
        ("environment", "Operating environment", "Terrain, climate and network conditions change results."),
        ("state_code", "State", "State rules and vendor availability differ."),
        ("sector", "Sector", "A different sector may change the measurement method."),
    ]
    rows: list[dict[str, Any]] = []
    for key, label, note in checks:
        a, b = original.get(key), adopting.get(key)
        if a is None and b is None:
            continue
        same = str(a) == str(b)
        if not same and isinstance(a, int | float) and isinstance(b, int | float) and a:
            ratio = float(b) / float(a)
            same = 0.5 <= ratio <= 2.0
            note = (
                note
                + " The adopting context is "
                + str(round(ratio, 2))
                + " times the original."
            )
        rows.append(
            {
                "key": key,
                "label": label,
                "original": a,
                "adopting": b,
                "comparable": same,
                "note": "" if same else note,
            }
        )
    return rows


def effect_bounds(ci_low: float, ci_high: float, point: float) -> tuple[float, float, float]:
    """Order the interval so the conservative end is always first, whatever the sign."""
    low, high = (ci_low, ci_high) if ci_low <= ci_high else (ci_high, ci_low)
    conservative = min(abs(low), abs(high)) * np.sign(point if point else 1.0)
    optimistic = max(abs(low), abs(high)) * np.sign(point if point else 1.0)
    return (float(conservative), float(point), float(optimistic))
