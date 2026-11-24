"""The signed-in user: task inbox, notifications and preferences (PRD 6.1, 5.13)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.deps import CsrfDep, PrincipalDep, SessionDep
from app.core.errors import NotFound
from app.models.identity import AppUser
from app.services import inbox, notifications

router = APIRouter(prefix="/me", tags=["me"])


class MarkRead(BaseModel):
    notification_ids: list[str] = Field(default_factory=list)
    all: bool = False


class Preferences(BaseModel):
    locale: str | None = Field(default=None, pattern="^(en|hi)$")
    designation: str | None = None


@router.get("/tasks", summary="Everything waiting for this user, sorted by deadline")
async def my_tasks(
    principal: PrincipalDep, session: SessionDep, limit: int = Query(100, ge=1, le=200)
) -> dict[str, Any]:
    tasks = await inbox.build(session, principal, limit=limit)
    overdue = sum(1 for t in tasks if t.overdue)
    return {
        "items": [t.to_dict() for t in tasks],
        "count": len(tasks),
        "overdue": overdue,
        "summary": (
            "Nothing needs your action right now."
            if not tasks
            else str(len(tasks)) + " item(s) need your action"
            + (", " + str(overdue) + " of them overdue." if overdue else ".")
        ),
    }


@router.get("/notifications", summary="In-app notifications")
async def my_notifications(
    principal: PrincipalDep,
    session: SessionDep,
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    rows = await notifications.inbox(session, principal.user_id, unread_only=unread_only, limit=limit)
    unread = await notifications.unread_count(session, principal.user_id)
    return {
        "items": [
            {
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "body": n.body,
                "link": n.link,
                "action_required": n.action_required,
                "due_at": n.due_at.isoformat() if n.due_at else None,
                "created_at": n.created_at.isoformat(),
                "read": n.read_at is not None,
            }
            for n in rows
        ],
        "unread_count": unread,
    }


@router.post("/notifications/read", dependencies=[Depends(lambda: None)], summary="Mark notifications read")
async def mark_read(
    body: MarkRead, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    if body.all:
        count = await notifications.mark_all_read(session, principal.user_id)
    else:
        count = await notifications.mark_read(session, principal.user_id, body.notification_ids)
    await session.commit()
    return {"marked_read": count}


@router.get("/profile", summary="Profile of the signed-in user")
async def profile(principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    user = await session.get(AppUser, principal.user_id)
    if user is None:
        raise NotFound("Your account was not found.")
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "locale": user.locale,
        "designation": user.designation,
        "department_id": user.department_id,
        "startup_id": user.startup_id,
        "roles": sorted(principal.roles),
        "privacy_notice_accepted_at": user.privacy_notice_accepted_at.isoformat()
        if user.privacy_notice_accepted_at
        else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


@router.put("/profile", summary="Update language and designation")
async def update_profile(
    body: Preferences, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    user = await session.get(AppUser, principal.user_id)
    if user is None:
        raise NotFound("Your account was not found.")
    if body.locale:
        user.locale = body.locale
    if body.designation is not None:
        user.designation = body.designation
    await session.commit()
    return {"updated": True, "locale": user.locale, "designation": user.designation}
