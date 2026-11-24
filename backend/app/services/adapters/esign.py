"""e-Sign adapter (FR-PA-06).

In the MVP acceptance is recorded with the accepting user, a server timestamp and the
SHA-256 hash of the exact document accepted, which is what the audit trail needs. The
live adapter replaces that with an Aadhaar e-Sign or DSC signature over the same hash.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.core.clock import utcnow
from app.core.config import settings
from app.core.ids import short_ref
from app.services.adapters.base import Adapter


@dataclass
class SignatureReceipt:
    reference: str
    signed_at: str
    document_hash: str
    signer_name: str
    method: str
    detail: str


class ESignAdapter(Adapter):
    name = "esign"

    async def sign(self, *, document_hash: str, signer_name: str, signer_id: str) -> SignatureReceipt:
        raise NotImplementedError


class MockESignAdapter(ESignAdapter):
    def __init__(self, mode: str = "mock") -> None:
        super().__init__(mode)

    async def sign(self, *, document_hash: str, signer_name: str, signer_id: str) -> SignatureReceipt:
        await asyncio.sleep(0)
        return SignatureReceipt(
            reference=short_ref("SIG"),
            signed_at=utcnow().isoformat(),
            document_hash=document_hash,
            signer_name=signer_name,
            method="Recorded acceptance with document hash",
            detail=(
                "Acceptance recorded against the document hash. In a live deployment this "
                "step is replaced by an Aadhaar e-Sign or digital signature certificate over "
                "the same hash."
            ),
        )


class LiveESignAdapter(ESignAdapter):
    def __init__(self, mode: str = "live") -> None:
        super().__init__(mode)

    async def sign(self, *, document_hash: str, signer_name: str, signer_id: str) -> SignatureReceipt:
        self.breaker.guard()
        try:
            import httpx

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    "https://esign.gov.in/api/sign",
                    json={"hash": document_hash, "signerId": signer_id},
                )
                response.raise_for_status()
                data = response.json()
            self.breaker.record_success()
            return SignatureReceipt(
                reference=str(data["reference"]),
                signed_at=str(data["signedAt"]),
                document_hash=document_hash,
                signer_name=signer_name,
                method=str(data.get("method", "e-Sign")),
                detail="Signed through the e-Sign service.",
            )
        except Exception as exc:
            self.breaker.record_failure()
            raise RuntimeError("e-Sign failed: " + str(exc)) from exc


_adapter: ESignAdapter | None = None


def get_esign_adapter() -> ESignAdapter:
    global _adapter
    if _adapter is None:
        _adapter = (
            MockESignAdapter() if settings.adapter_esign_mode == "mock" else LiveESignAdapter()
        )
    return _adapter
