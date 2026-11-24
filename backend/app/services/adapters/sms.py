"""SMS adapter (FR-NT-01). Mocked in the MVP; messages are captured for inspection."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.core.config import settings
from app.core.logging import get_logger
from app.services.adapters.base import Adapter

log = get_logger(__name__)


@dataclass
class SentSms:
    to_phone: str
    text: str
    at: str


class SmsAdapter(Adapter):
    name = "sms"

    async def send(self, *, to_phone: str, text: str) -> bool:
        raise NotImplementedError


class MockSmsAdapter(SmsAdapter):
    def __init__(self, mode: str = "mock") -> None:
        super().__init__(mode)
        self.outbox: list[SentSms] = []

    async def send(self, *, to_phone: str, text: str) -> bool:
        await asyncio.sleep(0)
        from app.core.clock import utcnow

        self.outbox.append(SentSms(to_phone=to_phone, text=text, at=utcnow().isoformat()))
        log.info("SMS queued in mock mode", recipient_suffix=to_phone[-4:], length=len(text))
        return True


class LiveSmsAdapter(SmsAdapter):
    def __init__(self, mode: str = "live") -> None:
        super().__init__(mode)

    async def send(self, *, to_phone: str, text: str) -> bool:
        self.breaker.guard()
        try:
            import httpx

            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    "https://sms.gov.in/api/send", json={"to": to_phone, "text": text}
                )
                response.raise_for_status()
            self.breaker.record_success()
            return True
        except Exception as exc:
            self.breaker.record_failure()
            log.warning("SMS send failed", error=str(exc))
            return False


_adapter: SmsAdapter | None = None


def get_sms_adapter() -> SmsAdapter:
    global _adapter
    if _adapter is None:
        _adapter = MockSmsAdapter() if settings.adapter_sms_mode == "mock" else LiveSmsAdapter()
    return _adapter
