"""FastAPI dependencies: the authenticated principal, CSRF, concurrency headers."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.errors import Conflict, Forbidden, PreconditionRequired, Unauthenticated
from app.core.policy import Principal, ScopedRole
from app.core.security import ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, decode_access_token
from app.models.identity import AppUser

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def load_principal(user_id: str, session: AsyncSession) -> Principal:
    user = await session.get(AppUser, user_id)
    if user is None or user.status != "Active":
        raise Unauthenticated("This account is no longer active. Contact the platform administrator.")
    return Principal(
        user_id=user.id,
        name=user.name,
        email=user.email,
        locale=user.locale,
        department_id=user.department_id,
        startup_id=user.startup_id,
        scoped_roles=[
            ScopedRole(role=r.role, scope_type=r.scope_type, scope_id=r.scope_id) for r in user.roles
        ],
    )


async def current_principal(request: Request, session: SessionDep) -> Principal:
    """Read the access token from the HttpOnly cookie, or the Authorization header."""
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        header = request.headers.get("Authorization", "")
        if header.lower().startswith("bearer "):
            token = header[7:]
    if not token:
        raise Unauthenticated("Sign in to continue.")
    claims = decode_access_token(token)
    principal = await load_principal(claims["sub"], session)
    principal.session_id = claims.get("sid", "")
    request.state.principal = principal
    return principal


PrincipalDep = Annotated[Principal, Depends(current_principal)]


async def optional_principal(request: Request, session: SessionDep) -> Principal | None:
    try:
        return await current_principal(request, session)
    except Unauthenticated:
        return None


OptionalPrincipalDep = Annotated[Principal | None, Depends(optional_principal)]


async def verify_csrf(request: Request) -> None:
    """Double-submit CSRF token on every state-changing request (PRD 11.1)."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if request.headers.get("Authorization", "").lower().startswith("bearer "):
        return  # Token callers are not subject to cookie-based CSRF.
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or cookie != header:
        raise Forbidden(
            "This request could not be verified as coming from the PramaanSetu web app. "
            "Reload the page and try again."
        )


CsrfDep = Annotated[None, Depends(verify_csrf)]


def if_match(
    value: Annotated[str | None, Header(alias="If-Match")] = None,
) -> int | None:
    """Parse the ETag the client must echo back on every update (PRD 9.1)."""
    if value is None:
        return None
    cleaned = value.strip().strip("W/").strip('"')
    try:
        return int(cleaned)
    except ValueError:
        raise PreconditionRequired(
            "The If-Match header must carry the record version you loaded.",
            errors=[
                {
                    "field": "If-Match",
                    "detail": "The value " + value + " is not a version number.",
                    "fix": "Reload the record and send the version it returns.",
                }
            ],
        ) from None


IfMatchDep = Annotated[int | None, Depends(if_match)]


def idempotency_key(
    value: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> str | None:
    return value


IdempotencyDep = Annotated[str | None, Depends(idempotency_key)]


def check_version(entity: Any, expected: int | None, *, required: bool = True) -> None:
    """Optimistic locking check. A stale version returns 409 with the current record."""
    if expected is None:
        if required:
            raise PreconditionRequired(
                "This update needs the record version you loaded, sent as If-Match.",
                errors=[
                    {
                        "field": "If-Match",
                        "detail": "The header was not sent.",
                        "fix": "Reload the record and send the version it returns.",
                    }
                ],
            )
        return
    actual = getattr(entity, "version", None)
    if actual is not None and int(actual) != int(expected):
        raise Conflict(
            "Someone else changed this record while you were working on it. "
            "Your version was " + str(expected) + " and the current version is " + str(actual) + ".",
            extra={"current_version": actual, "your_version": expected},
        )


def locale_of(request: Request, principal: Principal | None = None) -> str:
    """Language for generated text. The user can switch at any time (UX-10)."""
    header = (request.headers.get("Accept-Language") or "").lower()
    if header.startswith("hi"):
        return "hi"
    if principal is not None:
        return principal.locale
    return "en"


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "")


def settings_dep() -> Any:
    return settings
