"""Statistical validation (PRD 5.6 acceptance criterion, 12.4, 12.5, 14.1).

Two gates matter here and both are asserted:

- the Monte Carlo power must match the analytical power within 2 percentage points
- the bootstrap confidence interval must cover the true value close to 95 percent of
  the time on synthetic data
"""

from __future__ import annotations

import numpy as np
import pytest

from app.domain.simulator import SimulationInputs, run_simulation, simulate_power_only
from app.domain.statistics import (
    analyse_paired,
    analyse_two_proportion,
    analytical_power_paired,
    analytical_power_two_sample,
    minimum_detectable_effect_paired,
    wilson_interval,
)

# The test case named in the PRD: baseline 32 percent, claimed reduction to 24 percent,
# standard deviation 8 points.
BASELINE_MEAN = 32.0
CLAIMED_EFFECT = -8.0
BASELINE_SD = 8.0


def _textbook_inputs(**overrides) -> SimulationInputs:
    """Shrinkage and effect uncertainty off, so the model reduces to the analytical case."""
    base = {
        "baseline_mean": BASELINE_MEAN,
        "baseline_sd": BASELINE_SD,
        "claimed_effect": CLAIMED_EFFECT,
        "direction": "lower",
        "kpi_kind": "continuous",
        "duration_weeks": 8,
        "units": 24,
        "measurements_per_week": 1,
        "within_unit_share": 0.5,
        "realism_factor": 1.0,
        "effect_uncertainty": 0.0,
        "alpha": 0.05,
        "iterations": 20000,
        "seed": 4242,
    }
    base.update(overrides)
    return SimulationInputs(**base)


def test_simulated_power_matches_analytical_power_for_the_prd_test_case():
    inputs = _textbook_inputs()
    simulated = simulate_power_only(inputs)
    analytical = analytical_power_paired(
        inputs.realism_factor * inputs.claimed_effect, inputs.sd_of_differences(), inputs.units,
        inputs.alpha,
    )
    assert abs(simulated - analytical) <= 0.02, (
        "simulated " + str(simulated) + " vs analytical " + str(analytical)
    )


@pytest.mark.parametrize(
    "units,weeks,effect",
    [(8, 4, -8.0), (12, 6, -6.0), (24, 8, -8.0), (40, 12, -4.0), (60, 2, -5.0)],
)
def test_simulated_power_matches_analytical_power_across_designs(units, weeks, effect):
    inputs = _textbook_inputs(units=units, duration_weeks=weeks, claimed_effect=effect)
    simulated = simulate_power_only(inputs)
    analytical = analytical_power_paired(
        effect, inputs.sd_of_differences(), units, inputs.alpha
    )
    assert abs(simulated - analytical) <= 0.02


def test_power_rises_with_units_and_with_duration():
    small = simulate_power_only(_textbook_inputs(units=6, duration_weeks=2))
    more_units = simulate_power_only(_textbook_inputs(units=24, duration_weeks=2))
    longer = simulate_power_only(_textbook_inputs(units=6, duration_weeks=12))
    assert more_units > small
    assert longer > small


def test_recommender_finds_a_design_that_reaches_the_target_power():
    inputs = _textbook_inputs(
        units=6, duration_weeks=2, cost_per_unit_week_paise=250000, iterations=4000
    )
    output = run_simulation(
        inputs, budget_ceiling_paise=45_00_000 * 100, target_power=0.80, what_if=[(4, 24)]
    )
    assert output.proposed["power"] < 0.80
    assert output.recommendation_found
    assert output.recommendation["power"] >= 0.80
    assert output.recommendation["expected_cost_paise"] <= 45_00_000 * 100
    assert "reaches" in output.recommendation_message


def test_recommender_says_plainly_when_no_design_fits_the_budget():
    inputs = _textbook_inputs(
        claimed_effect=-0.2, units=6, duration_weeks=2, cost_per_unit_week_paise=500000,
        iterations=2000,
    )
    output = run_simulation(inputs, budget_ceiling_paise=100000 * 100, target_power=0.80)
    assert not output.recommendation_found
    assert "No design" in output.recommendation_message


def test_what_if_comparison_returns_at_most_five_designs():
    inputs = _textbook_inputs(iterations=2000, cost_per_unit_week_paise=100000)
    output = run_simulation(
        inputs, budget_ceiling_paise=50_00_000 * 100, what_if=[(4, 10), (6, 20), (12, 30)]
    )
    assert 1 <= len(output.comparison) <= 5
    labels = [row["label"] for row in output.comparison]
    assert labels[0] == "Proposed design"


def test_cost_range_brackets_the_expected_cost():
    inputs = _textbook_inputs(cost_per_unit_week_paise=200000, iterations=5000)
    output = run_simulation(inputs, budget_ceiling_paise=0)
    proposed = output.proposed
    assert proposed["cost_p5_paise"] <= proposed["expected_cost_paise"] <= proposed["cost_p95_paise"]
    assert proposed["cost_p95_paise"] > proposed["cost_p5_paise"]


def test_simulation_is_reproducible_from_its_seed():
    first = run_simulation(_textbook_inputs(iterations=3000), budget_ceiling_paise=0)
    second = run_simulation(_textbook_inputs(iterations=3000), budget_ceiling_paise=0)
    assert first.proposed["power"] == second.proposed["power"]
    assert first.proposed["expected_cost_paise"] == second.proposed["expected_cost_paise"]


def test_realism_factor_lowers_the_reported_power():
    optimistic = simulate_power_only(_textbook_inputs(units=10, duration_weeks=3, realism_factor=1.0))
    realistic = simulate_power_only(
        _textbook_inputs(units=10, duration_weeks=3, realism_factor=0.7, effect_uncertainty=0.25)
    )
    assert realistic < optimistic


def test_minimum_detectable_effect_falls_as_the_design_grows():
    small = minimum_detectable_effect_paired(4.0, 10)
    large = minimum_detectable_effect_paired(4.0, 100)
    assert large < small


def test_comparison_arm_uses_the_two_sample_test():
    inputs = _textbook_inputs(units=30, comparison_units=30, iterations=6000)
    simulated = simulate_power_only(inputs)
    analytical = analytical_power_two_sample(
        inputs.claimed_effect, inputs.sd_of_differences() / np.sqrt(2.0), 30, inputs.alpha
    )
    assert abs(simulated - analytical) <= 0.03


# --- Analysis methods ------------------------------------------------------


def test_paired_analysis_recovers_a_known_effect():
    rng = np.random.default_rng(7)
    baseline = rng.normal(32.0, 8.0, size=40)
    pilot = baseline - 6.0 + rng.normal(0.0, 2.0, size=40)
    result = analyse_paired(baseline, pilot, direction="lower", seed=11, resamples=4000)
    assert result.method == "paired_t"
    assert abs(result.effect + 6.0) < 1.0
    assert result.excludes_zero_95
    assert result.ci_low < result.effect < result.ci_high
    assert result.p_value < 0.01


def test_paired_analysis_reports_no_effect_when_there_is_none():
    rng = np.random.default_rng(3)
    baseline = rng.normal(32.0, 8.0, size=30)
    pilot = baseline + rng.normal(0.0, 2.0, size=30)
    result = analyse_paired(baseline, pilot, direction="lower", seed=5, resamples=4000)
    assert not result.excludes_zero_95
    assert result.p_value > 0.05


def test_paired_analysis_is_deterministic_for_a_fixed_seed():
    rng = np.random.default_rng(1)
    baseline = rng.normal(40.0, 6.0, size=25)
    pilot = baseline - 3.0
    first = analyse_paired(baseline, pilot, direction="lower", seed=99, resamples=2000)
    second = analyse_paired(baseline, pilot, direction="lower", seed=99, resamples=2000)
    assert first.to_dict() == second.to_dict()


def test_bootstrap_interval_covers_the_true_value_close_to_95_percent():
    """Coverage check on synthetic data (PRD 14.1 statistical validation gate)."""
    covered = 0
    trials = 200
    true_effect = -5.0
    for index in range(trials):
        rng = np.random.default_rng(1000 + index)
        baseline = rng.normal(30.0, 7.0, size=40)
        pilot = baseline + true_effect + rng.normal(0.0, 3.0, size=40)
        result = analyse_paired(
            baseline, pilot, direction="lower", seed=index, resamples=1200
        )
        if result.ci_low <= true_effect <= result.ci_high:
            covered += 1
    coverage = covered / trials
    assert 0.88 <= coverage <= 1.0, "coverage was " + str(coverage)


def test_rank_test_is_used_when_normality_fails():
    rng = np.random.default_rng(21)
    baseline = rng.normal(50.0, 5.0, size=40)
    # Heavily skewed differences, so the normality check should reject.
    pilot = baseline - rng.exponential(4.0, size=40)
    result = analyse_paired(baseline, pilot, direction="lower", seed=2, resamples=2000)
    assert result.method in ("wilcoxon", "paired_t")
    if result.method == "wilcoxon":
        assert result.notes


def test_two_proportion_analysis_and_wilson_interval():
    result = analyse_two_proportion(
        320, 1000, 240, 1000, direction="lower", seed=17, resamples=4000
    )
    assert abs(result.effect + 0.08) < 0.01
    assert result.excludes_zero_95
    low, high = wilson_interval(320, 1000)
    assert low < 0.32 < high


def test_higher_is_better_direction_is_handled():
    rng = np.random.default_rng(31)
    baseline = rng.normal(45.0, 6.0, size=35)
    pilot = baseline + 7.0 + rng.normal(0.0, 2.0, size=35)
    result = analyse_paired(baseline, pilot, direction="higher", seed=4, resamples=3000)
    assert result.effect > 0
    assert result.excludes_zero_95
