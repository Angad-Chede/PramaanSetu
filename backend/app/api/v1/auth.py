"""Authentication (PRD 3.3, 9.2, 11.1).

Government users sign in with a one-time code; startup users with a password plus a
one-time code. Both paths end in the same short-lived access cookie with a rotating
refresh token and a CSRF token.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.core.clock import utcnow
from app.core.config import settings
from app.core.deps import SessionDep, client_ip, current_principal
from app.core.errors import RateLimited, Unauthenticated, ValidationFailed
from app.core.ids import uuid7str
from app.core.logging import get_logger
from app.core.policy import Principal
from app.core.ratelimit import limiter, otp_limit
from app.core.security import (
    ACCESS_COOKIE,
    CSRF_COOKIE,
    REFRESH_COOKIE,
    create_access_token,
    generate_otp,
    hash_ip,
    hash_token,
    new_csrf_token,
    new_refresh_token,
    verify_password,
)
from app.models.identity import AppUser, LoginAttempt, OtpCode, RefreshToken
from app.services.adapters.email import get_email_adapter
from app.services.adapters.sms import get_sms_adapter

router = APIRouter(prefix="/auth", tags=["auth"])
log = get_logger(__name__)


class OtpRequest(BaseModel):
    identifier: str = Field(description="Email address or mobile number on the account.")


class OtpVerify(BaseModel):
    identifier: str
    code: str = Field(min_length=4, max_length=10)


class PasswordLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


def _set_session_cookies(response: Response, *, access: str, refresh: str, csrf: str) -> None:
    common: dict[str, Any] = {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "strict",
        "path": "/",
    }
    if settings.cookie_domain:
        common["domain"] = settings.cookie_domain
    response.set_cookie(ACCESS_COOKIE, access, max_age=settings.access_token_minutes * 60, **common)
    response.set_cookie(REFRESH_COOKIE, refresh, max_age=settings.refresh_token_hours * 3600, **common)
    # The CSRF cookie is readable by the app so it can echo it in a header.
    response.set_cookie(
        CSRF_COOKIE,
        csrf,
        max_age=settings.refresh_token_hours * 3600,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
        **({"domain": settings.cookie_domain} if settings.cookie_domain else {}),
    )


def _clear_session_cookies(response: Response) -> None:
    for name in (ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, path="/")


async def _find_user(session, identifier: str) -> AppUser | None:  # type: ignore[no-untyped-def]
    cleaned = identifier.strip().lower()
    result = await session.execute(select(AppUser).where(AppUser.email == cleaned))
    user = result.scalar_one_or_none()
    if user is not None:
        return user
    result = await session.execute(select(AppUser).where(AppUser.phone == identifier.strip()))
    return result.scalar_one_or_none()


async def _issue_session(session, user: AppUser, request: Request, response: Response) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    session_id = uuid7str()
    raw_refresh, refresh_hash = new_refresh_token()
    csrf = new_csrf_token()

    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            family_id=session_id,
            expires_at=utcnow() + timedelta(hours=settings.refresh_token_hours),
            user_agent=(request.headers.get("User-Agent") or "")[:300],
        )
    )
    user.last_login_at = utcnow()
    user.failed_attempts = 0
    user.locked_until = None
    await session.flush()

    roles = sorted({r.role for r in user.roles})
    access = create_access_token(user_id=user.id, roles=roles, session_id=session_id)
    _set_session_cookies(response, access=access, refresh=raw_refresh, csrf=csrf)

    session.add(
        LoginAttempt(identifier=user.email, succeeded=True, ip_hash=hash_ip(client_ip(request)))
    )
    await session.commit()

    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "locale": user.locale,
            "designation": user.designation,
            "department_id": user.department_id,
            "startup_id": user.startup_id,
            "roles": roles,
        },
        "csrf_token": csrf,
        "access_expires_in_seconds": settings.access_token_minutes * 60,
    }


@router.post("/otp/request", summary="Send a one-time code")
async def request_otp(body: OtpRequest, request: Request, session: SessionDep) -> dict[str, Any]:
    verdict = await limiter.check(
        "otp:" + body.identifier.strip().lower(), *otp_limit()
    )
    if not verdict.allowed:
        raise RateLimited(
            "Too many code requests for this account. Try again in "
            + str(verdict.reset_seconds)
            + " seconds.",
            extra={"retry_after_seconds": verdict.reset_seconds},
        )

    user = await _find_user(session, body.identifier)
    code = generate_otp()

    if user is not None:
        if user.locked_until and user.locked_until > utcnow():
            raise RateLimited(
                "This account is temporarily locked after repeated failed sign-in attempts. "
                "Try again after " + str(int((user.locked_until - utcnow()).total_seconds() // 60))
                + " minutes."
            )
        channel = "sms" if body.identifier.strip() == (user.phone or "") else "email"
        session.add(
            OtpCode(
                identifier=body.identifier.strip().lower(),
                channel=channel,
                code_hash=hash_token(code),
                expires_at=utcnow() + timedelta(seconds=settings.otp_ttl_seconds),
            )
        )
        await session.commit()

        message = (
            "Your PramaanSetu sign-in code is " + code + ". It is valid for "
            + str(settings.otp_ttl_seconds // 60) + " minutes. Do not share it with anyone."
        )
        if channel == "sms" and user.phone:
            await get_sms_adapter().send(to_phone=user.phone, text=message)
        else:
            await get_email_adapter().send(
                to_email=user.email, subject="PramaanSetu sign-in code", body=message
            )

    # The response is identical whether or not the account exists, so this endpoint
    # cannot be used to discover which addresses are registered.
    result: dict[str, Any] = {
        "sent": True,
        "detail": "If an account exists for that address or number, a code has been sent. "
        "The code is valid for " + str(settings.otp_ttl_seconds // 60) + " minutes.",
        "expires_in_seconds": settings.otp_ttl_seconds,
    }
    if settings.environment == "local" and user is not None:
        # Local development convenience only. Never enabled in a deployed environment.
        result["development_code"] = code
    return result


@router.post("/otp/verify", summary="Verify a one-time code and start a session")
async def verify_otp(
    body: OtpVerify, request: Request, response: Response, session: SessionDep
) -> dict[str, Any]:
    identifier = body.identifier.strip().lower()
    result = await session.execute(
        select(OtpCode)
        .where(
            OtpCode.identifier == identifier,
            OtpCode.consumed_at.is_(None),
            OtpCode.expires_at > utcnow(),
        )
        .order_by(OtpCode.created_at.desc())
        .limit(1)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise Unauthenticated("That code has expired or was already used. Request a new code.")

    record.attempts += 1
    if record.attempts > 5:
        record.consumed_at = utcnow()
        await session.commit()
        raise Unauthenticated("Too many attempts on this code. Request a new code.")

    if record.code_hash != hash_token(body.code.strip()):
        session.add(
            LoginAttempt(
                identifier=identifier,
                succeeded=False,
                ip_hash=hash_ip(client_ip(request)),
                reason="otp_mismatch",
            )
        )
        await session.commit()
        raise Unauthenticated("That code is not correct. Check the code and try again.")

    record.consumed_at = utcnow()
    user = await _find_user(session, identifier)
    if user is None or user.status != "Active":
        await session.commit()
        raise Unauthenticated("This account is not active. Contact the platform administrator.")

    return await _issue_session(session, user, request, response)


@router.post("/login", summary="Password sign-in for startup users, followed by a one-time code")
async def login(body: PasswordLogin, request: Request, session: SessionDep) -> dict[str, Any]:
    user = await _find_user(session, body.email)
    now = utcnow()

    if user is not None and user.locked_until and user.locked_until > now:
        raise RateLimited(
            "This account is locked for "
            + str(int((user.locked_until - now).total_seconds() // 60))
            + " more minutes after repeated failed attempts."
        )

    if user is None or not verify_password(body.password, user.password_hash):
        if user is not None:
            user.failed_attempts += 1
            if user.failed_attempts >= settings.max_failed_logins:
                user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
        session.add(
            LoginAttempt(
                identifier=body.email.lower(),
                succeeded=False,
                ip_hash=hash_ip(client_ip(request)),
                reason="bad_password",
            )
        )
        await session.commit()
        raise Unauthenticated("The email address or password is not correct.")

    user.failed_attempts = 0
    code = generate_otp()
    session.add(
        OtpCode(
            identifier=user.email,
            channel="email",
            code_hash=hash_token(code),
            purpose="login_second_factor",
            expires_at=now + timedelta(seconds=settings.otp_ttl_seconds),
        )
    )
    await session.commit()

    await get_email_adapter().send(
        to_email=user.email,
        subject="PramaanSetu sign-in code",
        body="Your PramaanSetu sign-in code is " + code + ". It is valid for "
        + str(settings.otp_ttl_seconds // 60) + " minutes. Do not share it with anyone.",
    )

    result: dict[str, Any] = {
        "second_factor_required": True,
        "identifier": user.email,
        "detail": "Password accepted. A one-time code has been sent to your email address.",
        "expires_in_seconds": settings.otp_ttl_seconds,
    }
    if settings.environment == "local":
        result["development_code"] = code
    return result


@router.post("/refresh", summary="Rotate the refresh token and issue a new access token")
async def refresh(request: Request, response: Response, session: SessionDep) -> dict[str, Any]:
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise Unauthenticated("Your session has ended. Sign in again.")

    token_hash = hash_token(raw)
    result = await session.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    record = result.scalar_one_or_none()

    if record is None:
        _clear_session_cookies(response)
        raise Unauthenticated("Your session is not valid. Sign in again.")

    if record.used_at is not None or record.revoked_at is not None:
        # Reuse detection: revoke the whole family (PRD 11.1).
        family = await session.execute(
            select(RefreshToken).where(RefreshToken.family_id == record.family_id)
        )
        for token in family.scalars().all():
            token.revoked_at = utcnow()
        await session.commit()
        _clear_session_cookies(response)
        log.warning("Refresh token reuse detected", family_id=record.family_id)
        raise Unauthenticated(
            "This session was ended for security reasons because a sign-in token was reused. "
            "Sign in again."
        )

    if record.expires_at <= utcnow():
        _clear_session_cookies(response)
        raise Unauthenticated("Your session has expired. Sign in again.")

    record.used_at = utcnow()
    user = await session.get(AppUser, record.user_id)
    if user is None or user.status != "Active":
        await session.commit()
        _clear_session_cookies(response)
        raise Unauthenticated("This account is no longer active.")

    raw_refresh, refresh_hash = new_refresh_token()
    csrf = new_csrf_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            family_id=record.family_id,
            expires_at=utcnow() + timedelta(hours=settings.refresh_token_hours),
            user_agent=(request.headers.get("User-Agent") or "")[:300],
        )
    )
    await session.flush()

    roles = sorted({r.role for r in user.roles})
    access = create_access_token(user_id=user.id, roles=roles, session_id=record.family_id)
    _set_session_cookies(response, access=access, refresh=raw_refresh, csrf=csrf)
    await session.commit()

    return {"refreshed": True, "csrf_token": csrf, "roles": roles}


@router.post("/logout", summary="End the session and revoke every refresh token")
async def logout(request: Request, response: Response, session: SessionDep) -> dict[str, Any]:
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        result = await session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw))
        )
        record = result.scalar_one_or_none()
        if record is not None:
            family = await session.execute(
                select(RefreshToken).where(RefreshToken.user_id == record.user_id)
            )
            for token in family.scalars().all():
                token.revoked_at = utcnow()
            await session.commit()
    _clear_session_cookies(response)
    return {"signed_out": True}


@router.get("/session", summary="The signed-in user and their roles")
async def whoami(request: Request, session: SessionDep) -> dict[str, Any]:
    principal: Principal = await current_principal(request, session)
    return {
        "id": principal.user_id,
        "name": principal.name,
        "email": principal.email,
        "locale": principal.locale,
        "department_id": principal.department_id,
        "startup_id": principal.startup_id,
        "roles": sorted(principal.roles),
        "scoped_roles": [
            {"role": r.role, "scope_type": r.scope_type, "scope_id": r.scope_id}
            for r in principal.scoped_roles
        ],
    }


@router.post("/dev/impersonate", status_code=status.HTTP_200_OK, include_in_schema=False)
async def dev_impersonate(
    body: OtpRequest, request: Request, response: Response, session: SessionDep
) -> dict[str, Any]:
    """Local-only shortcut so a demo can switch personas without seven mailboxes."""
    if settings.environment != "local":
        raise ValidationFailed("This endpoint is available only in the local environment.")
    user = await _find_user(session, body.identifier)
    if user is None:
        raise Unauthenticated("No seeded account matches that address.")
    return await _issue_session(session, user, request, response)
