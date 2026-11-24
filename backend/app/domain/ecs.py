"""Evidence Confidence Score (PRD 12.3).

ECS = E + C + D + P + V, on a 0 to 100 scale. It is fully deterministic and every
component is displayed with its contribution, because a number a decision-maker cannot
take apart is a number they cannot argue with.

The bands inform the approver. They do not decide.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from app.domain.states import EvidenceStatus

BAND_STRONG = "Strong"
BAND_MODERATE = "Moderate"
BAND_WEAK = "Weak"

BAND_GUIDANCE: dict[str, str] = {
    BAND_STRONG: (
        "Strong evidence. The measured improvement is close to what was promised and the "
        "result is unlikely to be chance. Scaling may be considered on this evidence."
    ),
    BAND_MODERATE: (
        "Moderate evidence. The result points the right way but is not firm enough to "
        "justify a full rollout. Extend the pilot, or scale in limited areas with continued "
        "measurement."
    ),
    BAND_WEAK: (
        "Weak evidence. Do not scale on this evidence alone. The gaps shown in the "
        "components below explain what would have to change."
    ),
}


@dataclass
class ScoreComponent:
    code: str
    name: str
    points: float
    max_points: float
    explanation: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EcsInput:
    observed_effect: float
    target_effect: float
    direction: str
    excludes_zero_95: bool
    excludes_zero_90: bool
    planned_unit_periods: int
    received_unit_periods: int
    rejected_or_disputed_rows: int
    total_rows: int
    approved_amendments: int
    unapproved_deviations: int
    validation_status: str


@dataclass
class EcsResult:
    score: float
    band: str
    band_guidance: str
    components: list[dict[str, Any]]
    issued: bool
    message: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _effect_attainment(data: EcsInput) -> ScoreComponent:
    """30 times the ratio of observed effect to the pre-registered target, clipped to 0 and 1."""
    target = abs(data.target_effect)
    observed = data.observed_effect
    beneficial = -observed if data.direction == "lower" else observed
    ratio = 0.0 if target <= 0 else max(0.0, min(1.0, beneficial / target))
    points = round(30.0 * ratio, 2)
    if target <= 0:
        explanation = "No target improvement was pre-registered, so no points can be awarded here."
    elif beneficial <= 0:
        explanation = (
            "The measure did not move in the intended direction, so this component scores zero."
        )
    else:
        explanation = (
            "The pilot delivered "
            + str(round(ratio * 100))
            + " percent of the improvement that was pre-registered as the target."
        )
    return ScoreComponent("E", "Effect attainment", points, 30.0, explanation)


def _statistical_confidence(data: EcsInput) -> ScoreComponent:
    if data.excludes_zero_95:
        return ScoreComponent(
            "C",
            "Statistical confidence",
            25.0,
            25.0,
            "The 95 percent confidence interval lies entirely on the beneficial side of no "
            "change, so a result this size is unlikely to be chance.",
        )
    if data.excludes_zero_90:
        return ScoreComponent(
            "C",
            "Statistical confidence",
            12.0,
            25.0,
            "The 90 percent confidence interval excludes no change but the 95 percent interval "
            "does not. The direction is probable but not firm.",
        )
    return ScoreComponent(
        "C",
        "Statistical confidence",
        0.0,
        25.0,
        "The confidence interval includes no change, so this pilot cannot rule out that the "
        "measured difference is chance variation.",
    )


def _data_quality(data: EcsInput) -> ScoreComponent:
    planned = max(1, data.planned_unit_periods)
    completeness = max(0.0, min(1.0, data.received_unit_periods / planned))
    total = max(1, data.total_rows)
    clean_share = max(0.0, 1.0 - data.rejected_or_disputed_rows / total)
    points = round(20.0 * completeness * clean_share, 2)
    return ScoreComponent(
        "D",
        "Data quality",
        points,
        20.0,
        str(round(completeness * 100))
        + " percent of the planned measurements were received, and "
        + str(round(clean_share * 100))
        + " percent of submitted rows were accepted without dispute.",
    )


def _protocol_adherence(data: EcsInput) -> ScoreComponent:
    points = 15.0 - 2.0 * data.approved_amendments - 5.0 * data.unapproved_deviations
    points = round(max(0.0, points), 2)
    if data.approved_amendments == 0 and data.unapproved_deviations == 0:
        explanation = "The pilot ran exactly as pre-registered, with no amendments or deviations."
    else:
        explanation = (
            str(data.approved_amendments)
            + " approved amendment(s) and "
            + str(data.unapproved_deviations)
            + " unapproved deviation(s) from the pre-registered plan were recorded."
        )
    return ScoreComponent("P", "Protocol adherence", points, 15.0, explanation)


def _independent_validation(data: EcsInput) -> ScoreComponent:
    if data.validation_status == EvidenceStatus.SIGNED_OFF:
        return ScoreComponent(
            "V",
            "Independent validation",
            10.0,
            10.0,
            "An independent validator with no stake in the pilot signed off without qualification.",
        )
    if data.validation_status == EvidenceStatus.SIGNED_OFF_WITH_QUALIFICATIONS:
        return ScoreComponent(
            "V",
            "Independent validation",
            5.0,
            10.0,
            "The independent validator signed off with written qualifications. Read the remarks "
            "before relying on this result.",
        )
    return ScoreComponent(
        "V",
        "Independent validation",
        0.0,
        10.0,
        "Independent validation is not yet complete. The score below is provisional until a "
        "validator signs off.",
    )


def band_for(score: float) -> str:
    if score >= 80.0:
        return BAND_STRONG
    if score >= 60.0:
        return BAND_MODERATE
    return BAND_WEAK


def compute(data: EcsInput) -> EcsResult:
    """Compute the score. A refused validation means no score is issued at all."""
    if data.validation_status == EvidenceStatus.REFUSED:
        return EcsResult(
            score=0.0,
            band=BAND_WEAK,
            band_guidance=(
                "The independent validator refused to sign off on this pilot, so no Evidence "
                "Confidence Score is issued and no scale decision can be recorded on it."
            ),
            components=[],
            issued=False,
            message="No score issued: independent validation was refused.",
        )

    components = [
        _effect_attainment(data),
        _statistical_confidence(data),
        _data_quality(data),
        _protocol_adherence(data),
        _independent_validation(data),
    ]
    score = round(sum(c.points for c in components), 2)
    score = max(0.0, min(100.0, score))
    band = band_for(score)
    provisional = data.validation_status not in (
        EvidenceStatus.SIGNED_OFF,
        EvidenceStatus.SIGNED_OFF_WITH_QUALIFICATIONS,
    )
    message = (
        "Provisional score pending independent validation."
        if provisional
        else "Final score. Independent validation is complete."
    )
    return EcsResult(
        score=score,
        band=band,
        band_guidance=BAND_GUIDANCE[band],
        components=[c.to_dict() for c in components],
        issued=not provisional,
        message=message,
    )
