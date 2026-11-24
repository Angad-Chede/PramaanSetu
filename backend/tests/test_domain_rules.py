"""Eligibility, scoring, Evidence Confidence Score, pathway, matching and money rules."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.core.money import format_inr, paise_to_rupees, rupees_to_paise, split_evenly
from app.domain.ecs import BAND_MODERATE, BAND_STRONG, BAND_WEAK, EcsInput, band_for, compute
from app.domain.eligibility import RELAXATION_CITATION, ScreeningInput, screen
from app.domain.matching import MatchCandidate, cosine, keyword_rank, rank_candidates
from app.domain.pathway import (
    PathwayInput,
    context_fit,
    effect_bounds,
    project_scale,
    recommend_pathway,
    vendor_dependency_score,
)
from app.domain.scoring import aggregate_application, rank
from app.domain.states import DpiitStatus, EligibilityOutcome, EvidenceStatus


def _screening(**overrides) -> ScreeningInput:
    base = {
        "dpiit_status": str(DpiitStatus.VERIFIED),
        "sectors": ["Water"],
        "state_code": "MH",
        "district": "Pune",
        "annual_turnover_paise": 0,
        "years_of_experience": 1,
        "pilot_cost_paise": 30_00_000 * 100,
        "conflict_declaration": True,
        "ip_declaration": "startup_retains",
        "data_declaration": "Zone level data, stored in India, deleted after the pilot.",
        "kpi_commitment_count": 3,
        "challenge_sector": "Water",
        "challenge_state_code": "MH",
        "challenge_district": "Pune",
        "location_required": False,
        "budget_ceiling_paise": 45_00_000 * 100,
        "required_kpi_count": 3,
        "rules": {"min_turnover_paise": 50_00_000 * 100, "min_experience_years": 3},
    }
    base.update(overrides)
    return ScreeningInput(**base)


# --- Eligibility -----------------------------------------------------------


def test_recognised_startup_gets_turnover_and_experience_relaxation():
    outcome = screen(_screening())
    assert outcome.outcome == EligibilityOutcome.ELIGIBLE
    codes = {r["rule"] for r in outcome.relaxations_applied}
    assert codes == {"turnover", "experience"}
    assert all(r["citation"] == RELAXATION_CITATION for r in outcome.relaxations_applied)
    assert "relaxation applied" in outcome.summary


def test_unrecognised_startup_below_thresholds_is_ineligible_with_reasons():
    outcome = screen(_screening(dpiit_status=str(DpiitStatus.NOT_FOUND)))
    assert outcome.outcome == EligibilityOutcome.INELIGIBLE
    failing = [r for r in outcome.rule_results if not r["passed"] and r["blocking"]]
    assert {r["code"] for r in failing} >= {"dpiit", "turnover", "experience"}
    for rule in failing:
        assert rule["reason"]
        assert rule["fix"]


def test_pending_recognition_needs_review_rather_than_rejection():
    outcome = screen(_screening(dpiit_status=str(DpiitStatus.PENDING), rules={}))
    assert outcome.outcome == EligibilityOutcome.NEEDS_REVIEW


def test_quality_criteria_are_never_relaxed():
    """Relaxation touches turnover and experience only; everything else still applies."""
    outcome = screen(_screening(pilot_cost_paise=90_00_000 * 100))
    assert outcome.outcome == EligibilityOutcome.INELIGIBLE
    budget = next(r for r in outcome.rule_results if r["code"] == "budget")
    assert not budget["passed"]
    assert not budget["relaxed"]


def test_missing_declarations_block_eligibility():
    outcome = screen(_screening(conflict_declaration=False, ip_declaration=""))
    declarations = next(r for r in outcome.rule_results if r["code"] == "declarations")
    assert not declarations["passed"]
    assert "conflict of interest declaration" in declarations["reason"]


def test_location_restriction_is_applied_only_when_required():
    inside = screen(_screening(location_required=True))
    assert inside.outcome == EligibilityOutcome.ELIGIBLE
    outside = screen(_screening(location_required=True, state_code="KA"))
    assert outside.outcome == EligibilityOutcome.INELIGIBLE


def test_sector_mismatch_is_blocking_and_explains_the_fix():
    outcome = screen(_screening(sectors=["Energy"]))
    sector = next(r for r in outcome.rule_results if r["code"] == "sector")
    assert not sector["passed"]
    assert "Add the sector" in sector["fix"]


def test_missing_commitments_are_counted_precisely():
    outcome = screen(_screening(kpi_commitment_count=1, required_kpi_count=3))
    commitments = next(r for r in outcome.rule_results if r["code"] == "commitments")
    assert "2 of the 3" in commitments["reason"]


# --- Evaluation scoring ----------------------------------------------------


CRITERIA = [("c1", "Fit", 40), ("c2", "Technical", 35), ("c3", "Value", 25)]


def test_weighted_score_is_on_a_zero_to_hundred_scale():
    scores = [(cid, "e" + str(i), 5.0) for cid, _n, _w in CRITERIA for i in range(3)]
    result = aggregate_application("a1", CRITERIA, scores, expected_evaluators=3)
    assert result.weighted_score == 100.0
    assert result.complete

    lowest = [(cid, "e" + str(i), 1.0) for cid, _n, _w in CRITERIA for i in range(3)]
    result = aggregate_application("a1", CRITERIA, lowest, expected_evaluators=3)
    assert result.weighted_score == 0.0


def test_variance_above_one_and_a_half_points_is_flagged():
    scores = [
        ("c1", "e1", 2.0), ("c1", "e2", 4.0), ("c1", "e3", 5.0),
        ("c2", "e1", 3.0), ("c2", "e2", 3.0), ("c2", "e3", 3.0),
        ("c3", "e1", 4.0), ("c3", "e2", 4.0), ("c3", "e3", 4.0),
    ]
    result = aggregate_application("a1", CRITERIA, scores, expected_evaluators=3)
    flagged = [c for c in result.criteria if c["flagged"]]
    assert len(flagged) == 1
    assert flagged[0]["criterion_id"] == "c1"
    assert any("differ by" in f for f in result.flags)


def test_incomplete_scoring_is_reported_not_silently_averaged():
    scores = [(cid, "e1", 4.0) for cid, _n, _w in CRITERIA]
    result = aggregate_application("a1", CRITERIA, scores, expected_evaluators=3)
    assert not result.complete
    assert any("incomplete" in f for f in result.flags)


def test_ranking_breaks_ties_on_lower_disagreement():
    """Two applications with the same weighted score: the one the panel agreed on wins."""
    high_spread = aggregate_application(
        "a1", CRITERIA,
        [("c1", "e1", 1.0), ("c1", "e2", 5.0), ("c2", "e1", 3.0), ("c2", "e2", 3.0),
         ("c3", "e1", 3.0), ("c3", "e2", 3.0)],
        expected_evaluators=2,
    )
    low_spread = aggregate_application(
        "a2", CRITERIA,
        [("c1", "e1", 3.0), ("c1", "e2", 3.0), ("c2", "e1", 3.0), ("c2", "e2", 3.0),
         ("c3", "e1", 3.0), ("c3", "e2", 3.0)],
        expected_evaluators=2,
    )
    assert high_spread.weighted_score == low_spread.weighted_score
    assert high_spread.disagreement > low_spread.disagreement
    ordered = rank([high_spread, low_spread])
    assert ordered[0]["application_id"] == "a2"


# --- Evidence Confidence Score ---------------------------------------------


def _ecs(**overrides) -> EcsInput:
    base = {
        "observed_effect": -8.0,
        "target_effect": -8.0,
        "direction": "lower",
        "excludes_zero_95": True,
        "excludes_zero_90": True,
        "planned_unit_periods": 100,
        "received_unit_periods": 100,
        "rejected_or_disputed_rows": 0,
        "total_rows": 100,
        "approved_amendments": 0,
        "unapproved_deviations": 0,
        "validation_status": str(EvidenceStatus.SIGNED_OFF),
    }
    base.update(overrides)
    return EcsInput(**base)


def test_perfect_pilot_scores_one_hundred():
    result = compute(_ecs())
    assert result.score == 100.0
    assert result.band == BAND_STRONG
    assert result.issued
    assert sum(c["points"] for c in result.components) == 100.0


def test_each_component_contributes_its_documented_maximum():
    result = compute(_ecs())
    maxima = {c["code"]: c["max_points"] for c in result.components}
    assert maxima == {"E": 30.0, "C": 25.0, "D": 20.0, "P": 15.0, "V": 10.0}


def test_half_the_promised_effect_scores_half_the_attainment_points():
    result = compute(_ecs(observed_effect=-4.0))
    attainment = next(c for c in result.components if c["code"] == "E")
    assert attainment["points"] == 15.0


def test_wrong_direction_scores_zero_attainment():
    result = compute(_ecs(observed_effect=3.0))
    attainment = next(c for c in result.components if c["code"] == "E")
    assert attainment["points"] == 0.0
    assert "did not move in the intended direction" in attainment["explanation"]


def test_only_the_ninety_percent_interval_scores_twelve():
    result = compute(_ecs(excludes_zero_95=False))
    confidence = next(c for c in result.components if c["code"] == "C")
    assert confidence["points"] == 12.0


def test_data_quality_falls_with_completeness_and_disputes():
    result = compute(_ecs(received_unit_periods=50, rejected_or_disputed_rows=10))
    quality = next(c for c in result.components if c["code"] == "D")
    assert quality["points"] == 9.0


def test_protocol_adherence_is_docked_per_amendment_and_deviation():
    result = compute(_ecs(approved_amendments=2, unapproved_deviations=1))
    protocol = next(c for c in result.components if c["code"] == "P")
    assert protocol["points"] == 6.0
    floor = compute(_ecs(unapproved_deviations=10))
    assert next(c for c in floor.components if c["code"] == "P")["points"] == 0.0


def test_qualified_sign_off_scores_five_for_validation():
    result = compute(_ecs(validation_status=str(EvidenceStatus.SIGNED_OFF_WITH_QUALIFICATIONS)))
    validation = next(c for c in result.components if c["code"] == "V")
    assert validation["points"] == 5.0


def test_refused_validation_issues_no_score_at_all():
    result = compute(_ecs(validation_status=str(EvidenceStatus.REFUSED)))
    assert not result.issued
    assert result.components == []
    assert "refused" in result.band_guidance


def test_provisional_score_before_validation_is_flagged():
    result = compute(_ecs(validation_status=str(EvidenceStatus.AWAITING_VALIDATION)))
    assert not result.issued
    assert "Provisional" in result.message


def test_bands_follow_the_documented_thresholds():
    assert band_for(80.0) == BAND_STRONG
    assert band_for(79.99) == BAND_MODERATE
    assert band_for(60.0) == BAND_MODERATE
    assert band_for(59.99) == BAND_WEAK


@given(
    observed=st.floats(-100, 100, allow_nan=False),
    target=st.floats(-100, 100, allow_nan=False),
    received=st.integers(0, 500),
    planned=st.integers(1, 500),
    rejected=st.integers(0, 200),
    total=st.integers(1, 200),
    amendments=st.integers(0, 10),
    deviations=st.integers(0, 10),
)
def test_score_is_always_within_zero_and_one_hundred(
    observed, target, received, planned, rejected, total, amendments, deviations
):
    result = compute(
        _ecs(
            observed_effect=observed,
            target_effect=target,
            received_unit_periods=received,
            planned_unit_periods=planned,
            rejected_or_disputed_rows=rejected,
            total_rows=total,
            approved_amendments=amendments,
            unapproved_deviations=deviations,
        )
    )
    assert 0.0 <= result.score <= 100.0
    assert result.band in (BAND_STRONG, BAND_MODERATE, BAND_WEAK)


# --- Pathway, scale projection and vendor dependency -----------------------


def test_weak_evidence_never_recommends_a_committing_route():
    recommendation = recommend_pathway(
        PathwayInput(
            estimated_value_paise=10_00_000 * 100,
            available_on_gem=True,
            qualified_vendor_count=5,
            is_proprietary=False,
            evidence_band="Weak",
            confidence_score=42.0,
        )
    )
    assert recommendation.recommended["code"] == "no_scale"
    assert "weak band" in recommendation.recommended["rationale"]


def test_listed_product_within_the_ceiling_recommends_direct_purchase():
    recommendation = recommend_pathway(
        PathwayInput(
            estimated_value_paise=4_00_000 * 100,
            available_on_gem=True,
            qualified_vendor_count=4,
            is_proprietary=False,
            evidence_band="Strong",
            confidence_score=88.0,
        )
    )
    assert recommendation.recommended["code"] == "gem_direct"
    assert recommendation.recommended["reference"].startswith("General Financial Rules")
    assert "competent authority" in recommendation.caveat


def test_sole_source_route_carries_its_conditions():
    recommendation = recommend_pathway(
        PathwayInput(
            estimated_value_paise=3_00_00_000 * 100,
            available_on_gem=False,
            qualified_vendor_count=1,
            is_proprietary=True,
            evidence_band="Strong",
            confidence_score=85.0,
        )
    )
    assert recommendation.recommended["code"] == "single_source"
    assert any("proprietary article certificate" in c for c in recommendation.recommended["conditions"])


def test_scale_projection_uses_the_whole_interval():
    projection = project_scale(
        units=100,
        cost_per_unit_paise=100000,
        effect_low=-2.0,
        effect_expected=-5.0,
        effect_high=-8.0,
        benefit_unit="percentage points",
        value_per_effect_unit_paise=50000,
    )
    assert projection.benefit_low < projection.benefit_expected < projection.benefit_high
    assert projection.total_cost_paise == 100 * 100000
    assert projection.monetised_expected_paise == int(5.0 * 100 * 50000)
    assert projection.assumptions


def test_effect_bounds_order_the_interval_conservatively():
    low, point, high = effect_bounds(-9.0, -3.0, -6.0)
    assert abs(low) < abs(high)
    assert point == -6.0


def test_vendor_dependency_above_sixty_requires_an_exit_plan():
    result = vendor_dependency_score(
        {
            "proprietary_formats": True,
            "no_documented_export": True,
            "single_vendor": True,
            "missing_exit_plan": False,
        }
    )
    assert result.score == 80
    assert result.level == "High"
    assert result.exit_plan_required
    present = [f for f in result.factors if f["present"]]
    assert all(f["mitigation"] for f in present)


def test_vendor_dependency_of_zero_is_low():
    result = vendor_dependency_score({})
    assert result.score == 0
    assert result.level == "Low"
    assert not result.exit_plan_required


def test_context_fit_flags_a_much_larger_deployment():
    rows = context_fit(
        {"scale_units": 24, "state_code": "MH", "sector": "Water"},
        {"scale_units": 400, "state_code": "RJ", "sector": "Water"},
    )
    by_key = {r["key"]: r for r in rows}
    assert not by_key["scale_units"]["comparable"]
    assert not by_key["state_code"]["comparable"]
    assert by_key["sector"]["comparable"]


# --- Matching --------------------------------------------------------------


def test_cosine_of_identical_vectors_is_one():
    assert cosine([1.0, 0.0, 1.0], [1.0, 0.0, 1.0]) == pytest.approx(1.0)
    assert cosine([1.0, 0.0], [0.0, 1.0]) == 0.0
    assert cosine([], [1.0]) == 0.0


def test_keyword_rank_returns_the_shared_terms():
    score, terms = keyword_rank(
        "reduce water leakage using acoustic sensors in the district metering area",
        "acoustic sensors for leakage detection across district metering areas",
    )
    assert score > 0
    assert "acoustic" in terms or "leakage" in terms


def test_ranking_prefers_sector_and_capability_matches():
    candidates = [
        MatchCandidate(
            startup_id="s1", legal_name="Leak detection company", sectors=["Water"],
            state_code="MH", district="Pune",
            capability_text="acoustic leak detection sensors for district metering areas",
            embedding=[1.0, 0.0, 0.0],
        ),
        MatchCandidate(
            startup_id="s2", legal_name="Unrelated company", sectors=["Education"],
            state_code="KA", district="Bengaluru",
            capability_text="classroom learning assessment application",
            embedding=[0.0, 1.0, 0.0],
        ),
    ]
    ranked = rank_candidates(
        challenge_text="reduce water leakage in district metering areas with acoustic sensors",
        challenge_sector="Water",
        challenge_state_code="MH",
        challenge_district="Pune",
        challenge_embedding=[1.0, 0.0, 0.0],
        candidates=candidates,
    )
    assert ranked[0].startup_id == "s1"
    assert ranked[0].score > ranked[1].score
    assert any("Sector match" in r for r in ranked[0].reasons)
    assert len(ranked[0].reasons) <= 3


# --- Money -----------------------------------------------------------------


def test_indian_digit_grouping():
    assert format_inr(rupees_to_paise("1250000")) == "12,50,000.00"
    assert format_inr(rupees_to_paise("999")) == "999.00"
    assert format_inr(rupees_to_paise("100000")) == "1,00,000.00"
    assert format_inr(-rupees_to_paise("1250000")) == "-12,50,000.00"


@given(st.integers(min_value=0, max_value=10**12), st.integers(min_value=1, max_value=50))
def test_splitting_money_never_loses_a_paisa(total: int, parts: int):
    pieces = split_evenly(total, parts)
    assert sum(pieces) == total
    assert len(pieces) == parts
    assert max(pieces) - min(pieces) <= 1


@given(st.integers(min_value=0, max_value=10**12))
def test_paise_round_trip_is_exact(paise: int):
    assert rupees_to_paise(paise_to_rupees(paise)) == paise
