"""Authentication primitives: password hashing, tokens, OTP and CSRF (PRD 11.1)."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.clock import utcnow
from app.core.config import settings
from app.core.errors import Unauthenticated

_hasher = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)

ACCESS_COOKIE = "ps_access"
REFRESH_COOKIE = "ps_refresh"
CSRF_COOKIE = "ps_csrf"
CSRF_HEADER = "X-CSRF-Token"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    try:
        return _hasher.verify(stored_hash, password)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except (InvalidHashError, ValueError):
        return True


def generate_otp() -> str:
    upper = 10**settings.otp_length
    return str(secrets.randbelow(upper)).zfill(settings.otp_length)


def hash_token(value: str) -> str:
    """Keyed hash so a database dump alone does not yield usable OTPs or refresh tokens."""
    return hmac.new(settings.secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


def constant_time_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


def create_access_token(*, user_id: str, roles: list[str], session_id: str) -> str:
    now = utcnow()
    payload = {
        "sub": user_id,
        "roles": roles,
        "sid": session_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_minutes)).timestamp()),
        "iss": "pramaansetu",
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=["HS256"], issuer="pramaansetu")
    except jwt.ExpiredSignatureError:
        raise Unauthenticated("Your session has expired. Sign in again to continue.") from None
    except jwt.InvalidTokenError:
        raise Unauthenticated("Your session is not valid. Sign in again to continue.") from None


def new_refresh_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(48)
    return raw, hash_token(raw)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def new_api_key() -> tuple[str, str]:
    """Pilot-scoped API key for metric ingest (FR-PE-01)."""
    raw = "ps_" + secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def new_share_token() -> str:
    """Read-only passport share link (FR-SR-05)."""
    return secrets.token_urlsafe(24)


def hash_ip(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256((settings.secret_key + value).encode()).hexdigest()[:32]


def redact(text: str) -> str:
    """Strip identifiers before text leaves the platform for an LLM (PRD 12.1)."""
    import re

    patterns = [
        (r"[\w\.\-\+]+@[\w\-]+\.[\w\.\-]+", "[email removed]"),
        (r"(?<!\d)(?:\+91[\-\s]?)?[6-9]\d{9}(?!\d)", "[phone removed]"),
        (r"(?<![A-Za-z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Za-z0-9])", "[identifier removed]"),
        (r"(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)", "[identifier removed]"),
    ]
    out = text or ""
    for pattern, replacement in patterns:
        out = re.sub(pattern, replacement, out)
    return out
