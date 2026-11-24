"""Evidence analysis methods (PRD 12.4).

The method is chosen at design freeze and cannot change afterwards. Every function here
is deterministic given its seed, and the seed is stored on the Evidence Report, so a
re-run on the same locked dataset reproduces the result exactly (FR-EE-06).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

import numpy as np
from scipy import stats

AnalysisMethod = Literal["paired_t", "wilcoxon", "welch_did", "two_proportion"]

METHOD_LABELS: dict[str, str] = {
    "paired_t": "Paired comparison of the same units before and after",
    "wilcoxon": "Paired rank comparison of the same units before and after",
    "welch_did": "Pilot units compared against similar non-pilot units",
    "two_proportion": "Comparison of two rates",
}


@dataclass
class AnalysisResult:
    method: str
    method_label: str
    n_pilot: int
    n_comparison: int
    baseline_mean: float
    pilot_mean: float
    effect: float
    effect_direction: str
    relative_effect_percent: float
    ci_low: float
    ci_high: float
    ci_level: float
    ci_90_low: float
    ci_90_high: float
    p_value: float
    statistic: float
    standardised_effect: float
    normality_p: float | None
    excludes_zero_95: bool
    excludes_zero_90: bool
    seed: int
    resamples: int
    notes: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _bootstrap_ci(
    values: np.ndarray,
    *,
    seed: int,
    resamples: int,
    level: float = 0.95,
    statistic=np.mean,
) -> tuple[float, float]:
    """Percentile bootstrap confidence interval with a stored seed (PRD 12.4)."""
    if values.size == 0:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, values.size, size=(resamples, values.size))
    draws = statistic(values[idx], axis=1)
    alpha = (1.0 - level) / 2.0
    low, high = np.quantile(draws, [alpha, 1.0 - alpha])
    return (float(low), float(high))


def _bootstrap_diff_ci(
    treatment: np.ndarray,
    comparison: np.ndarray,
    *,
    seed: int,
    resamples: int,
    level: float = 0.95,
) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    t_idx = rng.integers(0, treatment.size, size=(resamples, treatment.size))
    c_idx = rng.integers(0, comparison.size, size=(resamples, comparison.size))
    draws = treatment[t_idx].mean(axis=1) - comparison[c_idx].mean(axis=1)
    alpha = (1.0 - level) / 2.0
    low, high = np.quantile(draws, [alpha, 1.0 - alpha])
    return (float(low), float(high))


def _direction_sign(direction: str) -> float:
    """A beneficial change is negative when lower is better, positive when higher is better."""
    return -1.0 if direction == "lower" else 1.0


def _excludes_zero(low: float, high: float, direction: str) -> bool:
    """True when the whole interval sits on the beneficial side of zero."""
    if np.isnan(low) or np.isnan(high):
        return False
    if direction == "lower":
        return high < 0.0
    return low > 0.0


def analyse_paired(
    baseline: np.ndarray,
    pilot: np.ndarray,
    *,
    direction: str,
    seed: int,
    resamples: int,
    force_rank_test: bool = False,
) -> AnalysisResult:
    """Pre-post on the same units. Falls back to Wilcoxon if the normality check fails."""
    notes: list[str] = []
    differences = pilot - baseline
    n = differences.size

    normality_p: float | None = None
    use_rank = force_rank_test
    if n >= 8 and not force_rank_test:
        normality_p = float(stats.shapiro(differences).pvalue)
        if normality_p < 0.05:
            use_rank = True
            notes.append(
                "The differences are not close to a normal distribution "
                "(Shapiro-Wilk p = " + str(round(normality_p, 4)) + "), "
                "so the paired rank test was used as the pre-registered plan requires."
            )
    elif n < 8:
        notes.append(
            "Fewer than 8 paired units, so the normality check was not run and the "
            "bootstrap interval carries the uncertainty."
        )

    if use_rank:
        method = "wilcoxon"
        try:
            result = stats.wilcoxon(differences, alternative="two-sided")
            statistic, p_value = float(result.statistic), float(result.pvalue)
        except ValueError:
            statistic, p_value = 0.0, 1.0
            notes.append("All paired differences were zero, so no change could be detected.")
    else:
        method = "paired_t"
        result = stats.ttest_rel(pilot, baseline)
        statistic, p_value = float(result.statistic), float(result.pvalue)

    ci_low, ci_high = _bootstrap_ci(differences, seed=seed, resamples=resamples, level=0.95)
    ci90_low, ci90_high = _bootstrap_ci(differences, seed=seed, resamples=resamples, level=0.90)

    sd = float(np.std(differences, ddof=1)) if n > 1 else 0.0
    standardised = float(np.mean(differences) / sd) if sd > 0 else 0.0

    baseline_mean = float(np.mean(baseline))
    pilot_mean = float(np.mean(pilot))
    effect = pilot_mean - baseline_mean
    relative = (effect / baseline_mean * 100.0) if baseline_mean else 0.0

    return AnalysisResult(
        method=method,
        method_label=METHOD_LABELS[method],
        n_pilot=int(n),
        n_comparison=0,
        baseline_mean=round(baseline_mean, 6),
        pilot_mean=round(pilot_mean, 6),
        effect=round(effect, 6),
        effect_direction=direction,
        relative_effect_percent=round(relative, 3),
        ci_low=round(ci_low, 6),
        ci_high=round(ci_high, 6),
        ci_level=0.95,
        ci_90_low=round(ci90_low, 6),
        ci_90_high=round(ci90_high, 6),
        p_value=round(p_value, 6),
        statistic=round(statistic, 6),
        standardised_effect=round(standardised, 4),
        normality_p=round(normality_p, 6) if normality_p is not None else None,
        excludes_zero_95=_excludes_zero(ci_low, ci_high, direction),
        excludes_zero_90=_excludes_zero(ci90_low, ci90_high, direction),
        seed=seed,
        resamples=resamples,
        notes=notes,
    )


def analyse_difference_in_differences(
    treatment_baseline: np.ndarray,
    treatment_pilot: np.ndarray,
    comparison_baseline: np.ndarray,
    comparison_pilot: np.ndarray,
    *,
    direction: str,
    seed: int,
    resamples: int,
) -> AnalysisResult:
    """Welch t-test on change scores: the difference in differences (PRD 12.4)."""
    treat_change = treatment_pilot - treatment_baseline
    comp_change = comparison_pilot - comparison_baseline

    result = stats.ttest_ind(treat_change, comp_change, equal_var=False)
    statistic, p_value = float(result.statistic), float(result.pvalue)

    ci_low, ci_high = _bootstrap_diff_ci(
        treat_change, comp_change, seed=seed, resamples=resamples, level=0.95
    )
    ci90_low, ci90_high = _bootstrap_diff_ci(
        treat_change, comp_change, seed=seed, resamples=resamples, level=0.90
    )

    effect = float(np.mean(treat_change) - np.mean(comp_change))
    pooled_sd = float(
        np.sqrt((np.var(treat_change, ddof=1) + np.var(comp_change, ddof=1)) / 2.0)
    )
    standardised = effect / pooled_sd if pooled_sd > 0 else 0.0

    baseline_mean = float(np.mean(treatment_baseline))
    pilot_mean = float(np.mean(treatment_pilot))
    relative = (effect / baseline_mean * 100.0) if baseline_mean else 0.0

    return AnalysisResult(
        method="welch_did",
        method_label=METHOD_LABELS["welch_did"],
        n_pilot=int(treat_change.size),
        n_comparison=int(comp_change.size),
        baseline_mean=round(baseline_mean, 6),
        pilot_mean=round(pilot_mean, 6),
        effect=round(effect, 6),
        effect_direction=direction,
        relative_effect_percent=round(relative, 3),
        ci_low=round(ci_low, 6),
        ci_high=round(ci_high, 6),
        ci_level=0.95,
        ci_90_low=round(ci90_low, 6),
        ci_90_high=round(ci90_high, 6),
        p_value=round(p_value, 6),
        statistic=round(statistic, 6),
        standardised_effect=round(standardised, 4),
        normality_p=None,
        excludes_zero_95=_excludes_zero(ci_low, ci_high, direction),
        excludes_zero_90=_excludes_zero(ci90_low, ci90_high, direction),
        seed=seed,
        resamples=resamples,
        notes=[
            "The comparison group carries any change that would have happened anyway, "
            "so the reported effect is the change attributable to the pilot."
        ],
    )


def wilson_interval(successes: int, trials: int, level: float = 0.95) -> tuple[float, float]:
    """Wilson score interval for a proportion. Stable at small samples and at 0 or 1."""
    if trials == 0:
        return (float("nan"), float("nan"))
    z = float(stats.norm.ppf(1.0 - (1.0 - level) / 2.0))
    phat = successes / trials
    denominator = 1.0 + z * z / trials
    centre = (phat + z * z / (2.0 * trials)) / denominator
    margin = (z / denominator) * np.sqrt(phat * (1.0 - phat) / trials + z * z / (4.0 * trials**2))
    return (float(centre - margin), float(centre + margin))


def analyse_two_proportion(
    baseline_successes: int,
    baseline_trials: int,
    pilot_successes: int,
    pilot_trials: int,
    *,
    direction: str,
    seed: int,
    resamples: int,
) -> AnalysisResult:
    """Two-proportion test for rate measures such as leakage percentage (PRD 12.4)."""
    p1 = baseline_successes / baseline_trials if baseline_trials else 0.0
    p2 = pilot_successes / pilot_trials if pilot_trials else 0.0
    pooled = (baseline_successes + pilot_successes) / max(baseline_trials + pilot_trials, 1)

    se = np.sqrt(pooled * (1.0 - pooled) * (1.0 / max(baseline_trials, 1) + 1.0 / max(pilot_trials, 1)))
    z = (p2 - p1) / se if se > 0 else 0.0
    p_value = float(2.0 * (1.0 - stats.norm.cdf(abs(z))))

    rng = np.random.default_rng(seed)
    draws_base = rng.binomial(baseline_trials, p1, size=resamples) / max(baseline_trials, 1)
    draws_pilot = rng.binomial(pilot_trials, p2, size=resamples) / max(pilot_trials, 1)
    diffs = draws_pilot - draws_base
    ci_low, ci_high = (float(x) for x in np.quantile(diffs, [0.025, 0.975]))
    ci90_low, ci90_high = (float(x) for x in np.quantile(diffs, [0.05, 0.95]))

    effect = p2 - p1
    relative = (effect / p1 * 100.0) if p1 else 0.0

    return AnalysisResult(
        method="two_proportion",
        method_label=METHOD_LABELS["two_proportion"],
        n_pilot=int(pilot_trials),
        n_comparison=int(baseline_trials),
        baseline_mean=round(p1, 6),
        pilot_mean=round(p2, 6),
        effect=round(effect, 6),
        effect_direction=direction,
        relative_effect_percent=round(relative, 3),
        ci_low=round(ci_low, 6),
        ci_high=round(ci_high, 6),
        ci_level=0.95,
        ci_90_low=round(ci90_low, 6),
        ci_90_high=round(ci90_high, 6),
        p_value=round(p_value, 6),
        statistic=round(float(z), 6),
        standardised_effect=round(float(2 * (np.arcsin(np.sqrt(p2)) - np.arcsin(np.sqrt(p1)))), 4),
        normality_p=None,
        excludes_zero_95=_excludes_zero(ci_low, ci_high, direction),
        excludes_zero_90=_excludes_zero(ci90_low, ci90_high, direction),
        seed=seed,
        resamples=resamples,
        notes=[
            "Wilson intervals for each rate: baseline "
            + str([round(x, 4) for x in wilson_interval(baseline_successes, baseline_trials)])
            + ", pilot "
            + str([round(x, 4) for x in wilson_interval(pilot_successes, pilot_trials)])
            + "."
        ],
    )


def _noncentral_t_power(ncp: float, df: int, alpha: float) -> float:
    """Two-sided power from the non-central t distribution, with a safe fallback.

    The non-central t implementation loses precision at a large non-centrality parameter
    and can return zero where the true power is effectively one. When that happens the
    normal approximation is used instead, which is accurate to well under a percentage
    point in exactly that region.
    """
    crit = float(stats.t.ppf(1.0 - alpha / 2.0, df))
    upper = float(stats.nct.sf(crit, df, ncp))
    lower = float(stats.nct.cdf(-crit, df, ncp))
    power = upper + lower
    if not np.isfinite(power) or (ncp > 5.0 and power < 0.5):
        z = float(stats.norm.ppf(1.0 - alpha / 2.0))
        power = float(stats.norm.cdf(ncp - z) + stats.norm.cdf(-ncp - z))
    return float(min(1.0, max(0.0, power)))


def analytical_power_paired(
    effect: float, sd_of_differences: float, n: int, alpha: float = 0.05
) -> float:
    """Closed-form power for a two-sided paired t-test.

    The Monte Carlo simulator must agree with this within 2 percentage points; the check
    is a unit test gate (PRD 5.6 acceptance, 14.1).
    """
    if n < 2 or sd_of_differences <= 0:
        return 0.0
    ncp = abs(effect) / (sd_of_differences / np.sqrt(n))
    return _noncentral_t_power(ncp, n - 1, alpha)


def analytical_power_two_sample(
    effect: float, sd: float, n_per_arm: int, alpha: float = 0.05
) -> float:
    """Closed-form power for a two-sided two-sample t-test with equal arms."""
    if n_per_arm < 2 or sd <= 0:
        return 0.0
    ncp = abs(effect) / (sd * np.sqrt(2.0 / n_per_arm))
    return _noncentral_t_power(ncp, 2 * n_per_arm - 2, alpha)


def minimum_detectable_effect_paired(
    sd_of_differences: float, n: int, alpha: float = 0.05, power: float = 0.80
) -> float:
    """Smallest true effect this design detects at the stated power."""
    if n < 2 or sd_of_differences <= 0:
        return float("inf")
    z_alpha = float(stats.norm.ppf(1.0 - alpha / 2.0))
    z_beta = float(stats.norm.ppf(power))
    return float((z_alpha + z_beta) * sd_of_differences / np.sqrt(n))
