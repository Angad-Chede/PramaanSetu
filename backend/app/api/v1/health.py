"""Health and readiness probes (PRD 9.2), plus the operational status the admin console reads."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.core.clock import format_ist, utcnow
from app.core.config import settings
from app.core.db import db_healthy, session_scope
from app.core.ratelimit import limiter
from app.services import jobs as jobs_service
from app.services import outbox
from app.services.adapters.dpiit import get_dpiit_adapter
from app.services.adapters.email import get_email_adapter
from app.services.adapters.esign import get_esign_adapter
from app.services.adapters.gem import get_gem_adapter
from app.services.adapters.sms import get_sms_adapter
from app.services.embeddings import provider_health
from app.services.files import storage_health
from app.services.llm import get_llm_gateway
from app.workers.scheduler import leadership_status

router = APIRouter(tags=["health"])


@router.get("/healthz", summary="Liveness probe")
async def healthz() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "pramaansetu-api",
        "environment": settings.environment,
        "time": utcnow().isoformat(),
        "time_ist": format_ist(utcnow()),
    }


@router.get("/readyz", summary="Readiness probe including dependencies")
async def readyz() -> dict[str, Any]:
    database = await db_healthy()
    redis = await limiter.healthy()
    ready = database
    return {
        "ready": ready,
        "checks": {
            "database": {"ok": database, "url_scheme": settings.database_url.split(":")[0]},
            "redis": {
                "ok": redis,
                "configured": bool(settings.redis_url),
                "note": "Optional. Without it, caching and shared rate limiting degrade to "
                "per-instance behaviour and no events are lost.",
            },
            "storage": storage_health(),
        },
    }


@router.get("/status", summary="Operational status for the admin console")
async def status() -> dict[str, Any]:
    async with session_scope() as session:
        depths = await jobs_service.queue_depth(session)
        oldest_critical = await jobs_service.oldest_job_age_seconds(session, "critical")
        pending_events = await outbox.pending_count(session)
        oldest_event = await outbox.oldest_pending_age_seconds(session)

    scheduler = await leadership_status()
    gateway = get_llm_gateway()

    alerts: list[dict[str, str]] = []
    if oldest_critical > 120:
        alerts.append(
            {
                "severity": "page",
                "name": "Critical queue stuck",
                "detail": "The oldest job on the critical queue is "
                + str(round(oldest_critical))
                + " seconds old.",
            }
        )
    if not scheduler.get("healthy"):
        alerts.append(
            {
                "severity": "page",
                "name": "Scheduler leader missing",
                "detail": "No service level scan has completed recently.",
            }
        )

    return {
        "time": utcnow().isoformat(),
        "environment": settings.environment,
        "queues": depths,
        "oldest_critical_job_seconds": round(oldest_critical, 1),
        "outbox": {"pending": pending_events, "oldest_seconds": round(oldest_event, 1)},
        "scheduler": scheduler,
        "llm": gateway.health(),
        "embeddings": provider_health(),
        "adapters": {
            "dpiit": await get_dpiit_adapter().health(),
            "gem": await get_gem_adapter().health(),
            "esign": await get_esign_adapter().health(),
            "sms": await get_sms_adapter().health(),
            "email": await get_email_adapter().health(),
        },
        "feature_flags": {
            "round_two_evaluation": settings.feature_round_two_evaluation,
            "vendor_dependency_score": settings.feature_vendor_dependency_score,
            "context_fit_check": settings.feature_context_fit_check,
            "daily_digest": settings.feature_daily_digest,
            "public_transparency": settings.feature_public_transparency,
        },
        "alerts": alerts,
    }
