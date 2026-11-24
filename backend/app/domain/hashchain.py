"""Tamper-evident audit chain (PRD 11.4).

Each entry stores h_n = SHA256(h_{n-1} || canonical_json(entry_n)). Canonical JSON means
sorted keys, no insignificant whitespace and UTF-8, so the same entry always hashes the
same way regardless of how it was serialised on the way in.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

GENESIS_HASH = "0" * 64


def canonical_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def entry_digest(prev_hash: str, entry: dict[str, Any]) -> str:
    material = prev_hash + canonical_json(entry)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def chain_payload(
    *,
    actor_id: str | None,
    actor_role: str | None,
    action: str,
    entity_type: str,
    entity_id: str,
    department_id: str | None,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    reason: str | None,
    at: str,
) -> dict[str, Any]:
    """The exact fields that are hashed. Adding a field here breaks existing chains."""
    return {
        "action": action,
        "actor_id": actor_id,
        "actor_role": actor_role,
        "after": after,
        "at": at,
        "before": before,
        "department_id": department_id,
        "entity_id": entity_id,
        "entity_type": entity_type,
        "reason": reason,
    }


@dataclass(frozen=True)
class ChainVerification:
    verified: bool
    entries_checked: int
    first_broken_seq: int | None
    detail: str
    head_hash: str


def verify_chain(rows: list[dict[str, Any]]) -> ChainVerification:
    """Recompute the chain and report the first broken link (PRD FR-AD-02).

    Each row must carry seq, prev_hash, hash and the hashed payload fields.
    """
    prev = GENESIS_HASH
    checked = 0
    for row in rows:
        payload = chain_payload(
            actor_id=row.get("actor_id"),
            actor_role=row.get("actor_role"),
            action=row["action"],
            entity_type=row["entity_type"],
            entity_id=row["entity_id"],
            department_id=row.get("department_id"),
            before=row.get("before"),
            after=row.get("after"),
            reason=row.get("reason"),
            at=row["at"],
        )
        if row["prev_hash"] != prev:
            return ChainVerification(
                verified=False,
                entries_checked=checked,
                first_broken_seq=int(row["seq"]),
                detail=(
                    "Entry " + str(row["seq"]) + " does not follow the previous entry. "
                    "A row was inserted, removed or reordered."
                ),
                head_hash=prev,
            )
        expected = entry_digest(prev, payload)
        if expected != row["hash"]:
            return ChainVerification(
                verified=False,
                entries_checked=checked,
                first_broken_seq=int(row["seq"]),
                detail=(
                    "Entry " + str(row["seq"]) + " was altered after it was written. "
                    "Its contents no longer match its recorded hash."
                ),
                head_hash=prev,
            )
        prev = row["hash"]
        checked += 1
    return ChainVerification(
        verified=True,
        entries_checked=checked,
        first_broken_seq=None,
        detail="All " + str(checked) + " entries verified. The chain is intact.",
        head_hash=prev,
    )


def file_digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dataset_digest(rows: list[dict[str, Any]]) -> str:
    """Hash of the exact dataset analysed, so a later data change invalidates the report."""
    ordered = sorted(
        rows,
        key=lambda r: (
            str(r.get("kpi_id")),
            str(r.get("phase")),
            str(r.get("arm")),
            str(r.get("unit_ref")),
            str(r.get("period_start")),
        ),
    )
    return hashlib.sha256(canonical_json({"rows": ordered}).encode("utf-8")).hexdigest()


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
