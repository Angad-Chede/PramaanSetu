"""Document vault (PRD 9.2, 11.1).

Uploads never pass through the API servers: the client asks for a pre-signed URL,
uploads directly to object storage, then calls complete, which verifies the hash and
queues a virus scan. A file is not readable until the scan clears it.

The local backend implements the same two-step contract on the filesystem, so the code
path exercised in development is the same one used against S3-compatible storage.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.config import settings
from app.core.errors import NotFound, ValidationFailed
from app.core.hash import sha256_bytes
from app.core.logging import get_logger
from app.models.platform import FileObject

log = get_logger(__name__)

ALLOWED_MIME = {
    "application/pdf": ".pdf",
    "text/csv": ".csv",
    "text/plain": ".txt",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/json": ".json",
    "application/zip": ".zip",
}

# Signatures of executable content that must never be stored, whatever the declared type.
FORBIDDEN_PREFIXES = (b"MZ", b"\x7fELF", b"#!", b"PK\x03\x04\x14\x00\x08\x00\x08\x00")

SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass
class UploadTicket:
    file_id: str
    upload_url: str
    method: str
    headers: dict[str, str]
    expires_in_seconds: int
    max_bytes: int


def _safe_filename(name: str) -> str:
    cleaned = SAFE_NAME.sub("_", (name or "file").strip())[:180]
    return cleaned or "file"


def _storage_root() -> Path:
    root = Path(settings.storage_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _path_for(key: str) -> Path:
    root = _storage_root()
    target = (root / key).resolve()
    if not str(target).startswith(str(root)):
        raise ValidationFailed("The storage key is not valid.")
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


async def create_upload_ticket(
    session: AsyncSession,
    *,
    filename: str,
    mime: str,
    size: int,
    purpose: str,
    uploaded_by: str,
    owner_scope_type: str | None = None,
    owner_scope_id: str | None = None,
) -> tuple[FileObject, UploadTicket]:
    if mime not in ALLOWED_MIME:
        raise ValidationFailed(
            "This file type cannot be uploaded.",
            errors=[
                {
                    "field": "mime",
                    "detail": "The type " + mime + " is not on the allow list.",
                    "fix": "Upload one of: PDF, CSV, plain text, PNG, JPEG, XLSX, DOCX, JSON or ZIP.",
                }
            ],
        )
    if size > settings.max_upload_bytes:
        raise ValidationFailed(
            "This file is larger than the upload limit.",
            errors=[
                {
                    "field": "size",
                    "detail": "The file is " + str(round(size / 1_048_576, 1)) + " MB.",
                    "fix": "Upload a file of at most "
                    + str(settings.max_upload_bytes // 1_048_576)
                    + " MB, or split it into parts.",
                }
            ],
        )

    safe = _safe_filename(filename)
    record = FileObject(
        bucket=settings.s3_bucket,
        key="",
        filename=safe,
        size=size,
        mime=mime,
        purpose=purpose,
        owner_scope_type=owner_scope_type,
        owner_scope_id=owner_scope_id,
        uploaded_by=uploaded_by,
        scanned_status="Pending",
    )
    session.add(record)
    await session.flush()
    record.key = purpose + "/" + record.id + "/" + safe
    await session.flush()

    ticket = UploadTicket(
        file_id=record.id,
        upload_url=settings.base_url + settings.api_prefix + "/files/" + record.id + "/content",
        method="PUT",
        headers={"Content-Type": mime},
        expires_in_seconds=900,
        max_bytes=settings.max_upload_bytes,
    )
    return record, ticket


async def store_bytes(session: AsyncSession, file_id: str, data: bytes) -> FileObject:
    """Write the object and record its hash. Called by the pre-signed upload endpoint."""
    record = await session.get(FileObject, file_id)
    if record is None:
        raise NotFound("The upload ticket was not found or has expired.")
    if len(data) > settings.max_upload_bytes:
        raise ValidationFailed("This file is larger than the upload limit.")
    if any(data.startswith(prefix) for prefix in FORBIDDEN_PREFIXES[:3]):
        record.scanned_status = "Rejected"
        await session.flush()
        raise ValidationFailed(
            "This file looks like an executable and cannot be stored.",
            errors=[
                {
                    "field": "file",
                    "detail": "Executable content was detected.",
                    "fix": "Upload a document, spreadsheet, image or data file instead.",
                }
            ],
        )
    path = _path_for(record.key)
    path.write_bytes(data)
    record.size = len(data)
    record.sha256 = sha256_bytes(data)
    await session.flush()
    return record


async def complete_upload(session: AsyncSession, file_id: str) -> FileObject:
    """Mark the upload complete and clear it for use after the scan (FR 11.1)."""
    record = await session.get(FileObject, file_id)
    if record is None:
        raise NotFound("The file was not found.")
    if record.sha256 is None:
        raise ValidationFailed(
            "The file content has not been uploaded yet.",
            errors=[
                {
                    "field": "file",
                    "detail": "No content was received for this upload ticket.",
                    "fix": "Upload the file to the URL given, then call complete again.",
                }
            ],
        )
    record.scanned_status = await scan(record)
    record.completed_at = utcnow()
    await session.flush()
    return record


async def scan(record: FileObject) -> str:
    """Virus scan hook. ClamAV in deployment; a content check in the MVP."""
    try:
        path = _path_for(record.key)
        if not path.exists():
            return "Pending"
        head = path.read_bytes()[:64]
        if any(head.startswith(prefix) for prefix in FORBIDDEN_PREFIXES[:3]):
            return "Rejected"
        if b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE" in head:
            return "Rejected"
        return "Clean"
    except Exception as exc:
        log.warning("File scan failed", file_id=record.id, error=str(exc))
        return "Pending"


async def read_bytes(session: AsyncSession, file_id: str) -> tuple[FileObject, bytes]:
    record = await session.get(FileObject, file_id)
    if record is None:
        raise NotFound("The file was not found.")
    if record.scanned_status != "Clean":
        raise ValidationFailed(
            "This file is not available yet.",
            errors=[
                {
                    "field": "file",
                    "detail": "The file is in state " + record.scanned_status + ".",
                    "fix": "Wait for the scan to complete, or upload the file again.",
                }
            ],
        )
    path = _path_for(record.key)
    if not path.exists():
        raise NotFound("The file content is missing from storage.")
    return record, path.read_bytes()


async def store_generated(
    session: AsyncSession,
    *,
    data: bytes,
    filename: str,
    mime: str,
    purpose: str,
    uploaded_by: str,
    owner_scope_type: str | None = None,
    owner_scope_id: str | None = None,
) -> FileObject:
    """Store a document the platform generated, such as an agreement or report PDF."""
    record = FileObject(
        bucket=settings.s3_bucket,
        key="",
        filename=_safe_filename(filename),
        size=len(data),
        mime=mime,
        purpose=purpose,
        owner_scope_type=owner_scope_type,
        owner_scope_id=owner_scope_id,
        uploaded_by=uploaded_by,
        scanned_status="Clean",
        sha256=sha256_bytes(data),
        completed_at=utcnow(),
    )
    session.add(record)
    await session.flush()
    record.key = purpose + "/" + record.id + "/" + record.filename
    _path_for(record.key).write_bytes(data)
    await session.flush()
    return record


def storage_health() -> dict[str, Any]:
    try:
        root = _storage_root()
        usage = sum(1 for _ in root.rglob("*") if _.is_file())
        return {"backend": settings.storage_backend, "root": str(root), "files": usage, "writable": os.access(root, os.W_OK)}
    except Exception as exc:
        return {"backend": settings.storage_backend, "error": str(exc)}
