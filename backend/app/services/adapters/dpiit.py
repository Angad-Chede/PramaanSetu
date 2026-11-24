"""Startup India / DPIIT recognition adapter (FR-SR-02).

The mock resolves against a seeded registry so the whole eligibility path, including
the automatic relaxation of prior turnover and experience criteria, can be demonstrated
and tested without a live integration.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.domain.states import DpiitStatus
from app.services.adapters.base import Adapter

log = get_logger(__name__)

RECOGNITION_RE = re.compile(r"^DIPP\d{4,8}$", re.IGNORECASE)


@dataclass
class DpiitVerification:
    status: str
    recognition_number: str | None
    recognised_name: str | None
    recognised_on: str | None
    detail: str
    source: str


class DpiitAdapter(Adapter):
    name = "dpiit"

    async def verify(self, *, recognition_number: str | None, legal_name: str) -> DpiitVerification:
        raise NotImplementedError


class MockDpiitAdapter(DpiitAdapter):
    """Seeded registry. Any well-formed DIPP number is recognised unless it ends in 0."""

    def __init__(self, mode: str = "mock") -> None:
        super().__init__(mode)
        self.registry: dict[str, dict[str, Any]] = {}

    def seed(self, entries: list[dict[str, Any]]) -> None:
        for entry in entries:
            self.registry[str(entry["recognition_number"]).upper()] = entry

    async def verify(self, *, recognition_number: str | None, legal_name: str) -> DpiitVerification:
        await asyncio.sleep(0)  # Keeps the call shape asynchronous like the live adapter.
        if not recognition_number:
            return DpiitVerification(
                status=str(DpiitStatus.NOT_FOUND),
                recognition_number=None,
                recognised_name=None,
                recognised_on=None,
                detail="No recognition number was given on the startup profile.",
                source="mock",
            )
        key = recognition_number.strip().upper()
        if not RECOGNITION_RE.match(key):
            return DpiitVerification(
                status=str(DpiitStatus.NOT_FOUND),
                recognition_number=key,
                recognised_name=None,
                recognised_on=None,
                detail="The recognition number is not in the expected format, for example DIPP123456.",
                source="mock",
            )
        entry = self.registry.get(key)
        if entry:
            return DpiitVerification(
                status=str(DpiitStatus.VERIFIED),
                recognition_number=key,
                recognised_name=entry.get("legal_name", legal_name),
                recognised_on=entry.get("recognised_on"),
                detail="Recognition confirmed against the Startup India registry.",
                source="mock",
            )
        if key.endswith("0"):
            return DpiitVerification(
                status=str(DpiitStatus.NOT_FOUND),
                recognition_number=key,
                recognised_name=None,
                recognised_on=None,
                detail="No recognition record was found for this number.",
                source="mock",
            )
        return DpiitVerification(
            status=str(DpiitStatus.VERIFIED),
            recognition_number=key,
            recognised_name=legal_name,
            recognised_on=None,
            detail="Recognition confirmed against the Startup India registry.",
            source="mock",
        )


class LiveDpiitAdapter(DpiitAdapter):
    """Live implementation. Wired when the department is onboarded to the registry API."""

    def __init__(self, mode: str = "live") -> None:
        super().__init__(mode)
        self.breaker.failures = 3

    async def verify(self, *, recognition_number: str | None, legal_name: str) -> DpiitVerification:
        self.breaker.guard()
        try:
            import httpx

            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    "https://api.startupindia.gov.in/recognition/" + str(recognition_number)
                )
                response.raise_for_status()
                data = response.json()
            self.breaker.record_success()
            return DpiitVerification(
                status=str(DpiitStatus.VERIFIED if data.get("recognised") else DpiitStatus.NOT_FOUND),
                recognition_number=recognition_number,
                recognised_name=data.get("legalName"),
                recognised_on=data.get("recognisedOn"),
                detail=data.get("message", ""),
                source="live",
            )
        except Exception as exc:
            self.breaker.record_failure()
            log.warning("DPIIT verification failed", error=str(exc))
            return DpiitVerification(
                status=str(DpiitStatus.PENDING),
                recognition_number=recognition_number,
                recognised_name=None,
                recognised_on=None,
                detail="The Startup India registry could not be reached. The check will be retried.",
                source="live",
            )


_adapter: DpiitAdapter | None = None


def get_dpiit_adapter() -> DpiitAdapter:
    global _adapter
    if _adapter is None:
        _adapter = (
            MockDpiitAdapter() if settings.adapter_dpiit_mode == "mock" else LiveDpiitAdapter()
        )
    return _adapter


def reset_dpiit_adapter() -> None:
    global _adapter
    _adapter = None
