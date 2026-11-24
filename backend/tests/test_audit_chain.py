"""Tamper-evident audit chain (PRD 11.4, FR-AD-02)."""

from __future__ import annotations

from factories import make_department, make_user, principal_of
from hypothesis import given
from hypothesis import strategies as st
from sqlalchemy import select, update

from app.core.clock import utcnow
from app.domain.hashchain import (
    GENESIS_HASH,
    canonical_json,
    chain_payload,
    dataset_digest,
    entry_digest,
    verify_chain,
)
from app.models.platform import AuditLog
from app.services import audit


def _row(seq: int, prev_hash: str, action: str = "test.action") -> dict:
    payload = chain_payload(
        actor_id="u" + str(seq),
        actor_role="DO",
        action=action,
        entity_type="challenge",
        entity_id="c1",
        department_id="d1",
        before=None,
        after={"state": "Draft"},
        reason=None,
        at="2026-01-0" + str((seq % 9) + 1) + "T00:00:00+00:00",
    )
    return {
        "seq": seq,
        **payload,
        "prev_hash": prev_hash,
        "hash": entry_digest(prev_hash, payload),
    }


def _build_chain(length: int) -> list[dict]:
    rows: list[dict] = []
    prev = GENESIS_HASH
    for seq in range(1, length + 1):
        row = _row(seq, prev)
        rows.append(row)
        prev = row["hash"]
    return rows


def test_canonical_json_is_key_order_independent():
    assert canonical_json({"b": 1, "a": 2}) == canonical_json({"a": 2, "b": 1})


def test_an_intact_chain_verifies():
    rows = _build_chain(20)
    result = verify_chain(rows)
    assert result.verified
    assert result.entries_checked == 20
    assert result.first_broken_seq is None
    assert result.head_hash == rows[-1]["hash"]


def test_an_altered_entry_is_detected_at_its_own_sequence():
    rows = _build_chain(10)
    rows[5]["after"] = {"state": "Published"}
    result = verify_chain(rows)
    assert not result.verified
    assert result.first_broken_seq == 6
    assert "altered after it was written" in result.detail


def test_a_removed_entry_is_detected():
    rows = _build_chain(10)
    del rows[4]
    result = verify_chain(rows)
    assert not result.verified
    assert result.first_broken_seq == 6
    assert "inserted, removed or reordered" in result.detail


def test_a_reordered_entry_is_detected():
    rows = _build_chain(10)
    rows[3], rows[4] = rows[4], rows[3]
    result = verify_chain(rows)
    assert not result.verified


def test_an_empty_chain_verifies_trivially():
    result = verify_chain([])
    assert result.verified
    assert result.head_hash == GENESIS_HASH


def test_dataset_digest_is_order_independent_but_value_sensitive():
    rows = [
        {"kpi_id": "k1", "phase": "pilot", "arm": "treatment", "unit_ref": "A",
         "period_start": "2026-01-01", "value": 1.0},
        {"kpi_id": "k1", "phase": "pilot", "arm": "treatment", "unit_ref": "B",
         "period_start": "2026-01-01", "value": 2.0},
    ]
    assert dataset_digest(rows) == dataset_digest(list(reversed(rows)))
    changed = [dict(rows[0], value=1.5), rows[1]]
    assert dataset_digest(changed) != dataset_digest(rows)


@given(st.integers(min_value=0, max_value=60))
def test_chain_of_any_length_verifies(length: int):
    assert verify_chain(_build_chain(length)).verified


async def test_audit_entries_are_chained_in_the_database(session):
    department = await make_department(session)
    officer = await make_user(
        session,
        email="officer@test.invalid",
        roles=[("DO", "department", department.id)],
        department_id=department.id,
    )
    principal = principal_of(officer)

    for index in range(5):
        await audit.record(
            session,
            action="test.step" + str(index),
            entity_type="challenge",
            entity_id="challenge-" + str(index),
            actor_id=principal.user_id,
            actor_role="DO",
            department_id=department.id,
            after={"index": index},
        )
    await session.commit()

    verification = await audit.verify(session)
    assert verification.verified
    assert verification.entries_checked >= 5
    assert await audit.head_hash(session) == verification.head_hash


async def test_tampering_with_a_stored_entry_breaks_verification(session):
    department = await make_department(session, code="TAMPER")
    officer = await make_user(
        session,
        email="tamper@test.invalid",
        roles=[("DO", "department", department.id)],
        department_id=department.id,
    )
    for index in range(4):
        await audit.record(
            session,
            action="test.step",
            entity_type="challenge",
            entity_id="c" + str(index),
            actor_id=officer.id,
            actor_role="DO",
            department_id=department.id,
            after={"index": index},
        )
    await session.commit()

    target = (await session.execute(select(AuditLog).order_by(AuditLog.seq.asc()))).scalars().all()[2]
    await session.execute(
        update(AuditLog).where(AuditLog.seq == target.seq).values(reason="edited after the fact")
    )
    await session.commit()

    verification = await audit.verify(session)
    assert not verification.verified
    assert verification.first_broken_seq == target.seq


async def test_audit_entries_can_be_filtered_for_a_department(session):
    first = await make_department(session, code="D1")
    second = await make_department(session, code="D2")
    user = await make_user(session, email="filter@test.invalid", department_id=first.id)

    await audit.record(
        session, action="a.one", entity_type="challenge", entity_id="x",
        actor_id=user.id, department_id=first.id,
    )
    await audit.record(
        session, action="a.two", entity_type="challenge", entity_id="y",
        actor_id=user.id, department_id=second.id,
    )
    await session.commit()

    rows = await audit.entries_for(session, department_id=first.id)
    assert [r.action for r in rows] == ["a.one"]


def test_snapshot_serialises_timestamps():
    class Fake:
        state = "Draft"
        created_at = utcnow()

    snapshot = audit.snapshot(Fake(), ("state", "created_at", "missing"))
    assert snapshot["state"] == "Draft"
    assert isinstance(snapshot["created_at"], str)
    assert snapshot["missing"] is None
