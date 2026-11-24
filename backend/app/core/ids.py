"""UUID v7 generation. Time-ordered primary keys keep index locality on append-heavy tables."""

from __future__ import annotations

import os
import time
import uuid


def uuid7() -> uuid.UUID:
    """RFC 9562 UUID version 7: 48-bit Unix millisecond timestamp, then randomness."""
    ms = int(time.time() * 1000) & 0xFFFFFFFFFFFF
    rand_a = int.from_bytes(os.urandom(2), "big") & 0x0FFF
    rand_b = int.from_bytes(os.urandom(8), "big") & 0x3FFFFFFFFFFFFFFF
    value = (ms << 80) | (0x7 << 76) | (rand_a << 64) | (0b10 << 62) | rand_b
    return uuid.UUID(int=value)


def uuid7str() -> str:
    return str(uuid7())


def short_ref(prefix: str) -> str:
    """Human-quotable reference such as CH-7KQ3F2. Used on documents, never as a key."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    body = "".join(alphabet[b % len(alphabet)] for b in os.urandom(6))
    return f"{prefix}-{body}"
