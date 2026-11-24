"""LLM gateway (PRD 7.3, 12.1).

Rules that hold whatever provider is configured:

- Output must satisfy a strict JSON schema. A schema failure is retried once with the
  validation errors attached, then returned as a partial draft with the failing fields
  left blank, so the officer is never blocked.
- The model may not produce baseline or target numbers the officer did not supply. A
  post-check compares every number in the output against numbers in the input and
  replaces anything invented with "to be measured", flagged for the officer.
- Names, phone numbers, emails and identifier-like strings are redacted before text
  leaves the platform.
- Prompts are versioned; every draft records the model, the prompt version and the
  token usage.

The mock provider is not a stub that returns a fixed string. It is a deterministic
rule-based drafter over a library of public-service outcome measures, so the whole
Challenge Builder path, including the no-invented-numbers check, works offline and in
tests with no external dependency.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.core.security import redact
from app.services.adapters.base import CircuitBreaker, CircuitOpen

log = get_logger(__name__)

PROMPT_VERSION = "challenge-draft-v1.3"

CHALLENGE_DRAFT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["title", "outcome_statement", "kpis", "eligibility_notes", "rubric"],
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string", "minLength": 10, "maxLength": 240},
        "outcome_statement": {"type": "string", "minLength": 30},
        "current_situation": {"type": "string"},
        "constraints": {"type": "string"},
        "pilot_scope": {"type": "string"},
        "kpis": {
            "type": "array",
            "minItems": 2,
            "maxItems": 5,
            "items": {
                "type": "object",
                "required": ["name", "unit", "direction", "baseline_method"],
                "properties": {
                    "name": {"type": "string"},
                    "unit": {"type": "string"},
                    "kind": {"type": "string", "enum": ["continuous", "proportion"]},
                    "direction": {"type": "string", "enum": ["lower", "higher"]},
                    "baseline_value": {"type": ["number", "null"]},
                    "baseline_source": {"type": "string"},
                    "baseline_method": {"type": "string"},
                    "target_value": {"type": ["number", "null"]},
                    "is_primary": {"type": "boolean"},
                },
            },
        },
        "eligibility_notes": {"type": "string"},
        "rubric": {
            "type": "array",
            "minItems": 3,
            "maxItems": 7,
            "items": {
                "type": "object",
                "required": ["name", "weight", "description"],
                "properties": {
                    "name": {"type": "string"},
                    "weight": {"type": "integer", "minimum": 5, "maximum": 40},
                    "description": {"type": "string"},
                    "anchors": {"type": "object"},
                },
            },
        },
    },
}


@dataclass
class LlmUsage:
    provider: str
    model: str
    prompt_version: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int
    cached: bool = False
    degraded: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DraftResult:
    draft: dict[str, Any]
    usage: LlmUsage
    schema_valid: bool
    invented_numbers_removed: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "draft": self.draft,
            "usage": self.usage.to_dict(),
            "schema_valid": self.schema_valid,
            "invented_numbers_removed": self.invented_numbers_removed,
            "warnings": self.warnings,
        }


NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")


def numbers_in(text: str) -> set[str]:
    """Every number mentioned in the officer's own words, normalised for comparison."""
    out: set[str] = set()
    for token in NUMBER_RE.findall(text or ""):
        value = float(token)
        out.add(str(int(value)) if value.is_integer() else str(value))
    return out


def strip_invented_numbers(
    draft: dict[str, Any], source_numbers: set[str]
) -> tuple[dict[str, Any], list[str]]:
    """Replace any numeric baseline or target the officer did not supply (PRD 12.1)."""
    removed: list[str] = []
    for kpi in draft.get("kpis", []):
        for field_name in ("baseline_value", "target_value"):
            value = kpi.get(field_name)
            if value is None:
                continue
            normalised = str(int(value)) if float(value).is_integer() else str(float(value))
            if normalised not in source_numbers:
                kpi[field_name] = None
                kpi.setdefault("flags", []).append(field_name + " to be measured")
                removed.append(kpi.get("name", "measure") + ": " + field_name)
    return draft, removed


def validate_against_schema(draft: dict[str, Any]) -> list[str]:
    """Minimal structural validation. Enough to catch the failures that matter here."""
    errors: list[str] = []
    for key in CHALLENGE_DRAFT_SCHEMA["required"]:
        if key not in draft or draft[key] in (None, "", []):
            errors.append("Field " + key + " is missing.")
    kpis = draft.get("kpis") or []
    if not isinstance(kpis, list) or not (2 <= len(kpis) <= 5):
        errors.append("Between 2 and 5 measures are required.")
    for index, kpi in enumerate(kpis if isinstance(kpis, list) else []):
        for key in ("name", "unit", "direction", "baseline_method"):
            if not kpi.get(key):
                errors.append("Measure " + str(index + 1) + " is missing " + key + ".")
        if kpi.get("direction") not in ("lower", "higher"):
            errors.append("Measure " + str(index + 1) + " has an invalid direction.")
    rubric = draft.get("rubric") or []
    if not isinstance(rubric, list) or not (3 <= len(rubric) <= 7):
        errors.append("Between 3 and 7 rubric criteria are required.")
    total_weight = sum(int(c.get("weight", 0)) for c in rubric if isinstance(c, dict))
    if rubric and total_weight != 100:
        errors.append("Rubric weights must sum to 100; they currently sum to " + str(total_weight) + ".")
    return errors


# ---------------------------------------------------------------------------
# Domain library used by the deterministic drafter
# ---------------------------------------------------------------------------

DOMAIN_LIBRARY: list[dict[str, Any]] = [
    {
        "keys": ["leak", "leakage", "non-revenue water", "pipeline", "water supply", "nrw"],
        "sector": "Water",
        "category": "Water loss reduction",
        "kpis": [
            {
                "name": "Non-revenue water",
                "unit": "percent of water supplied",
                "kind": "proportion",
                "direction": "lower",
                "baseline_source": "Monthly district metering area water balance",
                "baseline_method": "Water supplied into the district metering area minus billed "
                "authorised consumption, expressed as a percentage of water supplied, computed "
                "weekly from bulk meter readings.",
            },
            {
                "name": "Average leak detection to repair time",
                "unit": "hours",
                "kind": "continuous",
                "direction": "lower",
                "baseline_source": "Complaint and works management register",
                "baseline_method": "Time from leak first reported or detected to repair completion, "
                "averaged across all repairs closed in the week.",
            },
            {
                "name": "Supply hours per day",
                "unit": "hours per day",
                "kind": "continuous",
                "direction": "higher",
                "baseline_source": "Pump house operation log",
                "baseline_method": "Hours of pressurised supply per zone per day, averaged weekly.",
            },
        ],
    },
    {
        "keys": ["waste", "garbage", "solid waste", "landfill", "segregation", "collection"],
        "sector": "Urban solid waste",
        "category": "Waste management",
        "kpis": [
            {
                "name": "Source segregation compliance",
                "unit": "percent of households",
                "kind": "proportion",
                "direction": "higher",
                "baseline_source": "Ward-level collection audit",
                "baseline_method": "Share of households handing over segregated waste, sampled "
                "weekly across the ward by the collection supervisor.",
            },
            {
                "name": "Missed collection complaints",
                "unit": "complaints per thousand households per week",
                "kind": "continuous",
                "direction": "lower",
                "baseline_source": "Municipal grievance system",
                "baseline_method": "Count of missed collection complaints per week normalised by "
                "the number of households served.",
            },
            {
                "name": "Waste diverted from landfill",
                "unit": "percent of tonnage",
                "kind": "proportion",
                "direction": "higher",
                "baseline_source": "Weighbridge records",
                "baseline_method": "Tonnage processed or recycled as a share of total tonnage "
                "collected, from daily weighbridge slips.",
            },
        ],
    },
    {
        "keys": ["traffic", "congestion", "junction", "signal", "commute", "travel time"],
        "sector": "Urban mobility",
        "category": "Traffic management",
        "kpis": [
            {
                "name": "Average junction delay",
                "unit": "seconds per vehicle",
                "kind": "continuous",
                "direction": "lower",
                "baseline_source": "Junction survey and signal controller logs",
                "baseline_method": "Mean delay per vehicle at the junction during the morning and "
                "evening peak, measured by the controller and validated by manual counts.",
            },
            {
                "name": "Peak hour queue length",
                "unit": "metres",
                "kind": "continuous",
                "direction": "lower",
                "baseline_source": "Camera-based queue measurement",
                "baseline_method": "Maximum queue length on the critical approach during the peak "
                "hour, averaged across working days in the week.",
            },
            {
                "name": "Signal compliance",
                "unit": "percent of cycles",
                "kind": "proportion",
                "direction": "higher",
                "baseline_source": "Enforcement camera records",
                "baseline_method": "Share of signal cycles without a red-light violation, weekly.",
            },
        ],
    },
    {
        "keys": ["health", "patient", "hospital", "clinic", "screening", "diagnos", "anaemia"],
        "sector": "Public health",
        "category": "Health service delivery",
        "kpis": [
            {
                "name": "Screening coverage",
                "unit": "percent of eligible population",
                "kind": "proportion",
                "direction": "higher",
                "baseline_source": "Facility screening register",
                "baseline_method": "People screened as a share of the eligible population in the "
                "catchment, compiled weekly from facility registers.",
            },
            {
                "name": "Time from test to result",
                "unit": "hours",
                "kind": "continuous",
                "direction": "lower",
                "baseline_source": "Laboratory information register",
                "baseline_method": "Time from sample collection to result communicated to the "
                "patient, averaged weekly.",
            },
            {
                "name": "Follow-up completion",
                "unit": "percent of referrals",
                "kind": "proportion",
                "direction": "higher",
                "baseline_source": "Referral tracking register",
                "baseline_method": "Share of referred patients who completed the follow-up visit "
                "within the protocol window.",
            },
        ],
    },
    {
        "keys": ["crop", "farmer", "agri", "irrigation", "yield", "soil", "pest"],
        "sector": "Agriculture",
        "category": "Agricultural productivity",
        "kpis": [
            {
                "name": "Yield per hectare",
                "unit": "quintals per hectare",
                "kind": "continuous",
                "direction": "higher",
                "baseline_source": "Crop cutting experiments",
                "baseline_method": "Yield measured by crop cutting experiments on sampled plots, "
                "recorded per season and reported weekly during harvest.",
            },
            {
                "name": "Irrigation water use",
                "unit": "cubic metres per hectare",
                "kind": "continuous",
                "direction": "lower",
                "baseline_source": "Pump energy meters and flow meters",
                "baseline_method": "Water applied per hectare per week, from flow meters on the "
                "sampled plots.",
            },
            {
                "name": "Advisory adoption",
                "unit": "percent of advised farmers",
                "kind": "proportion",
                "direction": "higher",
                "baseline_source": "Field officer verification",
                "baseline_method": "Share of farmers who acted on the advisory, verified by the "
                "field officer on a weekly sample.",
            },
        ],
    },
    {
        "keys": ["energy", "electricity", "power", "solar", "consumption", "street light"],
        "sector": "Energy",
        "category": "Energy efficiency",
        "kpis": [
            {
                "name": "Energy consumption per unit served",
                "unit": "kilowatt hours per unit per week",
                "kind": "continuous",
                "direction": "lower",
                "baseline_source": "Smart meter readings",
                "baseline_method": "Metered consumption per asset per week from the utility meter.",
            },
            {
                "name": "Asset uptime",
                "unit": "percent of scheduled hours",
                "kind": "proportion",
                "direction": "higher",
                "baseline_source": "Maintenance management system",
                "baseline_method": "Hours in service as a share of scheduled hours, weekly.",
            },
            {
                "name": "Fault resolution time",
                "unit": "hours",
                "kind": "continuous",
                "direction": "lower",
                "baseline_source": "Complaint register",
                "baseline_method": "Time from fault reported to restoration, averaged weekly.",
            },
        ],
    },
]

GENERIC_KPIS: list[dict[str, Any]] = [
    {
        "name": "Service turnaround time",
        "unit": "hours",
        "kind": "continuous",
        "direction": "lower",
        "baseline_source": "Departmental service register",
        "baseline_method": "Time from request received to service delivered, averaged weekly "
        "across all requests closed in the week.",
    },
    {
        "name": "Cases resolved within the service standard",
        "unit": "percent of cases",
        "kind": "proportion",
        "direction": "higher",
        "baseline_source": "Departmental service register",
        "baseline_method": "Share of cases closed within the published service standard, weekly.",
    },
    {
        "name": "Cost per case handled",
        "unit": "rupees per case",
        "kind": "continuous",
        "direction": "lower",
        "baseline_source": "Departmental expenditure statement",
        "baseline_method": "Operating cost attributable to the service divided by cases handled "
        "in the same period, computed monthly and apportioned weekly.",
    },
]

DEFAULT_RUBRIC: list[dict[str, Any]] = [
    {
        "name": "Fit to the stated outcome",
        "weight": 25,
        "description": "How directly the proposed solution addresses the outcome and the primary "
        "measure named in this challenge.",
        "anchors": {
            "1": "Addresses a different problem.",
            "2": "Addresses part of the problem, with a weak link to the primary measure.",
            "3": "Addresses the problem but the link to the primary measure is indirect.",
            "4": "Addresses the problem and moves the primary measure directly.",
            "5": "Addresses the problem, moves the primary measure directly, and explains the "
            "mechanism with evidence.",
        },
    },
    {
        "name": "Technical soundness",
        "weight": 25,
        "description": "Whether the approach, architecture and measurement method would work in "
        "the department's operating conditions.",
        "anchors": {
            "1": "Approach is not workable as described.",
            "2": "Approach is plausible but major gaps are unaddressed.",
            "3": "Approach is workable with known risks and no mitigation.",
            "4": "Approach is workable and risks are identified with mitigation.",
            "5": "Approach is workable, risks are mitigated, and the measurement method is "
            "specified in detail.",
        },
    },
    {
        "name": "Evidence of prior results",
        "weight": 15,
        "description": "Quality of any earlier measured results, in any setting. Absence of prior "
        "government work is not penalised.",
        "anchors": {
            "1": "No results of any kind offered.",
            "2": "Claims without measurement.",
            "3": "Internal measurement only.",
            "4": "Measured results from a comparable deployment.",
            "5": "Independently verified results from a comparable deployment.",
        },
    },
    {
        "name": "Delivery capability",
        "weight": 15,
        "description": "Team, timeline and support model against the pilot scope.",
        "anchors": {
            "1": "No credible plan to deliver the pilot.",
            "2": "Plan present but the team or timeline is not credible.",
            "3": "Credible plan with thin support arrangements.",
            "4": "Credible plan with a defined support model.",
            "5": "Credible plan, defined support model, and named accountable people.",
        },
    },
    {
        "name": "Value for money",
        "weight": 10,
        "description": "Pilot cost against the outcome promised, and the indicative cost of "
        "scaling if the pilot succeeds.",
        "anchors": {
            "1": "Cost is not justified by the outcome offered.",
            "2": "Cost is high for the outcome offered.",
            "3": "Cost is reasonable for the pilot but scaling cost is unclear.",
            "4": "Cost is reasonable and scaling cost is indicated.",
            "5": "Cost is well justified and the scaling cost is itemised.",
        },
    },
    {
        "name": "Data protection and cybersecurity",
        "weight": 10,
        "description": "Handling of departmental and personal data, hosting, access control and "
        "the exit position, aligned to the Digital Personal Data Protection Act, 2023.",
        "anchors": {
            "1": "No data handling position stated.",
            "2": "Position stated but not compliant.",
            "3": "Compliant position with gaps in access control or retention.",
            "4": "Compliant position with access control, retention and deletion specified.",
            "5": "Compliant position with independent assurance and a tested export path.",
        },
    },
]


def _select_domain(text: str) -> dict[str, Any] | None:
    lowered = (text or "").lower()
    best: tuple[int, dict[str, Any]] | None = None
    for entry in DOMAIN_LIBRARY:
        hits = sum(1 for key in entry["keys"] if key in lowered)
        if hits and (best is None or hits > best[0]):
            best = (hits, entry)
    return best[1] if best else None


def _title_from(text: str, department_name: str, domain: dict[str, Any] | None) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    first_sentence = cleaned.split(".")[0][:120] if cleaned else ""
    subject = domain["category"] if domain else "service outcome improvement"
    place = department_name.replace(" Department", "").strip()
    if first_sentence:
        return (subject + " in " + place)[:200]
    return ("Improving " + subject + " in " + place)[:200]


class LlmProvider:
    name = "provider"

    async def draft_challenge(self, prompt: dict[str, Any]) -> tuple[dict[str, Any], LlmUsage]:
        raise NotImplementedError


class MockLlmProvider(LlmProvider):
    """Deterministic rule-based drafter. No network, no invented numbers, fully testable."""

    name = "mock"

    async def draft_challenge(self, prompt: dict[str, Any]) -> tuple[dict[str, Any], LlmUsage]:
        started = time.perf_counter()
        problem: str = prompt.get("problem_statement", "")
        situation: str = prompt.get("current_situation", "")
        department: str = prompt.get("department_name", "the department")
        constraints: str = prompt.get("constraints", "")
        combined = problem + "\n" + situation

        domain = _select_domain(combined)
        kpi_library = list(domain["kpis"]) if domain else list(GENERIC_KPIS)

        kpis: list[dict[str, Any]] = []
        for index, item in enumerate(kpi_library[:3]):
            kpis.append(
                {
                    **item,
                    "baseline_value": None,
                    "target_value": None,
                    "is_primary": index == 0,
                }
            )

        title = _title_from(problem, department, domain)
        primary = kpis[0]["name"].lower() if kpis else "the primary measure"

        outcome = (
            "Reduce " if kpis and kpis[0]["direction"] == "lower" else "Increase "
        ) + primary + (
            " in the pilot area within the pilot period, measured by the method recorded "
            "against that measure, against a baseline collected before the pilot starts. "
            "The solution must work within existing departmental processes and must not "
            "require citizens to change how they access the service."
        )

        situation_text = situation.strip() or (
            "The department currently relies on manual reporting for this service. The baseline "
            "for each measure below will be collected before the pilot starts, using the method "
            "recorded against that measure."
        )

        constraints_text = constraints.strip() or (
            "Data must be hosted in India. No personal identifiers may be shared with the "
            "startup; the department will anonymise or aggregate any data before transfer. "
            "The solution must not require replacing existing field equipment. Any integration "
            "must use documented interfaces and must not require write access to departmental "
            "systems of record during the pilot."
        )

        pilot_scope = (
            "A controlled pilot in a defined area, running for the duration set by the Pilot "
            "Flight Simulator, with weekly measurement of every measure listed below. The "
            "department will nominate the pilot units and provide read access to the data "
            "sources named in the measurement methods. The startup will deploy, operate and "
            "support the solution for the pilot period and will hand over an export of all "
            "departmental data at the end."
        )

        eligibility = (
            "Open to startups recognised by the Department for Promotion of Industry and "
            "Internal Trade. Prior turnover and prior experience criteria are relaxed for "
            "recognised startups; quality and technical criteria are not relaxed. Applicants "
            "must declare any conflict of interest, state where data will be stored, and "
            "complete the cybersecurity checklist before a pilot can be activated."
        )

        draft = {
            "title": title,
            "outcome_statement": outcome,
            "current_situation": situation_text,
            "constraints": constraints_text,
            "pilot_scope": pilot_scope,
            "kpis": kpis,
            "eligibility_notes": eligibility,
            "rubric": [dict(c) for c in DEFAULT_RUBRIC],
            "sector": domain["sector"] if domain else None,
            "category": domain["category"] if domain else "Service delivery",
        }

        latency = int((time.perf_counter() - started) * 1000)
        usage = LlmUsage(
            provider=self.name,
            model=settings.llm_model,
            prompt_version=PROMPT_VERSION,
            prompt_tokens=len(combined.split()),
            completion_tokens=len(json.dumps(draft).split()),
            latency_ms=latency,
        )
        return draft, usage


class OpenAiCompatibleProvider(LlmProvider):
    """Any provider exposing an OpenAI-compatible chat completions endpoint."""

    name = "openai_compatible"

    async def draft_challenge(self, prompt: dict[str, Any]) -> tuple[dict[str, Any], LlmUsage]:
        import httpx

        started = time.perf_counter()
        system = (
            "You draft public procurement challenge statements for Indian government "
            "departments. Return JSON only, matching the schema given. Never invent baseline "
            "or target numbers: if the officer did not supply a number, use null. Use plain "
            "English. Do not use emojis."
        )
        user = json.dumps(
            {
                "problem_statement": prompt.get("problem_statement", ""),
                "current_situation": prompt.get("current_situation", ""),
                "constraints": prompt.get("constraints", ""),
                "department": prompt.get("department_name", ""),
                "similar_challenges": prompt.get("similar_challenges", []),
                "template_structure": prompt.get("template_structure", {}),
                "schema": CHALLENGE_DRAFT_SCHEMA,
            },
            ensure_ascii=False,
        )
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(
                str(settings.llm_base_url).rstrip("/") + "/chat/completions",
                headers={"Authorization": "Bearer " + str(settings.llm_api_key)},
                json={
                    "model": settings.llm_model,
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
            )
            response.raise_for_status()
            body = response.json()
        content = body["choices"][0]["message"]["content"]
        draft = json.loads(content)
        usage_block = body.get("usage", {})
        usage = LlmUsage(
            provider=self.name,
            model=settings.llm_model,
            prompt_version=PROMPT_VERSION,
            prompt_tokens=int(usage_block.get("prompt_tokens", 0)),
            completion_tokens=int(usage_block.get("completion_tokens", 0)),
            latency_ms=int((time.perf_counter() - started) * 1000),
        )
        return draft, usage


class LlmGateway:
    """Timeouts, retries, caching, redaction, circuit breaking and cost logging."""

    def __init__(self) -> None:
        self.breaker = CircuitBreaker(
            name="llm",
            failures=settings.llm_breaker_failures,
            reset_seconds=settings.llm_breaker_reset_seconds,
        )
        self._cache: dict[str, tuple[dict[str, Any], LlmUsage]] = {}
        self._provider: LlmProvider = (
            MockLlmProvider() if settings.llm_provider == "mock" else OpenAiCompatibleProvider()
        )

    def _cache_key(self, prompt: dict[str, Any]) -> str:
        from app.core.hash import sha256_json

        return sha256_json({"v": PROMPT_VERSION, "p": prompt})

    async def draft_challenge(self, prompt: dict[str, Any]) -> DraftResult:
        """Draft a challenge, degrading to the manual form rather than failing (PRD 10.6)."""
        redacted = {
            key: redact(value) if isinstance(value, str) else value for key, value in prompt.items()
        }
        source_numbers = numbers_in(
            str(redacted.get("problem_statement", "")) + " " + str(redacted.get("current_situation", ""))
        )
        key = self._cache_key(redacted)
        if key in self._cache:
            cached_draft, cached_usage = self._cache[key]
            hit_usage = LlmUsage(**{**cached_usage.to_dict(), "cached": True})
            cleaned, removed = strip_invented_numbers(
                json.loads(json.dumps(cached_draft)), source_numbers
            )
            return DraftResult(cleaned, hit_usage, True, removed, [])

        warnings: list[str] = []
        try:
            self.breaker.guard()
        except CircuitOpen:
            return self._degraded(redacted, "AI drafting is unavailable. Continue with the template.")

        draft: dict[str, Any] | None = None
        usage: LlmUsage | None = None
        last_error = ""
        for attempt in range(1 + settings.llm_max_retries):
            try:
                draft, usage = await self._provider.draft_challenge(redacted)
                errors = validate_against_schema(draft)
                if not errors:
                    self.breaker.record_success()
                    break
                last_error = "; ".join(errors)
                warnings.append(
                    "Draft attempt " + str(attempt + 1) + " did not match the required structure: "
                    + last_error
                )
                redacted = {**redacted, "validation_errors": errors}
            except Exception as exc:
                last_error = str(exc)
                self.breaker.record_failure()
                log.warning("LLM draft attempt failed", attempt=attempt + 1, error=last_error)
                draft = None

        if draft is None:
            return self._degraded(redacted, "AI drafting is unavailable. Continue with the template.")

        errors = validate_against_schema(draft)
        if errors:
            # Return a partial draft with the failing fields blank rather than nothing.
            for key_name in CHALLENGE_DRAFT_SCHEMA["required"]:
                if any(key_name in e for e in errors):
                    draft[key_name] = "" if key_name != "kpis" else []
            warnings.append(
                "Some fields could not be drafted and have been left blank for you to complete: "
                + last_error
            )

        cleaned, removed = strip_invented_numbers(draft, source_numbers)
        if removed:
            warnings.append(
                "Baseline and target values were left blank because they were not in your "
                "description. Enter the measured values, or record how they will be collected."
            )
        assert usage is not None
        self._cache[key] = (json.loads(json.dumps(cleaned)), usage)
        log.info(
            "Challenge draft generated",
            provider=usage.provider,
            model=usage.model,
            prompt_version=usage.prompt_version,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            latency_ms=usage.latency_ms,
        )
        return DraftResult(cleaned, usage, not errors, removed, warnings)

    def _degraded(self, prompt: dict[str, Any], message: str) -> DraftResult:
        usage = LlmUsage(
            provider=self._provider.name,
            model=settings.llm_model,
            prompt_version=PROMPT_VERSION,
            prompt_tokens=0,
            completion_tokens=0,
            latency_ms=0,
            degraded=True,
        )
        return DraftResult(
            draft={},
            usage=usage,
            schema_valid=False,
            invented_numbers_removed=[],
            warnings=[message, "The manual form and the Template Kit remain available."],
        )

    def health(self) -> dict[str, Any]:
        return {
            "provider": self._provider.name,
            "model": settings.llm_model,
            "prompt_version": PROMPT_VERSION,
            "breaker": self.breaker.state(),
            "cached_drafts": len(self._cache),
        }


_gateway: LlmGateway | None = None


def get_llm_gateway() -> LlmGateway:
    global _gateway
    if _gateway is None:
        _gateway = LlmGateway()
    return _gateway
