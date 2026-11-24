"""Startup matching (PRD 12.2).

    match = 0.60 * cosine(e_challenge, e_startup)
          + 0.20 * keyword
          + 0.15 * sector
          + 0.05 * location

Weights are configuration, not code, so they can be tuned on a labelled set without a
release. Every reason shown to the officer comes from a component of this sum, never
from a model's free text, so the ranking is always explainable.

Matching never restricts who may apply (FR-DM-04).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

WEIGHTS: dict[str, float] = {
    "semantic": 0.60,
    "keyword": 0.20,
    "sector": 0.15,
    "location": 0.05,
}

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in",
    "is", "it", "its", "of", "on", "or", "that", "the", "to", "was", "were", "will", "with",
    "we", "our", "their", "this", "these", "those", "can", "which", "using", "used", "use",
}

TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenise(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall((text or "").lower()) if t not in STOPWORDS and len(t) > 2]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return max(0.0, min(1.0, dot / (na * nb)))


def keyword_rank(challenge_text: str, startup_text: str) -> tuple[float, list[str]]:
    """Normalised overlap of meaningful terms, with the matched terms returned as reasons."""
    challenge_terms = set(tokenise(challenge_text))
    startup_terms = set(tokenise(startup_text))
    if not challenge_terms:
        return (0.0, [])
    shared = challenge_terms & startup_terms
    # Longer terms carry more signal than short common ones.
    weight = sum(min(len(t), 12) for t in shared)
    ceiling = sum(min(len(t), 12) for t in challenge_terms)
    score = weight / ceiling if ceiling else 0.0
    ranked = sorted(shared, key=lambda t: (-len(t), t))[:6]
    return (max(0.0, min(1.0, score)), ranked)


@dataclass
class MatchCandidate:
    startup_id: str
    legal_name: str
    sectors: list[str]
    state_code: str | None
    district: str | None
    capability_text: str
    embedding: list[float] = field(default_factory=list)


@dataclass
class MatchOutcome:
    startup_id: str
    score: float
    components: dict[str, float]
    reasons: list[str]


def score_candidate(
    *,
    challenge_text: str,
    challenge_sector: str | None,
    challenge_state_code: str | None,
    challenge_district: str | None,
    challenge_embedding: list[float],
    candidate: MatchCandidate,
    weights: dict[str, float] | None = None,
) -> MatchOutcome:
    w = {**WEIGHTS, **(weights or {})}

    semantic = cosine(challenge_embedding, candidate.embedding)
    keyword, matched_terms = keyword_rank(challenge_text, candidate.capability_text)

    sector_tags = {str(s).strip().lower() for s in candidate.sectors or []}
    sector = 1.0 if challenge_sector and challenge_sector.strip().lower() in sector_tags else 0.0

    location = 0.0
    if challenge_state_code and candidate.state_code == challenge_state_code:
        location = 1.0
        if challenge_district and candidate.district == challenge_district:
            location = 1.0

    score = (
        w["semantic"] * semantic
        + w["keyword"] * keyword
        + w["sector"] * sector
        + w["location"] * location
    )

    reasons: list[str] = []
    if sector:
        reasons.append("Sector match: " + str(challenge_sector))
    if matched_terms:
        reasons.append("Capability mentions " + ", ".join(matched_terms[:3]))
    if semantic >= 0.45:
        reasons.append(
            "Overall description is close to this problem ("
            + str(round(semantic * 100))
            + " percent similarity)"
        )
    if location:
        reasons.append(
            "Registered in " + str(candidate.state_code) + ", the state named in the challenge"
        )
    if not reasons:
        reasons.append("Weak match on all four factors; shown for completeness only")

    return MatchOutcome(
        startup_id=candidate.startup_id,
        score=round(score, 6),
        components={
            "semantic": round(semantic, 6),
            "keyword": round(keyword, 6),
            "sector": sector,
            "location": location,
        },
        reasons=reasons[:3],
    )


def rank_candidates(
    *,
    challenge_text: str,
    challenge_sector: str | None,
    challenge_state_code: str | None,
    challenge_district: str | None,
    challenge_embedding: list[float],
    candidates: list[MatchCandidate],
    limit: int = 20,
    weights: dict[str, float] | None = None,
) -> list[MatchOutcome]:
    scored = [
        score_candidate(
            challenge_text=challenge_text,
            challenge_sector=challenge_sector,
            challenge_state_code=challenge_state_code,
            challenge_district=challenge_district,
            challenge_embedding=challenge_embedding,
            candidate=candidate,
            weights=weights,
        )
        for candidate in candidates
    ]
    scored.sort(key=lambda m: (-m.score, m.startup_id))
    return scored[:limit]


def keyword_only_fallback(
    *,
    challenge_text: str,
    challenge_sector: str | None,
    candidates: list[MatchCandidate],
    limit: int = 20,
) -> list[MatchOutcome]:
    """Used when the embedding provider is unavailable (PRD 10.6 degradation table)."""
    out: list[MatchOutcome] = []
    for candidate in candidates:
        keyword, matched = keyword_rank(challenge_text, candidate.capability_text)
        sector_tags = {str(s).strip().lower() for s in candidate.sectors or []}
        sector = 1.0 if challenge_sector and challenge_sector.strip().lower() in sector_tags else 0.0
        score = 0.7 * keyword + 0.3 * sector
        reasons = []
        if sector:
            reasons.append("Sector match: " + str(challenge_sector))
        if matched:
            reasons.append("Capability mentions " + ", ".join(matched[:3]))
        reasons.append("Ranked on keywords and sector only; semantic matching is unavailable")
        out.append(
            MatchOutcome(
                startup_id=candidate.startup_id,
                score=round(score, 6),
                components={"semantic": 0.0, "keyword": round(keyword, 6), "sector": sector, "location": 0.0},
                reasons=reasons[:3],
            )
        )
    out.sort(key=lambda m: (-m.score, m.startup_id))
    return out[:limit]


def explain_weights() -> list[dict[str, Any]]:
    return [
        {"component": "semantic", "weight": WEIGHTS["semantic"],
         "description": "How close the startup description is to the problem description in meaning."},
        {"component": "keyword", "weight": WEIGHTS["keyword"],
         "description": "Direct overlap of the terms used in both texts."},
        {"component": "sector", "weight": WEIGHTS["sector"],
         "description": "Whether the startup lists the sector of the challenge."},
        {"component": "location", "weight": WEIGHTS["location"],
         "description": "Whether the startup is registered in the state named in the challenge."},
    ]
