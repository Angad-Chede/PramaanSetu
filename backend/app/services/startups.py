"""Startup registry (PRD 5.2) and matching (PRD 5.3, 12.2)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import NotFound, ValidationFailed
from app.core.policy import Principal
from app.domain.matching import MatchCandidate, keyword_only_fallback, rank_candidates
from app.domain.states import DpiitStatus, Role
from app.models.challenge import Challenge
from app.models.startup import ChallengeEmbedding, MatchResult, Startup, StartupEmbedding
from app.services import audit, embeddings, outbox
from app.services.adapters.dpiit import get_dpiit_adapter


async def get(session: AsyncSession, startup_id: str) -> Startup:
    startup = await session.get(Startup, startup_id)
    if startup is None:
        raise NotFound("This startup profile was not found.")
    return startup


async def register(
    session: AsyncSession,
    principal: Principal,
    *,
    legal_name: str,
    cin: str | None,
    dpiit_number: str | None,
    sectors: list[str],
    product_description: str,
    capability_text: str,
    contact_name: str,
    contact_email: str,
    **extra: Any,
) -> Startup:
    existing = await session.execute(select(Startup).where(Startup.legal_name == legal_name))
    if existing.scalar_one_or_none() is not None:
        raise ValidationFailed(
            "A startup with this legal name is already registered.",
            errors=[
                {
                    "field": "legal_name",
                    "detail": "This legal name is already on the registry.",
                    "fix": "Ask the existing account holder to add you as a user, or contact the "
                    "platform administrator.",
                }
            ],
        )
    startup = Startup(
        legal_name=legal_name,
        cin=cin,
        dpiit_number=dpiit_number,
        sectors=sectors,
        product_description=product_description,
        capability_text=capability_text,
        contact_name=contact_name,
        contact_email=contact_email,
        dpiit_status=DpiitStatus.PENDING,
        **{k: v for k, v in extra.items() if hasattr(Startup, k)},
    )
    session.add(startup)
    await session.flush()
    await session.refresh(startup)

    await audit.record(
        session,
        action="startup.registered",
        entity_type="startup",
        entity_id=startup.id,
        actor_id=principal.user_id,
        actor_role=Role.STARTUP_USER,
        after={"legal_name": legal_name, "dpiit_number": dpiit_number},
    )
    outbox.emit(
        session,
        aggregate_type="startup",
        aggregate_id=startup.id,
        event_type="startup.registered",
        payload={"legal_name": legal_name},
    )
    return startup


async def verify_dpiit(
    session: AsyncSession, startup: Startup, principal: Principal | None = None
) -> dict[str, Any]:
    """Run the recognition check through the adapter and store the result (FR-SR-02)."""
    adapter = get_dpiit_adapter()
    result = await adapter.verify(
        recognition_number=startup.dpiit_number, legal_name=startup.legal_name
    )
    before = startup.dpiit_status
    startup.dpiit_status = result.status
    startup.dpiit_checked_at = utcnow()
    startup.version = (startup.version or 0) + 1
    await session.flush()

    await audit.record(
        session,
        action="startup.dpiit_checked",
        entity_type="startup",
        entity_id=startup.id,
        actor_id=principal.user_id if principal else None,
        actor_role=Role.STARTUP_USER if principal else Role.PLATFORM_ADMIN,
        before={"dpiit_status": before},
        after={"dpiit_status": startup.dpiit_status, "source": result.source},
        reason=result.detail,
    )
    outbox.emit(
        session,
        aggregate_type="startup",
        aggregate_id=startup.id,
        event_type="startup.dpiit_checked",
        payload={"status": result.status, "detail": result.detail},
    )
    return {
        "status": result.status,
        "detail": result.detail,
        "checked_at": startup.dpiit_checked_at.isoformat(),
        "source": result.source,
        "recognition_number": result.recognition_number,
    }


async def update_profile(
    session: AsyncSession, startup: Startup, principal: Principal, changes: dict[str, Any]
) -> Startup:
    if "case_references" in changes and len(changes["case_references"] or []) > 5:
        raise ValidationFailed(
            "A profile can carry at most 5 case references.",
            errors=[
                {
                    "field": "case_references",
                    "detail": str(len(changes["case_references"])) + " were supplied.",
                    "fix": "Keep the 5 most relevant references and remove the rest.",
                }
            ],
        )
    identity_changed = False
    for key, value in changes.items():
        if not hasattr(startup, key) or key in ("id", "version", "created_at", "dpiit_status"):
            continue
        if key in ("capability_text", "product_description", "sectors", "legal_name", "case_references"):
            identity_changed = True
        setattr(startup, key, value)
    if "dpiit_number" in changes:
        startup.dpiit_status = DpiitStatus.PENDING
        startup.dpiit_checked_at = None
    startup.version = (startup.version or 0) + 1
    await session.flush()

    await audit.record(
        session,
        action="startup.profile_changed",
        entity_type="startup",
        entity_id=startup.id,
        actor_id=principal.user_id,
        actor_role=Role.STARTUP_USER,
        after={"fields": sorted(changes.keys())},
    )
    if identity_changed:
        outbox.emit(
            session,
            aggregate_type="startup",
            aggregate_id=startup.id,
            event_type="startup.profile_changed",
            payload={"reason": "capability text changed, embedding refresh needed"},
        )
    return startup


async def refresh_embedding(session: AsyncSession, startup: Startup) -> bool:
    """Recompute only when the source text hash changed (PRD 12.2)."""
    corpus = startup.capability_corpus
    digest = embeddings.content_hash_of(corpus)
    existing = await session.execute(
        select(StartupEmbedding).where(StartupEmbedding.startup_id == startup.id)
    )
    record = existing.scalar_one_or_none()
    if record is not None and record.content_hash == digest:
        return False

    result = await embeddings.embed_text(corpus)
    if record is None:
        record = StartupEmbedding(
            startup_id=startup.id,
            model=result.model,
            dimensions=result.dimensions,
            vector=result.vector,
            content_hash=digest,
        )
        session.add(record)
    else:
        record.model = result.model
        record.dimensions = result.dimensions
        record.vector = result.vector
        record.content_hash = digest
    await session.flush()
    return True


async def refresh_challenge_embedding(session: AsyncSession, challenge: Challenge, text: str) -> bool:
    digest = embeddings.content_hash_of(text)
    existing = await session.execute(
        select(ChallengeEmbedding).where(ChallengeEmbedding.challenge_id == challenge.id)
    )
    record = existing.scalar_one_or_none()
    if record is not None and record.content_hash == digest:
        return False
    result = await embeddings.embed_text(text)
    if record is None:
        session.add(
            ChallengeEmbedding(
                challenge_id=challenge.id,
                model=result.model,
                dimensions=result.dimensions,
                vector=result.vector,
                content_hash=digest,
            )
        )
    else:
        record.model = result.model
        record.dimensions = result.dimensions
        record.vector = result.vector
        record.content_hash = digest
    await session.flush()
    return True


async def compute_matches(
    session: AsyncSession, challenge: Challenge, challenge_text: str, *, limit: int = 20
) -> list[MatchResult]:
    """Rank startups and store the result with the reasons shown to the officer."""
    challenge_vector_row = await session.execute(
        select(ChallengeEmbedding.vector).where(ChallengeEmbedding.challenge_id == challenge.id)
    )
    challenge_vector = challenge_vector_row.scalar_one_or_none() or []

    rows = await session.execute(
        select(Startup, StartupEmbedding.vector).join(
            StartupEmbedding, StartupEmbedding.startup_id == Startup.id, isouter=True
        ).where(Startup.archived_at.is_(None))
    )
    candidates: list[MatchCandidate] = []
    for startup, vector in rows.all():
        candidates.append(
            MatchCandidate(
                startup_id=startup.id,
                legal_name=startup.legal_name,
                sectors=list(startup.sectors or []),
                state_code=startup.state_code,
                district=startup.district,
                capability_text=startup.capability_corpus,
                embedding=list(vector or []),
            )
        )

    if challenge_vector:
        ranked = rank_candidates(
            challenge_text=challenge_text,
            challenge_sector=challenge.sector,
            challenge_state_code=challenge.state_code,
            challenge_district=challenge.district,
            challenge_embedding=list(challenge_vector),
            candidates=candidates,
            limit=limit,
        )
    else:
        ranked = keyword_only_fallback(
            challenge_text=challenge_text,
            challenge_sector=challenge.sector,
            candidates=candidates,
            limit=limit,
        )

    existing = await session.execute(
        select(MatchResult).where(MatchResult.challenge_id == challenge.id)
    )
    by_startup = {row.startup_id: row for row in existing.scalars().all()}

    stored: list[MatchResult] = []
    for position, outcome in enumerate(ranked, start=1):
        record = by_startup.get(outcome.startup_id)
        if record is None:
            record = MatchResult(
                challenge_id=challenge.id,
                startup_id=outcome.startup_id,
                score=outcome.score,
                components=outcome.components,
                reasons=outcome.reasons,
                rank=position,
            )
            session.add(record)
        else:
            record.score = outcome.score
            record.components = outcome.components
            record.reasons = outcome.reasons
            record.rank = position
        stored.append(record)
    await session.flush()
    return stored


async def matches_for(session: AsyncSession, challenge_id: str, limit: int = 20) -> list[MatchResult]:
    rows = await session.execute(
        select(MatchResult)
        .where(MatchResult.challenge_id == challenge_id)
        .order_by(MatchResult.rank.asc())
        .limit(limit)
    )
    return list(rows.scalars().all())


async def mark_invited(session: AsyncSession, match: MatchResult) -> None:
    match.invited_at = utcnow()
    await session.flush()
