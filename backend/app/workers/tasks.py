"""Job handlers (PRD 7.3, 7.5, 10.5).

Every handler is idempotent: it checks the target entity state before acting and writes
its result with a conditional update, so a redelivered task after a worker crash cannot
apply anything twice.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import format_ist, utcnow
from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.policy import Principal
from app.domain.states import Role
from app.models.challenge import Challenge
from app.models.evidence import EvidenceReport
from app.models.identity import AppUser, RoleAssignment
from app.models.payment import Milestone
from app.models.pilot import Pilot
from app.models.startup import MatchResult, Startup
from app.services import challenges as challenges_service
from app.services import notifications, outbox, scale, simulation, startups

log = get_logger(__name__)

Handler = Callable[[AsyncSession, dict[str, Any]], Awaitable[dict[str, Any]]]
_HANDLERS: dict[str, Handler] = {}

# Validation errors fail immediately; everything else is retried with backoff.
NON_RETRYABLE = (AppError,)


def handler(job_type: str) -> Callable[[Handler], Handler]:
    def wrapper(fn: Handler) -> Handler:
        _HANDLERS[job_type] = fn
        return fn

    return wrapper


def get_handler(job_type: str) -> Handler | None:
    return _HANDLERS.get(job_type)


def registered_types() -> tuple[str, ...]:
    return tuple(sorted(_HANDLERS))


# --- AI and matching -------------------------------------------------------


@handler("challenge.ai_draft")
async def _ai_draft(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    from app.services.llm import get_llm_gateway

    challenge = await session.get(Challenge, payload["challenge_id"])
    if challenge is None:
        return {"skipped": "challenge not found"}

    gateway = get_llm_gateway()
    result = await gateway.draft_challenge(
        {
            "problem_statement": payload.get("problem_statement") or challenge.problem_statement,
            "current_situation": payload.get("current_situation") or challenge.current_situation,
            "constraints": payload.get("constraints") or challenge.constraints,
            "department_name": challenge.department.name if challenge.department else "",
        }
    )
    if result.draft:
        user = await session.get(AppUser, payload["actor_id"])
        principal = Principal(
            user_id=payload["actor_id"],
            name=user.name if user else "",
            email=user.email if user else "",
            department_id=challenge.department_id,
        )
        await challenges_service.apply_draft(session, challenge, result.draft, overwrite=True)
        challenge.ai_draft_meta = {
            "model": result.usage.model,
            "provider": result.usage.provider,
            "prompt_version": result.usage.prompt_version,
            "prompt_tokens": result.usage.prompt_tokens,
            "completion_tokens": result.usage.completion_tokens,
            "latency_ms": result.usage.latency_ms,
            "cached": result.usage.cached,
            "generated_at": utcnow().isoformat(),
            "warnings": result.warnings,
            "numbers_removed": result.invented_numbers_removed,
        }
        await session.flush()
        from app.services import audit

        await audit.record(
            session,
            action="challenge.ai_draft_applied",
            entity_type="challenge",
            entity_id=challenge.id,
            actor_id=principal.user_id,
            actor_role=Role.DEPARTMENT_OFFICER,
            department_id=challenge.department_id,
            after=challenge.ai_draft_meta,
        )
    return result.to_dict()


@handler("challenge.embed_and_match")
async def _embed_and_match(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    challenge = await session.get(Challenge, payload["challenge_id"])
    if challenge is None:
        return {"skipped": "challenge not found"}

    text = challenges_service.challenge_text(challenge)
    await startups.refresh_challenge_embedding(session, challenge, text)

    rows = await session.execute(select(Startup).where(Startup.archived_at.is_(None)))
    refreshed = 0
    for startup in rows.scalars().all():
        if await startups.refresh_embedding(session, startup):
            refreshed += 1

    matches = await startups.compute_matches(session, challenge, text, limit=25)
    return {"matches": len(matches), "startup_embeddings_refreshed": refreshed}


@handler("startup.refresh_embedding")
async def _refresh_startup_embedding(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    startup = await session.get(Startup, payload["startup_id"])
    if startup is None:
        return {"skipped": "startup not found"}
    changed = await startups.refresh_embedding(session, startup)
    return {"recomputed": changed}


@handler("startup.verify_dpiit")
async def _verify_dpiit(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    startup = await session.get(Startup, payload["startup_id"])
    if startup is None:
        return {"skipped": "startup not found"}
    return await startups.verify_dpiit(session, startup)


@handler("challenge.invite_matches")
async def _invite_matches(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    """Matched startups get an invitation; matching never restricts who may apply."""
    challenge = await session.get(Challenge, payload["challenge_id"])
    if challenge is None:
        return {"skipped": "challenge not found"}

    rows = await session.execute(
        select(MatchResult)
        .where(MatchResult.challenge_id == challenge.id, MatchResult.invited_at.is_(None))
        .order_by(MatchResult.rank.asc())
        .limit(int(payload.get("limit", 20)))
    )
    invited = 0
    for match in rows.scalars().all():
        users = await session.execute(select(AppUser).where(AppUser.startup_id == match.startup_id))
        for user in users.scalars().all():
            await notifications.notify(
                session,
                user_id=user.id,
                notification_type="challenge.invitation",
                title="A challenge matches your profile: " + challenge.title,
                body=notifications.compose(
                    what_happened=challenge.department.name
                    + " published a challenge that matches your capability statement. "
                    + " ".join(str(r) + "." for r in (match.reasons or [])),
                    what_is_needed="Check your eligibility and apply if it fits",
                    by_whom="your startup",
                    by_when=format_ist(challenge.application_deadline)
                    if challenge.application_deadline
                    else None,
                ),
                link="/challenges/" + challenge.id,
                action_required=False,
                due_at=challenge.application_deadline,
                event_id="invite:" + challenge.id + ":" + match.startup_id,
            )
            invited += 1
        await startups.mark_invited(session, match)
    return {"invitations": invited}


# --- Simulation and evidence ----------------------------------------------


@handler("simulation.run")
async def _simulation_run(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    run = await simulation.execute_run(session, payload["run_id"])
    results = run.results or {}
    return {
        "run_id": run.id,
        "status": run.status,
        "power": (results.get("proposed") or {}).get("power"),
        "recommendation_found": results.get("recommendation_found"),
        "runtime_ms": run.runtime_ms,
    }


@handler("evidence.issue_passport")
async def _issue_passport(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    report = await session.get(EvidenceReport, payload["evidence_report_id"])
    if report is None:
        return {"skipped": "report not found"}
    pilot = await session.get(Pilot, report.pilot_id)
    if pilot is None:
        return {"skipped": "pilot not found"}
    passport = await scale.issue_passport(session, pilot, report)
    return {"passport_id": passport.id if passport else None}


# --- Notifications ---------------------------------------------------------


@handler("notify.event")
async def _notify_event(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    """Fan an outbox event out to the people who need to act on it (FR-NT-01)."""
    from app.workers.notify_rules import recipients_for

    event_type = payload["event_type"]
    event_id = payload["event_id"]
    body = payload.get("payload", {})
    aggregate_id = payload.get("aggregate_id", "")

    plan = await recipients_for(session, event_type, aggregate_id, body)
    delivered = 0
    for item in plan:
        record = await notifications.notify(
            session,
            user_id=item["user_id"],
            notification_type=event_type,
            title=item["title"],
            body=item["body"],
            link=item.get("link"),
            action_required=bool(item.get("action_required")),
            due_at=item.get("due_at"),
            event_id=event_id,
        )
        if record is None:
            continue
        delivered += 1
        user = await session.get(AppUser, item["user_id"])
        if user is not None:
            await notifications.deliver_email(
                session, record, to_email=user.email, to_name=user.name
            )
            if record.action_required:
                await notifications.deliver_sms(session, record, to_phone=user.phone)
    return {"event_type": event_type, "recipients": len(plan), "delivered": delivered}


@handler("notify.digest")
async def _digest(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    """Daily digest. Action-required items are never folded in (FR-NT-03)."""
    from datetime import timedelta

    from app.models.platform import Notification

    since = utcnow() - timedelta(days=1)
    users = await session.execute(select(AppUser).where(AppUser.status == "Active"))
    sent = 0
    for user in users.scalars().all():
        rows = await session.execute(
            select(Notification).where(
                Notification.user_id == user.id,
                Notification.created_at >= since,
                Notification.action_required.is_(False),
                Notification.read_at.is_(None),
            )
        )
        items = [{"title": n.title, "body": n.body} for n in rows.scalars().all()]
        if not items:
            continue
        record = await notifications.notify(
            session,
            user_id=user.id,
            notification_type="digest.daily",
            title="Daily summary from PramaanSetu",
            body=notifications.digest_body(items),
            link="/notifications",
            action_required=False,
            event_id="digest:" + user.id + ":" + utcnow().date().isoformat(),
        )
        if record is not None:
            await notifications.deliver_email(session, record, to_email=user.email, to_name=user.name)
            sent += 1
    return {"digests_sent": sent}


# --- Platform maintenance --------------------------------------------------


@handler("platform.verify_audit_chain")
async def _verify_chain(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    from app.services import audit

    verification = await audit.verify(session)
    if not verification.verified:
        admins = await session.execute(
            select(AppUser)
            .join(RoleAssignment, RoleAssignment.user_id == AppUser.id)
            .where(RoleAssignment.role == Role.PLATFORM_ADMIN)
        )
        for admin in admins.scalars().all():
            await notifications.notify(
                session,
                user_id=admin.id,
                notification_type="audit.chain_broken",
                title="Audit chain verification failed",
                body=verification.detail
                + " Investigate immediately and compare against the last daily head hash held "
                "in write-once storage.",
                link="/admin/audit",
                action_required=True,
                event_id="chain:" + utcnow().isoformat(timespec="hours"),
            )
    return {
        "verified": verification.verified,
        "entries_checked": verification.entries_checked,
        "first_broken_seq": verification.first_broken_seq,
        "head_hash": verification.head_hash,
    }


@handler("platform.purge_idempotency")
async def _purge_idempotency(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    from app.core.idempotency import purge_expired

    removed = await purge_expired(session)
    return {"removed": removed}


@handler("platform.scan_slas")
async def _scan_slas(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    from app.services import payments

    return await payments.scan_slas(session)


@handler("platform.close_deadlines")
async def _close_deadlines(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    from app.services import applications as applications_service

    closed = await challenges_service.close_due_deadlines(session)
    locked = 0
    for challenge in closed:
        locked += await applications_service.lock_for_challenge(session, challenge)
    return {"challenges_closed": len(closed), "applications_locked": locked}


@handler("platform.relay_outbox")
async def _relay_outbox(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    from app.services import jobs as jobs_service

    events = await outbox.claim_unpublished(session, limit=int(payload.get("limit", 100)))
    enqueued = 0
    for event in events:
        await jobs_service.enqueue(
            session,
            job_type="notify.event",
            queue="default",
            payload={
                "event_id": event.id,
                "event_type": event.event_type,
                "aggregate_type": event.aggregate_type,
                "aggregate_id": event.aggregate_id,
                "payload": event.payload,
            },
            dedupe_key="notify:" + event.id,
        )
        await _follow_up_jobs(session, event.event_type, event.aggregate_id, event.payload or {})
        outbox.mark_published(event)
        enqueued += 1
    return {"events_relayed": enqueued}


async def _follow_up_jobs(
    session: AsyncSession, event_type: str, aggregate_id: str, payload: dict[str, Any]
) -> None:
    """Events that trigger more than a notification."""
    from app.services import jobs as jobs_service

    if event_type == "challenge.published":
        await jobs_service.enqueue(
            session,
            job_type="challenge.embed_and_match",
            queue="ai",
            payload={"challenge_id": aggregate_id},
            dedupe_key="match:" + aggregate_id,
        )
        await jobs_service.enqueue(
            session,
            job_type="challenge.invite_matches",
            queue="default",
            payload={"challenge_id": aggregate_id},
            dedupe_key="invite:" + aggregate_id,
            delay_seconds=2,
        )
    elif event_type == "startup.registered":
        await jobs_service.enqueue(
            session,
            job_type="startup.verify_dpiit",
            queue="default",
            payload={"startup_id": aggregate_id},
            dedupe_key="dpiit:" + aggregate_id,
        )
        await jobs_service.enqueue(
            session,
            job_type="startup.refresh_embedding",
            queue="ai",
            payload={"startup_id": aggregate_id},
            dedupe_key="embed:" + aggregate_id,
        )
    elif event_type == "startup.profile_changed":
        await jobs_service.enqueue(
            session,
            job_type="startup.refresh_embedding",
            queue="ai",
            payload={"startup_id": aggregate_id},
        )
    elif event_type == "evidence.signed_off" and payload.get("status") in (
        "SignedOff",
        "SignedOffWithQualifications",
    ):
        await jobs_service.enqueue(
            session,
            job_type="evidence.issue_passport",
            queue="default",
            payload={"evidence_report_id": aggregate_id},
            dedupe_key="passport:" + aggregate_id,
        )


@handler("milestone.recheck")
async def _milestone_recheck(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    milestone = await session.get(Milestone, payload["milestone_id"])
    if milestone is None:
        return {"skipped": "milestone not found"}
    return {"state": milestone.state, "escalation_level": milestone.escalation_level}
