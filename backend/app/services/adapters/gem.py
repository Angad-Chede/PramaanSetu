"""Government e-Marketplace adapter (FR-SC-01, FR-SC-05).

Two jobs: tell the pathway recommender whether a product category is listed and how many
qualified vendors exist, and export the procurement handoff pack as JSON.
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.services.adapters.base import Adapter

log = get_logger(__name__)


@dataclass
class CategoryAvailability:
    category: str
    listed: bool
    qualified_vendor_count: int
    detail: str
    source: str


@dataclass
class ExportReceipt:
    accepted: bool
    reference: str
    detail: str
    payload_bytes: int


class GemAdapter(Adapter):
    name = "gem"

    async def category_availability(self, category: str, sector: str | None) -> CategoryAvailability:
        raise NotImplementedError

    async def export_handoff(self, payload: dict[str, Any]) -> ExportReceipt:
        raise NotImplementedError


class MockGemAdapter(GemAdapter):
    """Deterministic answers so the pathway rules can be demonstrated and tested."""

    def __init__(self, mode: str = "mock") -> None:
        super().__init__(mode)
        self.catalogue: dict[str, tuple[bool, int]] = {
            "water leakage detection": (True, 4),
            "water management": (True, 4),
            "solid waste management": (True, 6),
            "traffic management": (True, 3),
            "public health analytics": (False, 1),
            "agriculture advisory": (True, 5),
            "energy efficiency": (True, 2),
        }

    async def category_availability(self, category: str, sector: str | None) -> CategoryAvailability:
        await asyncio.sleep(0)
        key = (category or "").strip().lower()
        listed, vendors = self.catalogue.get(key, (False, 1))
        if not listed and sector:
            listed, vendors = self.catalogue.get(sector.strip().lower(), (False, 1))
        return CategoryAvailability(
            category=category,
            listed=listed,
            qualified_vendor_count=vendors,
            detail=(
                "Category is listed with " + str(vendors) + " qualified vendors."
                if listed
                else "Category is not listed on the marketplace as a standard product."
            ),
            source="mock",
        )

    async def export_handoff(self, payload: dict[str, Any]) -> ExportReceipt:
        await asyncio.sleep(0)
        import json

        encoded = json.dumps(payload, default=str)
        return ExportReceipt(
            accepted=True,
            reference="GEM-MOCK-" + str(abs(hash(encoded)) % 10_000_000),
            detail="Handoff pack accepted by the marketplace adapter in mock mode.",
            payload_bytes=len(encoded.encode("utf-8")),
        )


class LiveGemAdapter(GemAdapter):
    def __init__(self, mode: str = "live") -> None:
        super().__init__(mode)

    async def category_availability(self, category: str, sector: str | None) -> CategoryAvailability:
        self.breaker.guard()
        try:
            import httpx

            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    "https://api.gem.gov.in/catalogue/search", params={"q": category}
                )
                response.raise_for_status()
                data = response.json()
            self.breaker.record_success()
            return CategoryAvailability(
                category=category,
                listed=bool(data.get("results")),
                qualified_vendor_count=int(data.get("sellerCount", 0)),
                detail=data.get("message", ""),
                source="live",
            )
        except Exception as exc:
            self.breaker.record_failure()
            log.warning("Marketplace availability check failed", error=str(exc))
            return CategoryAvailability(
                category=category,
                listed=False,
                qualified_vendor_count=0,
                detail="The marketplace could not be reached. Treat availability as unknown.",
                source="live",
            )

    async def export_handoff(self, payload: dict[str, Any]) -> ExportReceipt:
        self.breaker.guard()
        try:
            import httpx

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post("https://api.gem.gov.in/handoff", json=payload)
                response.raise_for_status()
                data = response.json()
            self.breaker.record_success()
            return ExportReceipt(
                accepted=True,
                reference=str(data.get("reference", "")),
                detail="Handoff pack accepted.",
                payload_bytes=len(str(payload).encode("utf-8")),
            )
        except Exception as exc:
            self.breaker.record_failure()
            raise RuntimeError("Marketplace handoff failed: " + str(exc)) from exc


_adapter: GemAdapter | None = None


def get_gem_adapter() -> GemAdapter:
    global _adapter
    if _adapter is None:
        _adapter = MockGemAdapter() if settings.adapter_gem_mode == "mock" else LiveGemAdapter()
    return _adapter


def receipt_to_dict(receipt: ExportReceipt) -> dict[str, Any]:
    return asdict(receipt)
