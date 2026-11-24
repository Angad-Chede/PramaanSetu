"""Notifications (PRD 5.13).

Every message states what happened, what is needed, by whom and by when. Plain text,
no emojis, no marketing language. Notifications are generated from committed events
only, through the outbox, so no user is told about a change that was rolled back.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import format_ist, utcnow
from app.core.config import settings
from app.core.logging import get_logger
from app.models.platform import Notification
from app.services.adapters.email import get_email_adapter
from app.services.adapters.sms import get_sms_adapter

log = get_logger(__name__)


async def notify(
    session: AsyncSession,
    *,
    user_id: str,
    notification_type: str,
    title: str,
    body: str,
    link: str | None = None,
    action_required: bool = False,
    due_at: datetime | None = None,
    event_id: str | None = None,
) -> Notification | None:
    """Create one in-app notification. Idempotent on (user_id, event_id)."""
    record = Notification(
        user_id=user_id,
        type=notification_type,
        title=title,
        body=body,
        link=link,
        action_required=action_required,
        due_at=due_at,
        event_id=event_id,
        created_at=utcnow(),
    )
    session.add(record)
    try:
        await session.flush()
    except IntegrityError:
        # The same event was already delivered to this user; exactly-once holds.
        await session.rollback()
        return None
    return record


async def deliver_email(
    session: AsyncSession, notification: Notification, *, to_email: str, to_name: str
) -> None:
    adapter = get_email_adapter()
    subject = "PramaanSetu: " + notification.title
    lines = [
        "Dear " + to_name + ",",
        "",
        notification.body,
    ]
    if notification.due_at:
        lines.append("")
        lines.append("Due by: " + format_ist(notification.due_at))
    if notification.link:
        lines.append("")
        lines.append("Open this item: " + settings.web_base_url + notification.link)
    lines.extend(
        [
            "",
            "This is an automated message from PramaanSetu. Do not reply to this message.",
        ]
    )
    sent = await adapter.send(to_email=to_email, subject=subject, body="\n".join(lines))
    if sent:
        notification.channel_email_sent_at = utcnow()
        await session.flush()


async def deliver_sms(
    session: AsyncSession, notification: Notification, *, to_phone: str | None
) -> None:
    if not to_phone or not notification.action_required:
        return
    adapter = get_sms_adapter()
    text = notification.title + ". " + notification.body[:200]
    sent = await adapter.send(to_phone=to_phone, text=text)
    if sent:
        notification.channel_sms_sent_at = utcnow()
        await session.flush()


async def inbox(
    session: AsyncSession, user_id: str, *, unread_only: bool = False, limit: int = 50
) -> list[Notification]:
    stmt = (
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    return list((await session.execute(stmt)).scalars().all())


async def unread_count(session: AsyncSession, user_id: str) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
    )
    return int(result.scalar_one())


async def mark_read(session: AsyncSession, user_id: str, notification_ids: list[str]) -> int:
    result = await session.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.id.in_(notification_ids))
        .values(read_at=utcnow())
    )
    return int(result.rowcount or 0)


async def mark_all_read(session: AsyncSession, user_id: str) -> int:
    result = await session.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    return int(result.rowcount or 0)


def compose(
    *,
    what_happened: str,
    what_is_needed: str,
    by_whom: str,
    by_when: str | None = None,
) -> str:
    """The four-part message shape required by FR-NT-04."""
    parts = [what_happened, what_is_needed + " (" + by_whom + ")"]
    if by_when:
        parts.append("Due by " + by_when + ".")
    return " ".join(parts)


def digest_body(items: list[dict[str, Any]]) -> str:
    """Daily digest. Action-required items are never folded into a digest (FR-NT-03)."""
    if not items:
        return "No updates in the last day."
    lines = ["The following items changed in the last day:", ""]
    for item in items:
        lines.append("- " + item["title"] + ": " + item["body"])
    lines.append("")
    lines.append("Items needing your action are sent separately and are not included here.")
    return "\n".join(lines)
