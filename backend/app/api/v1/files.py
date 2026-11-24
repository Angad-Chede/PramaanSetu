"""Document vault endpoints (PRD 9.2).

Uploads never pass through application memory as a multipart form on the write path:
the client asks for a ticket, PUTs the bytes to the returned URL, then calls complete.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, Field

from app.api.common import iso
from app.core.deps import CsrfDep, PrincipalDep, SessionDep
from app.core.errors import ValidationFailed
from app.core.policy import require
from app.services import files as files_service

router = APIRouter(prefix="/files", tags=["files"])


class UploadRequest(BaseModel):
    filename: str = Field(max_length=300)
    mime: str = Field(max_length=120)
    size: int = Field(ge=1)
    purpose: str = Field(default="attachment", max_length=40)
    scope_type: str | None = None
    scope_id: str | None = None


@router.post("/upload-url", status_code=status.HTTP_201_CREATED,
             summary="Get a pre-signed upload ticket")
async def upload_url(
    body: UploadRequest, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    require(principal, "file:upload", {})
    record, ticket = await files_service.create_upload_ticket(
        session,
        filename=body.filename,
        mime=body.mime,
        size=body.size,
        purpose=body.purpose,
        uploaded_by=principal.user_id,
        owner_scope_type=body.scope_type,
        owner_scope_id=body.scope_id,
    )
    await session.commit()
    return {
        "file_id": record.id,
        "upload_url": ticket.upload_url,
        "method": ticket.method,
        "headers": ticket.headers,
        "expires_in_seconds": ticket.expires_in_seconds,
        "max_bytes": ticket.max_bytes,
        "next": "PUT the file to upload_url, then POST /files/" + record.id + "/complete.",
    }


@router.put("/{file_id}/content", summary="Upload the file content to the ticket")
async def put_content(
    file_id: str, request: Request, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    require(principal, "file:upload", {})
    data = await request.body()
    if not data:
        raise ValidationFailed(
            "No file content was received.",
            errors=[
                {
                    "field": "body",
                    "detail": "The request body was empty.",
                    "fix": "Send the file bytes as the request body with the content type from "
                    "the upload ticket.",
                }
            ],
        )
    record = await files_service.store_bytes(session, file_id, data)
    await session.commit()
    return {"file_id": record.id, "size": record.size, "sha256": record.sha256}


@router.post("/{file_id}/complete", summary="Complete the upload and queue the scan")
async def complete(
    file_id: str, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    require(principal, "file:upload", {})
    record = await files_service.complete_upload(session, file_id)
    await session.commit()
    return {
        "file_id": record.id,
        "filename": record.filename,
        "size": record.size,
        "sha256": record.sha256,
        "scanned_status": record.scanned_status,
        "usable": record.scanned_status == "Clean",
        "completed_at": iso(record.completed_at),
    }


@router.get("/{file_id}", summary="Download a file")
async def download(file_id: str, principal: PrincipalDep, session: SessionDep) -> Response:
    from app.models.platform import FileObject

    record = await session.get(FileObject, file_id)
    if record is None:
        from app.core.errors import NotFound

        raise NotFound("This file was not found.")
    require(
        principal,
        "file:read",
        {
            "uploaded_by": record.uploaded_by,
            "department_id": record.owner_scope_id if record.owner_scope_type == "department" else None,
            "startup_id": record.owner_scope_id if record.owner_scope_type == "startup" else None,
            "challenge_id": record.owner_scope_id if record.owner_scope_type == "challenge" else None,
        },
    )
    file_record, data = await files_service.read_bytes(session, file_id)
    return Response(
        content=data,
        media_type=file_record.mime,
        headers={
            "Content-Disposition": 'attachment; filename="' + file_record.filename + '"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{file_id}/metadata", summary="File metadata without the content")
async def metadata(file_id: str, principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    from app.models.platform import FileObject

    record = await session.get(FileObject, file_id)
    if record is None:
        from app.core.errors import NotFound

        raise NotFound("This file was not found.")
    require(principal, "file:read", {"uploaded_by": record.uploaded_by})
    return {
        "file_id": record.id,
        "filename": record.filename,
        "mime": record.mime,
        "size": record.size,
        "sha256": record.sha256,
        "purpose": record.purpose,
        "scanned_status": record.scanned_status,
        "uploaded_by": record.uploaded_by,
        "completed_at": iso(record.completed_at),
    }
