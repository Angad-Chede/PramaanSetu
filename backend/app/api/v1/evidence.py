"""Evidence Engine and independent validation endpoints (PRD 5.10)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field

from app.api.common import iso, run_action
from app.core.deps import CsrfDep, IdempotencyDep, PrincipalDep, SessionDep
from app.core.errors import NotFound
from app.core.policy import require
from app.models.identity import AppUser
from app.models.pilot import Pilot
from app.services import evidence as evidence_service
from app.services import files as files_service
from app.services import pilots as pilots_service

router = APIRouter(tags=["evidence"])


class RunIn(BaseModel):
    seed: int | None = None


class SignOffIn(BaseModel):
    decision: str = Field(pattern="^(sign_off|sign_off_with_qualifications|refuse)$")
    remarks: str = Field(min_length=20, max_length=8000)
    checklist: dict[str, bool] = Field(default_factory=dict)


def report_view(report: Any, *, include_analysis: bool = True) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": report.id,
        "reference": report.reference,
        "pilot_id": report.pilot_id,
        "status": report.status,
        "confidence_score": report.confidence_score,
        "band": report.band,
        "dataset_hash": report.dataset_hash,
        "seed": report.seed,
        "engine_version": report.engine_version,
        "validator_id": report.validator_id,
        "signed_at": iso(report.signed_at),
        "remarks": report.remarks,
        "pdf_file_id": report.pdf_file_id,
        "version": report.version,
    }
    if include_analysis:
        body["analysis"] = report.analysis
        body["components"] = report.components
        body["deviations"] = report.deviations
        body["limitations"] = report.limitations
        body["checklist"] = report.checklist
    return body


async def _pilot(session, pilot_id: str, principal, action: str) -> Pilot:  # type: ignore[no-untyped-def]
    pilot = await pilots_service.get(session, pilot_id)
    require(
        principal,
        action,
        {
            "department_id": pilot.department_id,
            "startup_id": pilot.startup_id,
            "challenge_id": pilot.challenge_id,
        },
    )
    return pilot


@router.post("/pilots/{pilot_id}/evidence/run", status_code=status.HTTP_201_CREATED,
             summary="Run the pre-registered analysis")
async def run_analysis(
    pilot_id: str,
    body: RunIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    pilot = await _pilot(session, pilot_id, principal, "evidence:run")

    async def _do() -> dict[str, Any]:
        report = await evidence_service.run_analysis(session, pilot, principal, seed=body.seed)
        result = report_view(report)
        result["detail"] = (
            "The analysis ran on the method and pass mark fixed at design freeze. The dataset "
            "hash locks the exact data analysed. The report is now with the independent "
            "validator; the score is provisional until sign-off."
        )
        return result

    return await run_action(
        session=session,
        principal=principal,
        route="POST /pilots/{id}/evidence/run",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        status_code=201,
    )


@router.get("/pilots/{pilot_id}/evidence", summary="The Evidence Report for a pilot")
async def get_pilot_evidence(
    pilot_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    pilot = await _pilot(session, pilot_id, principal, "evidence:read")
    report = await evidence_service.report_for_pilot(session, pilot.id)
    if report is None:
        raise NotFound(
            "No Evidence Report has been produced for this pilot yet. Run the Evidence Engine "
            "once the pilot is complete."
        )
    body = report_view(report)
    body["dataset_check"] = await evidence_service.verify_dataset_unchanged(session, report)
    if report.validator_id:
        validator = await session.get(AppUser, report.validator_id)
        body["validator_name"] = validator.name if validator else None
    return body


@router.get("/evidence/{report_id}", summary="One Evidence Report")
async def get_report(report_id: str, principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    report = await evidence_service.get_report(session, report_id)
    pilot = await pilots_service.get(session, report.pilot_id)
    require(
        principal,
        "evidence:read",
        {
            "department_id": pilot.department_id,
            "startup_id": pilot.startup_id,
            "challenge_id": pilot.challenge_id,
        },
    )
    body = report_view(report)
    body["dataset_check"] = await evidence_service.verify_dataset_unchanged(session, report)
    return body


@router.get("/evidence/{report_id}/workspace", summary="Validator workspace with raw data")
async def workspace(report_id: str, principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    report = await evidence_service.get_report(session, report_id)
    pilot = await pilots_service.get(session, report.pilot_id)
    require(
        principal,
        "evidence:read-raw",
        {
            "department_id": pilot.department_id,
            "startup_id": pilot.startup_id,
            "challenge_id": pilot.challenge_id,
        },
    )
    body = await evidence_service.validator_workspace(session, pilot, report)
    body["dataset_check"] = await evidence_service.verify_dataset_unchanged(session, report)
    body["guidance"] = [
        "Trace a sample of submitted values back to the sources named in the measurement method.",
        "Re-run the analysis on the locked dataset and confirm it reproduces the same numbers. "
        "The seed and engine version are shown above.",
        "Read every deviation from the pre-registered plan before deciding.",
        "Refusing to sign off means no Evidence Confidence Score is issued at all, and no scale "
        "decision can be recorded on this pilot.",
    ]
    return body


@router.post("/evidence/{report_id}/sign-off", summary="Sign off, qualify, or refuse")
async def sign_off(
    report_id: str,
    body: SignOffIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    from app.core.db import lock_row
    from app.models.evidence import EvidenceReport

    report = await lock_row(session, EvidenceReport, report_id)
    if report is None:
        raise NotFound("This Evidence Report was not found.")
    pilot = await pilots_service.get(session, report.pilot_id)
    require(
        principal,
        "evidence:sign-off",
        {
            "department_id": pilot.department_id,
            "startup_id": pilot.startup_id,
            "challenge_id": pilot.challenge_id,
        },
    )

    async def _do() -> dict[str, Any]:
        updated = await evidence_service.sign_off(
            session,
            report,
            pilot,
            principal,
            decision=body.decision,
            remarks=body.remarks,
            checklist=body.checklist,
        )
        result = report_view(updated)
        result["detail"] = (
            "Validation refused. No Evidence Confidence Score is issued and no scale decision "
            "can be recorded on this pilot."
            if body.decision == "refuse"
            else "Signed off. The score is final and an Innovation Passport is being issued."
        )
        return result

    return await run_action(
        session=session,
        principal=principal,
        route="POST /evidence/{id}/sign-off",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
    )


@router.get("/evidence/{report_id}/report.pdf", summary="Download the Evidence Report")
async def download_report(
    report_id: str, principal: PrincipalDep, session: SessionDep
) -> Response:
    report = await evidence_service.get_report(session, report_id)
    pilot = await pilots_service.get(session, report.pilot_id)
    require(
        principal,
        "evidence:read",
        {
            "department_id": pilot.department_id,
            "startup_id": pilot.startup_id,
            "challenge_id": pilot.challenge_id,
        },
    )
    if not report.pdf_file_id:
        raise NotFound("No rendered report is stored for this Evidence Report.")
    record, data = await files_service.read_bytes(session, report.pdf_file_id)
    return Response(
        content=data,
        media_type=record.mime,
        headers={"Content-Disposition": 'attachment; filename="' + record.filename + '"'},
    )
