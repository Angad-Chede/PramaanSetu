"""Pilot Flight Simulator (PRD 5.6, 12.5).

The simulator answers one question for the officer: if the startup's solution really
delivers the promised improvement, will this pilot design detect it, and at what cost.

Measurement model. For unit i in period t the observed value is

    y[i,t] = mu + u[i] + w[i,t]

where u[i] is stable unit-to-unit variation and w[i,t] is period-to-period measurement
noise. A paired design compares each unit against itself, so u[i] cancels and the
standard deviation of the per-unit difference is sqrt(2) * sigma_within / sqrt(m), with
m the number of measurements per phase. That is why both a longer pilot and more units
raise power, and why the recommender searches over both.

Claimed effects are usually optimistic, so the true effect in each iteration is drawn
around realism_factor times the claim, with uncertainty. Setting realism_factor to 1.0
and effect_uncertainty to 0.0 reduces the model to the textbook case, which is how the
Monte Carlo power is validated against the analytical power in the unit tests.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
from scipy import stats

from app.domain.statistics import (
    analytical_power_paired,
    analytical_power_two_sample,
    minimum_detectable_effect_paired,
)

# Overrun factor: log-normal with median 1.0 and 90th percentile 1.25 (PRD 12.5)
OVERRUN_MEDIAN = 1.0
OVERRUN_P90 = 1.25
OVERRUN_SIGMA = float(np.log(OVERRUN_P90) / stats.norm.ppf(0.90))


@dataclass
class SimulationInputs:
    """Everything FR-PS-01 asks the officer for, plus the model parameters."""

    baseline_mean: float
    baseline_sd: float
    claimed_effect: float  # signed: negative when lower is better
    direction: str = "lower"
    kpi_kind: str = "continuous"  # continuous or proportion
    duration_weeks: int = 8
    units: int = 20
    comparison_units: int = 0
    measurements_per_week: int = 1
    cost_per_unit_week_paise: int = 0
    fixed_cost_paise: int = 0
    within_unit_share: float = 0.5
    realism_factor: float = 0.7
    effect_uncertainty: float = 0.25  # as a share of the absolute claimed effect
    alpha: float = 0.05
    baseline_confidence: str = "measured"  # measured, estimated_high, estimated_low
    # A design can be statistically adequate and still operationally meaningless: two
    # weeks of a water-loss intervention says nothing about how it behaves in service.
    # The recommender never proposes a pilot shorter than this.
    min_duration_weeks: int = 4
    iterations: int = 10_000
    seed: int = 20260924

    def measurements_per_phase(self) -> int:
        return max(1, int(self.duration_weeks * self.measurements_per_week))

    def sigma_within(self) -> float:
        """Period-to-period noise. An estimated baseline is inflated to stay honest."""
        share = min(max(self.within_unit_share, 0.05), 0.95)
        sigma = float(self.baseline_sd) * float(np.sqrt(share))
        if self.baseline_confidence == "estimated_low":
            sigma *= 1.30
        elif self.baseline_confidence == "estimated_high":
            sigma *= 1.15
        return sigma

    def sigma_unit(self) -> float:
        share = min(max(self.within_unit_share, 0.05), 0.95)
        return float(self.baseline_sd) * float(np.sqrt(1.0 - share))

    def sd_of_differences(self) -> float:
        """Analytical standard deviation of the per-unit pre-post difference."""
        return float(np.sqrt(2.0) * self.sigma_within() / np.sqrt(self.measurements_per_phase()))

    def total_unit_weeks(self) -> int:
        return int((self.units + self.comparison_units) * self.duration_weeks)

    def expected_cost_paise(self) -> int:
        return int(self.fixed_cost_paise + self.total_unit_weeks() * self.cost_per_unit_week_paise)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DesignOutcome:
    duration_weeks: int
    units: int
    comparison_units: int
    power: float
    expected_cost_paise: int
    cost_p5_paise: int
    cost_p95_paise: int
    minimum_detectable_effect: float
    sd_of_differences: float
    within_budget: bool
    iterations: int
    label: str = ""
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SimulationOutput:
    proposed: dict[str, Any]
    recommendation: dict[str, Any] | None
    recommendation_found: bool
    recommendation_message: str
    comparison: list[dict[str, Any]]
    inputs: dict[str, Any]
    seed: int
    iterations: int
    engine_version: str
    runtime_ms: int
    analytical_power: float
    analytical_gap: float
    grid_searched: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _simulate(inputs: SimulationInputs, iterations: int, seed: int) -> DesignOutcome:
    """One vectorised Monte Carlo run over `iterations` replications of the whole pilot."""
    rng = np.random.default_rng(seed)
    n = max(2, int(inputs.units))
    m = inputs.measurements_per_phase()
    sigma_within = inputs.sigma_within()
    sigma_unit = inputs.sigma_unit()
    comparison_n = max(0, int(inputs.comparison_units))

    # True effect per iteration: the claim, shrunk for realism, with uncertainty.
    centre = inputs.realism_factor * inputs.claimed_effect
    spread = abs(inputs.claimed_effect) * max(0.0, inputs.effect_uncertainty)
    true_effect = (
        rng.normal(centre, spread, size=iterations) if spread > 0 else np.full(iterations, centre)
    )

    # Per-unit stable level, then phase means with measurement noise.
    unit_level = rng.normal(0.0, sigma_unit, size=(iterations, n)) if sigma_unit > 0 else np.zeros((iterations, n))
    noise_sd = sigma_within / np.sqrt(m)
    base_obs = inputs.baseline_mean + unit_level + rng.normal(0.0, noise_sd, size=(iterations, n))
    pilot_obs = (
        inputs.baseline_mean
        + unit_level
        + true_effect[:, None]
        + rng.normal(0.0, noise_sd, size=(iterations, n))
    )

    if inputs.kpi_kind == "proportion":
        base_obs = np.clip(base_obs, 0.0, 100.0 if inputs.baseline_mean > 1.0 else 1.0)
        pilot_obs = np.clip(pilot_obs, 0.0, 100.0 if inputs.baseline_mean > 1.0 else 1.0)

    if comparison_n > 0:
        comp_level = (
            rng.normal(0.0, sigma_unit, size=(iterations, comparison_n))
            if sigma_unit > 0
            else np.zeros((iterations, comparison_n))
        )
        comp_base = inputs.baseline_mean + comp_level + rng.normal(0.0, noise_sd, size=(iterations, comparison_n))
        comp_pilot = inputs.baseline_mean + comp_level + rng.normal(
            0.0, noise_sd, size=(iterations, comparison_n)
        )
        treat_change = pilot_obs - base_obs
        comp_change = comp_pilot - comp_base
        detected = _welch_detect(treat_change, comp_change, inputs.alpha, inputs.direction)
    else:
        differences = pilot_obs - base_obs
        detected = _paired_detect(differences, inputs.alpha, inputs.direction)

    power = float(np.mean(detected))

    # Cost: units times weeks times rate, with a log-normal overrun factor.
    overrun = rng.lognormal(mean=0.0, sigma=OVERRUN_SIGMA, size=iterations)
    base_cost = float(inputs.total_unit_weeks() * inputs.cost_per_unit_week_paise)
    costs = inputs.fixed_cost_paise + base_cost * overrun
    cost_p5, cost_p95 = np.quantile(costs, [0.05, 0.95])

    mde = minimum_detectable_effect_paired(
        inputs.sd_of_differences(), n, alpha=inputs.alpha, power=0.80
    )

    return DesignOutcome(
        duration_weeks=int(inputs.duration_weeks),
        units=n,
        comparison_units=comparison_n,
        power=round(power, 4),
        expected_cost_paise=int(round(float(np.mean(costs)))),
        cost_p5_paise=int(round(float(cost_p5))),
        cost_p95_paise=int(round(float(cost_p95))),
        minimum_detectable_effect=round(float(mde), 4),
        sd_of_differences=round(inputs.sd_of_differences(), 4),
        within_budget=True,
        iterations=iterations,
    )


def _paired_detect(differences: np.ndarray, alpha: float, direction: str) -> np.ndarray:
    """Two-sided paired t-test per iteration, counted only when the change is beneficial."""
    n = differences.shape[1]
    mean = differences.mean(axis=1)
    sd = differences.std(axis=1, ddof=1)
    sd = np.where(sd <= 0, np.finfo(float).eps, sd)
    t_stat = mean / (sd / np.sqrt(n))
    crit = stats.t.ppf(1.0 - alpha / 2.0, n - 1)
    significant = np.abs(t_stat) > crit
    beneficial = mean < 0 if direction == "lower" else mean > 0
    return significant & beneficial


def _welch_detect(
    treat: np.ndarray, comparison: np.ndarray, alpha: float, direction: str
) -> np.ndarray:
    """Vectorised Welch test on change scores, one test per iteration."""
    n1, n2 = treat.shape[1], comparison.shape[1]
    m1, m2 = treat.mean(axis=1), comparison.mean(axis=1)
    v1 = treat.var(axis=1, ddof=1) / n1
    v2 = comparison.var(axis=1, ddof=1) / n2
    denom = np.sqrt(v1 + v2)
    denom = np.where(denom <= 0, np.finfo(float).eps, denom)
    t_stat = (m1 - m2) / denom
    df = (v1 + v2) ** 2 / (v1**2 / (n1 - 1) + v2**2 / (n2 - 1))
    crit = stats.t.ppf(1.0 - alpha / 2.0, df)
    significant = np.abs(t_stat) > crit
    diff = m1 - m2
    beneficial = diff < 0 if direction == "lower" else diff > 0
    return significant & beneficial


def _analytical_power(inputs: SimulationInputs, duration_weeks: int, units: int) -> float:
    """Fast deterministic power used to screen the grid before the Monte Carlo confirmation."""
    probe = SimulationInputs(**{**inputs.to_dict(), "duration_weeks": duration_weeks, "units": units})
    effect = inputs.realism_factor * inputs.claimed_effect
    sd_d = probe.sd_of_differences()
    if inputs.comparison_units > 0:
        per_arm = min(units, inputs.comparison_units)
        return analytical_power_two_sample(effect, sd_d / np.sqrt(2.0), per_arm, inputs.alpha)
    return analytical_power_paired(effect, sd_d, units, inputs.alpha)


def run_simulation(
    inputs: SimulationInputs,
    *,
    budget_ceiling_paise: int = 0,
    target_power: float = 0.80,
    max_duration_weeks: int = 26,
    max_units: int = 200,
    what_if: list[tuple[int, int]] | None = None,
) -> SimulationOutput:
    """Full simulator call: proposed design, recommendation and a what-if comparison.

    The grid is screened analytically, which costs microseconds per cell, and the
    surviving candidates are confirmed with a full Monte Carlo run, so the reported
    power is always the simulated one.
    """
    started = time.perf_counter()
    iterations = max(1_000, int(inputs.iterations))

    proposed = _simulate(inputs, iterations, inputs.seed)
    proposed.label = "Proposed design"
    proposed.within_budget = (
        budget_ceiling_paise <= 0 or proposed.expected_cost_paise <= budget_ceiling_paise
    )
    if proposed.power < target_power:
        proposed.notes.append(
            "This design detects the claimed improvement in only "
            + str(round(proposed.power * 100))
            + " of 100 pilots. A result that misses the target would not tell you whether "
            "the solution failed or the pilot was too small to see it."
        )
    if not proposed.within_budget:
        proposed.notes.append(
            "The expected cost of this design is above the published budget ceiling."
        )

    # Analytical screen across the grid, cheapest first. The grid starts at the shortest
    # pilot the department would actually run, so the recommendation is deployable and
    # not merely detectable.
    floor_weeks = max(1, int(inputs.min_duration_weeks))
    duration_grid = sorted(
        {inputs.duration_weeks, *range(max(2, floor_weeks), max_duration_weeks + 1, 2)}
    )
    duration_grid = [weeks for weeks in duration_grid if weeks >= floor_weeks]
    unit_grid = sorted({inputs.units, *range(5, max_units + 1, 5)})
    candidates: list[tuple[int, int, int]] = []  # (cost, duration, units)
    grid_searched = 0
    for weeks in duration_grid:
        for units in unit_grid:
            grid_searched += 1
            probe = SimulationInputs(
                **{**inputs.to_dict(), "duration_weeks": weeks, "units": units}
            )
            cost = probe.expected_cost_paise()
            if budget_ceiling_paise > 0 and cost > budget_ceiling_paise:
                continue
            if _analytical_power(inputs, weeks, units) < target_power - 0.03:
                continue
            candidates.append((cost, weeks, units))

    candidates.sort(key=lambda c: (c[0], c[1], c[2]))

    recommendation: DesignOutcome | None = None
    for cost, weeks, units in candidates[:6]:
        probe = SimulationInputs(**{**inputs.to_dict(), "duration_weeks": weeks, "units": units})
        outcome = _simulate(probe, iterations, inputs.seed + 1)
        outcome.within_budget = budget_ceiling_paise <= 0 or cost <= budget_ceiling_paise
        if outcome.power >= target_power:
            outcome.label = "Recommended design"
            outcome.notes.append(
                "Smallest design at or above the "
                + str(floor_weeks)
                + " week operational minimum that reaches "
                + str(int(target_power * 100))
                + " percent power within the budget ceiling."
            )
            recommendation = outcome
            break

    if recommendation is not None:
        message = (
            "A pilot of "
            + str(recommendation.duration_weeks)
            + " weeks across "
            + str(recommendation.units)
            + " units reaches "
            + str(round(recommendation.power * 100))
            + " percent power within the budget ceiling."
        )
    elif budget_ceiling_paise > 0:
        message = (
            "No design within the published budget ceiling reaches "
            + str(int(target_power * 100))
            + " percent power for the effect claimed. Either raise the ceiling, reduce the "
            "measurement noise by measuring more often, or accept a pilot that can only "
            "detect a larger improvement than the one claimed."
        )
    else:
        message = (
            "No design in the search range reaches "
            + str(int(target_power * 100))
            + " percent power for the effect claimed. The claimed improvement is small "
            "relative to the variation in the measure."
        )

    comparison: list[dict[str, Any]] = [proposed.to_dict()]
    if recommendation is not None:
        comparison.append(recommendation.to_dict())
    for index, (weeks, units) in enumerate((what_if or [])[:3]):
        probe = SimulationInputs(**{**inputs.to_dict(), "duration_weeks": weeks, "units": units})
        outcome = _simulate(probe, iterations, inputs.seed + 100 + index)
        outcome.label = "Option " + str(index + 1)
        outcome.within_budget = (
            budget_ceiling_paise <= 0 or outcome.expected_cost_paise <= budget_ceiling_paise
        )
        comparison.append(outcome.to_dict())

    analytical = _analytical_power(inputs, inputs.duration_weeks, inputs.units)
    runtime_ms = int((time.perf_counter() - started) * 1000)

    return SimulationOutput(
        proposed=proposed.to_dict(),
        recommendation=recommendation.to_dict() if recommendation else None,
        recommendation_found=recommendation is not None,
        recommendation_message=message,
        comparison=comparison[:5],
        inputs=inputs.to_dict(),
        seed=inputs.seed,
        iterations=iterations,
        engine_version="simulator-1.0.0",
        runtime_ms=runtime_ms,
        analytical_power=round(analytical, 4),
        analytical_gap=round(abs(analytical - proposed.power), 4),
        grid_searched=grid_searched,
    )


def simulate_power_only(inputs: SimulationInputs) -> float:
    """Convenience entry point used by the statistical validation tests."""
    return _simulate(inputs, inputs.iterations, inputs.seed).power
