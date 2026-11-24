"""Canonical serialisation shared by the audit chain, idempotency and dataset hashing."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_json(payload: Any) -> str:
    return sha256_text(canonical(payload))
