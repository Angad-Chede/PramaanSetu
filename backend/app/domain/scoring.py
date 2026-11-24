"""Weighted evaluation aggregation and variance flags (PRD 5.5, FR-EV-04)."""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Any

VARIANCE_THRESHOLD = 1.5
SCORE_MIN = 1
SCORE_MAX = 5


@dataclass
class CriterionScores:
    criterion_id: str
    name: str
    weight: int
    scores: list[float] = field(default_factory=list)

    @property
    def mean(self) -> float:
        return round(statistics.fmean(self.scores), 3) if self.scores else 0.0

    @property
    def stdev(self) -> float:
        return round(statistics.pstdev(self.scores), 3) if len(self.scores) > 1 else 0.0

    @property
    def spread(self) -> float:
        return round(max(self.scores) - min(self.scores), 3) if self.scores else 0.0

    @property
    def flagged(self) -> bool:
        """Evaluator scores differing by more than 1.5 points on a criterion (FR-EV-04)."""
        return self.spread > VARIANCE_THRESHOLD


@dataclass
class ApplicationScore:
    application_id: str
    weighted_score: float
    mean_score: float
    stdev: float
    disagreement: float
    evaluator_count: int
    criteria: list[dict[str, Any]]
    flags: list[str]
    complete: bool


def aggregate_application(
    application_id: str,
    criteria: list[tuple[str, str, int]],
    scores: list[tuple[str, str, float]],
    expected_evaluators: int,
) -> ApplicationScore:
    """Aggregate one application.

    criteria is (criterion_id, name, weight); scores is (criterion_id, evaluator_id, score).
    The weighted score is on a 0 to 100 scale: each criterion contributes its weight times
    the mean score normalised from the 1 to 5 anchored scale.
    """
    buckets: dict[str, CriterionScores] = {
        cid: CriterionScores(cid, name, weight) for cid, name, weight in criteria
    }
    evaluators: set[str] = set()
    for criterion_id, evaluator_id, value in scores:
        evaluators.add(evaluator_id)
        if criterion_id in buckets:
            buckets[criterion_id].scores.append(float(value))

    total_weight = sum(weight for _, _, weight in criteria) or 100
    weighted = 0.0
    rows: list[dict[str, Any]] = []
    flags: list[str] = []
    all_means: list[float] = []

    for cid, _name, _weight in criteria:
        bucket = buckets[cid]
        normalised = (bucket.mean - SCORE_MIN) / (SCORE_MAX - SCORE_MIN) if bucket.scores else 0.0
        contribution = normalised * bucket.weight
        weighted += contribution
        if bucket.scores:
            all_means.append(bucket.mean)
        if bucket.flagged:
            flags.append(
                "Evaluators differ by "
                + str(bucket.spread)
                + " points on "
                + bucket.name
                + ". Review the written justifications before the shortlist is confirmed."
            )
        rows.append(
            {
                "criterion_id": cid,
                "name": bucket.name,
                "weight": bucket.weight,
                "mean": bucket.mean,
                "stdev": bucket.stdev,
                "spread": bucket.spread,
                "flagged": bucket.flagged,
                "contribution": round(contribution, 3),
                "scores_received": len(bucket.scores),
            }
        )

    scale = 100.0 / total_weight if total_weight else 1.0
    complete = len(evaluators) >= expected_evaluators and all(
        len(buckets[cid].scores) >= expected_evaluators for cid, _, _ in criteria
    )
    if not complete:
        flags.append(
            "Scoring is incomplete: "
            + str(len(evaluators))
            + " of "
            + str(expected_evaluators)
            + " evaluators have submitted."
        )

    # Disagreement is the average spread between evaluators within a criterion. It is
    # the meaningful signal when two applications score the same: a score built from
    # agreement is worth more than the same score built from a split panel.
    spreads = [buckets[cid].spread for cid, _n, _w in criteria if buckets[cid].scores]
    disagreement = round(statistics.fmean(spreads), 3) if spreads else 0.0

    return ApplicationScore(
        application_id=application_id,
        weighted_score=round(weighted * scale, 2),
        mean_score=round(statistics.fmean(all_means), 3) if all_means else 0.0,
        stdev=round(statistics.pstdev(all_means), 3) if len(all_means) > 1 else 0.0,
        disagreement=disagreement,
        evaluator_count=len(evaluators),
        criteria=rows,
        flags=flags,
        complete=complete,
    )


def rank(applications: list[ApplicationScore]) -> list[dict[str, Any]]:
    """Rank by weighted score, ties broken by the lower disagreement between evaluators."""
    ordered = sorted(
        applications,
        key=lambda a: (-a.weighted_score, a.disagreement, a.stdev, a.application_id),
    )
    out: list[dict[str, Any]] = []
    for position, item in enumerate(ordered, start=1):
        out.append(
            {
                "rank": position,
                "application_id": item.application_id,
                "weighted_score": item.weighted_score,
                "mean_score": item.mean_score,
                "stdev": item.stdev,
                "disagreement": item.disagreement,
                "evaluator_count": item.evaluator_count,
                "flags": item.flags,
                "complete": item.complete,
                "criteria": item.criteria,
            }
        )
    return out


def validate_score(value: int) -> None:
    from app.core.errors import ValidationFailed

    if value < SCORE_MIN or value > SCORE_MAX:
        raise ValidationFailed(
            "Scores use the anchored scale from 1 to 5.",
            errors=[
                {
                    "field": "score",
                    "detail": "The value " + str(value) + " is outside the scale.",
                    "fix": "Choose a whole number between 1 and 5 and read the anchor text for it.",
                }
            ],
        )


def blind_label(index: int) -> str:
    """Round one hides the applicant identity behind a stable label (FR-EV-02)."""
    return "Applicant " + chr(ord("A") + index % 26) + (str(index // 26) if index >= 26 else "")
