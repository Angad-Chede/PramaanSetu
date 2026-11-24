"""Email adapter. Mock mode writes to an in-process outbox that the admin console reads.

Local development points at Mailpit through the SMTP mode, which is what the Docker
Compose file in infra/ starts.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.core.clock import utcnow
from app.core.config import settings
from app.core.logging import get_logger
from app.services.adapters.base import Adapter

log = get_logger(__name__)


@dataclass
class SentEmail:
    to_email: str
    subject: str
    body: str
    at: str


class EmailAdapter(Adapter):
    name = "email"

    async def send(self, *, to_email: str, subject: str, body: str) -> bool:
        raise NotImplementedError


class MockEmailAdapter(EmailAdapter):
    def __init__(self, mode: str = "mock") -> None:
        super().__init__(mode)
        self.outbox: list[SentEmail] = []

    async def send(self, *, to_email: str, subject: str, body: str) -> bool:
        await asyncio.sleep(0)
        self.outbox.append(
            SentEmail(to_email=to_email, subject=subject, body=body, at=utcnow().isoformat())
        )
        if len(self.outbox) > 2000:
            del self.outbox[: len(self.outbox) - 2000]
        log.info("Email queued in mock mode", subject=subject)
        return True

    def recent(self, limit: int = 50) -> list[SentEmail]:
        return list(reversed(self.outbox[-limit:]))


class SmtpEmailAdapter(EmailAdapter):
    def __init__(self, mode: str = "smtp", host: str = "localhost", port: int = 1025) -> None:
        super().__init__(mode)
        self.host = host
        self.port = port

    async def send(self, *, to_email: str, subject: str, body: str) -> bool:
        self.breaker.guard()
        try:
            import smtplib
            from email.message import EmailMessage

            def _send() -> None:
                message = EmailMessage()
                message["From"] = "no-reply@pramaansetu.gov.in"
                message["To"] = to_email
                message["Subject"] = subject
                message.set_content(body)
                with smtplib.SMTP(self.host, self.port, timeout=15) as smtp:
                    smtp.send_message(message)

            await asyncio.to_thread(_send)
            self.breaker.record_success()
            return True
        except Exception as exc:
            self.breaker.record_failure()
            log.warning("Email send failed", error=str(exc))
            return False


_adapter: EmailAdapter | None = None


def get_email_adapter() -> EmailAdapter:
    global _adapter
    if _adapter is None:
        _adapter = MockEmailAdapter() if settings.adapter_email_mode == "mock" else SmtpEmailAdapter()
    return _adapter
