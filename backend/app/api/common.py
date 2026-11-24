"""Shared HTTP helpers: ETags, idempotent action endpoints, serialisation."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import check_version
from app.core.idempotency import remember, replay
from app.core.policy import Principal


def set_etag(response: Response, entity: Any) -> None:
    version = getattr(entity, "version", None)
    if version is not None:
        response.headers["ETag"] = '"' + str(version) + '"'


def money(paise: int | None) -> dict[str, Any] | None:
    if paise is None:
        return None
    from app.core.money import CURRENCY, format_inr

    return {"paise": int(paise), "currency": CURRENCY, "display": format_inr(int(paise))}


def iso(value: Any) -> str | None:
    return value.isoformat() if value is not None and hasattr(value, "isoformat") else None


async def run_action(
    *,
    session: AsyncSession,
    principal: Principal,
    route: str,
    idempotency_key: str | None,
    request_payload: Any,
    action: Callable[[], Awaitable[dict[str, Any]]],
    entity: Any = None,
    expected_version: int | None = None,
    version_required: bool = False,
    status_code: int = 200,
) -> dict[str, Any]:
    """Run one state-changing action with idempotency and optimistic locking.

    The order matters: replay before any work, version check before any write, and the
    response recorded only after the action succeeded.
    """
    stored = await replay(session, idempotency_key, principal.user_id, route, request_payload)
    if stored is not None:
        return stored["response"]

    if entity is not None:
        check_version(entity, expected_version, required=version_required)

    result = await action()
    await remember(
        session, idempotency_key, principal.user_id, route, request_payload, status_code, result
    )
    await session.commit()
    return result


def problem_detail(title: str, detail: str, fix: str, field: str = "") -> dict[str, Any]:
    body: dict[str, Any] = {"title": title, "detail": detail, "fix": fix}
    if field:
        body["field"] = field
    return body


def paginate_params(cursor: str | None, limit: int | None) -> tuple[dict[str, Any] | None, int]:
    from app.core.pagination import clamp_limit, decode_cursor

    return decode_cursor(cursor), clamp_limit(limit)
